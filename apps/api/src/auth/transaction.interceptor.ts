import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { from, Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DbService } from '../db/db.service.js';
import { getRequestState } from './request-context.js';
import { tenantUsers } from '../db/schema.js';
import { IS_PUBLIC } from './decorators.js';

/**
 * Opens the per-request DB transaction and binds it to the RequestContext
 * (contract section 1, steps 3-5):
 *
 *   - tenant user  -> transaction on the app_user (RLS) pool with
 *                     set_config('app.tenant_id', tenantId, true), then resolves
 *                     the acting tenant_users row by gcip_uid (for authorship
 *                     stamping and status='active' enforcement);
 *   - super-admin  -> transaction on the app_superadmin (BYPASSRLS) pool, no
 *                     tenant var set.
 *
 * The transaction commits when the handler observable completes and rolls back
 * if it errors. Runs after the AuthGuard (which has populated identity).
 *
 * Implementation note: we drive the handler inside DbService.withTenant /
 * withSuperadmin so the commit/rollback brackets the whole handler execution.
 */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request>();
    const ctx = getRequestState(req);

    if (ctx.role === 'super-admin') {
      return from(
        this.db.withSuperadmin(async ({ db }) => {
          ctx.dbTx = db;
          return firstValueFromHandler(next);
        }),
      );
    }

    const tenantId = ctx.tenantId;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant scope');
    }

    return from(
      this.db.withTenant(tenantId, async ({ db }) => {
        ctx.dbTx = db;
        // Resolve the acting user row (RLS-scoped to this tenant) for authorship
        // stamping and active-status enforcement.
        const rows = await db
          .select({ id: tenantUsers.id, status: tenantUsers.status })
          .from(tenantUsers)
          .where(eq(tenantUsers.gcipUid, ctx.uid!))
          .limit(1);
        const actor = rows[0];
        if (!actor) {
          throw new UnauthorizedException('No tenant user matches this identity');
        }
        if (actor.status !== 'active') {
          throw new UnauthorizedException('User is disabled');
        }
        ctx.actingUserId = actor.id;
        // Defensive: confirm the tenant var is set on this connection.
        await db.execute(sql`SELECT current_setting('app.tenant_id', true)`);
        return firstValueFromHandler(next);
      }),
    );
  }
}

/** Bridges the Nest CallHandler observable into the transaction promise. */
function firstValueFromHandler(next: CallHandler): Promise<unknown> {
  return new Promise((resolve, reject) => {
    next
      .handle()
      .pipe(switchMap((value) => Promise.resolve(value)))
      .subscribe({
        next: (value) => resolve(value),
        error: (err) => reject(err),
      });
  });
}
