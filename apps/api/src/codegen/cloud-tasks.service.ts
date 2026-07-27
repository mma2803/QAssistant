import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, lte } from 'drizzle-orm';
import type { GenerateTaskPayload } from '@qassistant/shared';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import { DbService } from '../db/db.service.js';
import { codegenJobs } from '../db/schema.js';
import { newId } from '../db/id.js';

/**
 * Codegen job dispatch abstraction (contract section 4.5: "Enqueue a task;
 * returns { jobId }. Worker runs Gemini ... "). The generate/regenerate endpoints
 * enqueue a task; a worker runs it (in-process poller in prod, or synchronously
 * in dev/tests).
 *
 * Two drivers behind one interface so dev/offline runs end-to-end:
 *   - 'postgres' : inserts a `codegen_jobs` row; CodegenPollerService claims and
 *                  runs it (self-hosted VPS migration; replaces Cloud Tasks —
 *                  no separate worker container or Redis needed).
 *   - 'inline'   : runs the worker synchronously in-process via the injected
 *                  runner callback, so a local POST /generate fully produces a
 *                  generated_tests row with no queue. Selected automatically
 *                  when CLOUD_TASKS_DRIVER is 'inline' (the default; used by tests).
 *
 * The inline runner is registered by CodegenModule (it is the worker service's
 * runTask method) to avoid a circular provider dependency.
 */

export interface CloudTasksDispatcher {
  /** Enqueue a codegen task. Inline driver executes it before resolving. */
  enqueueGenerate(payload: GenerateTaskPayload): Promise<void>;
}

export const CLOUD_TASKS_DISPATCHER = Symbol('CLOUD_TASKS_DISPATCHER');

/** The inline worker runner the dispatcher invokes (set by CodegenModule). */
export type InlineTaskRunner = (payload: GenerateTaskPayload) => Promise<void>;
export const INLINE_TASK_RUNNER = Symbol('INLINE_TASK_RUNNER');

@Injectable()
export class InlineCloudTasksDispatcher implements CloudTasksDispatcher {
  constructor(@Inject(INLINE_TASK_RUNNER) private readonly runner: InlineTaskRunner) {}

  async enqueueGenerate(payload: GenerateTaskPayload): Promise<void> {
    // Synchronous in dev: the worker runs in-process so the row exists right
    // after /generate returns. Errors propagate so the caller sees failures.
    await this.runner(payload);
  }
}

/**
 * Enqueues a `codegen_jobs` row; CodegenPollerService (registered alongside
 * this dispatcher in CodegenModule) claims and runs it. No RLS on this table
 * (internal plumbing only), so this always runs on the BYPASSRLS pool.
 */
@Injectable()
export class PostgresCloudTasksDispatcher implements CloudTasksDispatcher {
  constructor(private readonly db: DbService) {}

  async enqueueGenerate(payload: GenerateTaskPayload): Promise<void> {
    await this.db.withSuperadmin(async ({ db }) => {
      await db.insert(codegenJobs).values({
        id: newId(),
        tenantId: payload.tenantId,
        sessionId: payload.sessionId,
        payload,
      });
    });
  }
}

/** Exponential backoff (seconds) applied to run_at after a failed attempt, capped. */
function backoffSeconds(attempts: number): number {
  return Math.min(2 ** attempts * 5, 300);
}

/**
 * Claims and runs `codegen_jobs` rows on a fixed interval, using
 * `FOR UPDATE SKIP LOCKED` so a single claim query is safe even if a future
 * deploy ever runs more than one api instance. Runs in-process in the api
 * container — no separate worker container or Redis (confirmed decision).
 * Poller concurrency is capped independently of HTTP request concurrency so a
 * burst of codegen jobs cannot starve ordinary requests on a memory-constrained
 * VPS; each job's Gemini call already has its own timeout (see gemini.service.ts).
 */
@Injectable()
export class CodegenPollerService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private inFlight = 0;
  private stopped = false;
  private static readonly POLL_INTERVAL_MS = 3_000;
  private static readonly MAX_CONCURRENT = 2;
  private static readonly MAX_ATTEMPTS = 5;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    @Inject(INLINE_TASK_RUNNER) private readonly runner: InlineTaskRunner,
  ) {}

  onModuleInit(): void {
    if (this.config.CLOUD_TASKS_DRIVER !== 'postgres') return;
    this.timer = setInterval(() => void this.tick(), CodegenPollerService.POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.inFlight >= CodegenPollerService.MAX_CONCURRENT) return;
    const claimed = await this.claimOne();
    if (!claimed) return;
    this.inFlight += 1;
    try {
      await this.runner(claimed.payload as GenerateTaskPayload);
      await this.markDone(claimed.id);
    } catch (err) {
      await this.markFailed(claimed.id, claimed.attempts, err);
    } finally {
      this.inFlight -= 1;
    }
  }

  private async claimOne(): Promise<{ id: string; payload: unknown; attempts: number } | null> {
    return this.db.withSuperadmin(async ({ db }) => {
      // SELECT ... FOR UPDATE SKIP LOCKED then UPDATE by id, both inside the
      // same transaction (withSuperadmin) so the lock is held across the two
      // statements — safe even if more than one api instance ever polls.
      const candidates = await db
        .select({ id: codegenJobs.id, payload: codegenJobs.payload, attempts: codegenJobs.attempts })
        .from(codegenJobs)
        .where(and(eq(codegenJobs.status, 'pending'), lte(codegenJobs.runAt, new Date())))
        .orderBy(asc(codegenJobs.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      const candidate = candidates[0];
      if (!candidate) return null;
      await db
        .update(codegenJobs)
        .set({ status: 'processing', lockedAt: new Date() })
        .where(eq(codegenJobs.id, candidate.id));
      return candidate;
    });
  }

  private async markDone(id: string): Promise<void> {
    await this.db.withSuperadmin(async ({ db }) => {
      await db.update(codegenJobs).set({ status: 'done', updatedAt: new Date() }).where(eq(codegenJobs.id, id));
    });
  }

  private async markFailed(id: string, priorAttempts: number, err: unknown): Promise<void> {
    const attempts = priorAttempts + 1;
    const failed = attempts >= CodegenPollerService.MAX_ATTEMPTS;
    const message = err instanceof Error ? err.message : String(err);
    await this.db.withSuperadmin(async ({ db }) => {
      await db
        .update(codegenJobs)
        .set({
          status: failed ? 'failed' : 'pending',
          attempts,
          error: message.slice(0, 2000),
          ...(failed ? {} : { runAt: new Date(Date.now() + backoffSeconds(attempts) * 1000) }),
          updatedAt: new Date(),
        })
        .where(eq(codegenJobs.id, id));
    });
  }
}
