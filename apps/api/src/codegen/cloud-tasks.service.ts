import { Inject, Injectable } from '@nestjs/common';
import type { GenerateTaskPayload } from '@qassistant/shared';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';

/**
 * Cloud Tasks dispatch abstraction (contract section 4.5: "Enqueue a Cloud Task;
 * returns { jobId }. Worker runs Gemini ... "). The generate/regenerate endpoints
 * enqueue a task; the worker endpoint POST /internal/tasks/generate runs it.
 *
 * Two drivers behind one interface so dev/offline runs end-to-end:
 *   - 'cloud-tasks' : @google-cloud/tasks createTask -> the OIDC-gated worker URL
 *                     (loaded dynamically; optional dep).
 *   - 'inline'      : runs the worker synchronously in-process via the injected
 *                     runner callback, so a local POST /generate fully produces a
 *                     generated_tests row with no queue. Selected automatically
 *                     when CLOUD_TASKS_DRIVER is 'inline' (the default).
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

@Injectable()
export class GoogleCloudTasksDispatcher implements CloudTasksDispatcher {
  private client: any;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const mod: any = await import('@google-cloud/tasks' as string);
    this.client = new mod.CloudTasksClient();
    return this.client;
  }

  async enqueueGenerate(payload: GenerateTaskPayload): Promise<void> {
    const client = await this.getClient();
    const parent = client.queuePath(
      this.config.GCP_PROJECT_ID,
      this.config.CLOUD_TASKS_LOCATION,
      this.config.CLOUD_TASKS_QUEUE,
    );
    const url = `${this.config.CLOUD_TASKS_TARGET_BASE_URL.replace(/\/$/, '')}/api/v1/internal/tasks/generate`;
    await client.createTask({
      parent,
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(JSON.stringify(payload)).toString('base64'),
          // OIDC token added by the queue's service account in prod; the
          // worker endpoint verifies it at the ingress.
          oidcToken: { serviceAccountEmail: this.config.CLOUD_TASKS_INVOKER_SA ?? '' },
        },
      },
    });
  }
}
