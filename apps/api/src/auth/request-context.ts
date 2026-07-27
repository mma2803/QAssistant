import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import type { TokenRole } from '@qassistant/shared/enums';
import type { Database } from '../db/db.service.js';

/**
 * Per-request state holder, stored directly on the Express request object.
 *
 * The request object is the one thing guaranteed to be a single instance per
 * request, so it is the source of truth for the resolved identity and the
 * per-request DB handle. The AuthGuard and TransactionInterceptor (both
 * singletons) write here; RequestContext (request-scoped) is a typed view over
 * it that feature controllers/services inject.
 *
 * Why not keep this on a request-scoped provider that the guard/interceptor
 * inject directly? Request-scoped providers registered as APP_GUARD /
 * APP_INTERCEPTOR are instantiated by Nest WITHOUT dependency injection (every
 * constructor argument comes back undefined). Keeping the enhancers singleton
 * and parking the state on the request avoids that entirely while preserving a
 * single shared instance across guard, interceptor, and handler.
 */
export interface RequestState {
  /** Subject id from the verified token (tenant_users.id, or super_admins.id). */
  uid?: string;
  /** Token role: admin | qa-engineer | super-admin. */
  role?: TokenRole;
  /** Tenant id for tenant users; null for super-admin. */
  tenantId: string | null;
  /** mustChangePassword claim from the token. */
  mustChangePassword: boolean;
  /** The acting tenant_users row id (equal to `uid` for tenant users); null for super-admin. */
  actingUserId: string | null;
  /** The per-request DB handle (tenant- or super-admin-scoped transaction). */
  dbTx?: Database;
}

const REQUEST_STATE = Symbol('qassistant.requestState');

/** Lazily initialise and return the state bag attached to a request. */
export function getRequestState(req: Request): RequestState {
  const holder = req as unknown as Record<symbol, RequestState | undefined>;
  if (!holder[REQUEST_STATE]) {
    holder[REQUEST_STATE] = { tenantId: null, mustChangePassword: false, actingUserId: null };
  }
  return holder[REQUEST_STATE]!;
}

/**
 * Per-request resolved identity + DB handle. Populated by the auth pipeline
 * (guard verifies the token; interceptor opens the per-request transaction and
 * sets app.tenant_id). Feature controllers/services inject this to read the
 * verified actor and to run queries inside the tenant-scoped transaction.
 *
 * Request-scoped (a fresh instance per request) so there is no cross-request
 * bleed of identity or transaction handle. Backed by the request-bound
 * RequestState (see above), so it reflects whatever the guard/interceptor wrote.
 */
@Injectable({ scope: Scope.REQUEST })
export class RequestContext {
  private readonly state: RequestState;

  // In the HTTP pipeline Nest injects the per-request Express request, and the
  // state is shared with the guard/interceptor (which write to the same bag on
  // that request). When constructed directly (e.g. the service-layer test
  // harness, which has no request), fall back to a standalone state bag so the
  // same public API works without an HTTP request.
  constructor(@Inject(REQUEST) req?: Request) {
    this.state = req
      ? getRequestState(req)
      : { tenantId: null, mustChangePassword: false, actingUserId: null };
  }

  get uid(): string {
    return this.state.uid!;
  }
  set uid(value: string) {
    this.state.uid = value;
  }

  get role(): TokenRole {
    return this.state.role!;
  }
  set role(value: TokenRole) {
    this.state.role = value;
  }

  get tenantId(): string | null {
    return this.state.tenantId;
  }
  set tenantId(value: string | null) {
    this.state.tenantId = value;
  }

  get mustChangePassword(): boolean {
    return this.state.mustChangePassword;
  }
  set mustChangePassword(value: boolean) {
    this.state.mustChangePassword = value;
  }

  get actingUserId(): string | null {
    return this.state.actingUserId;
  }
  set actingUserId(value: string | null) {
    this.state.actingUserId = value;
  }

  get dbTx(): Database {
    return this.state.dbTx!;
  }
  set dbTx(value: Database) {
    this.state.dbTx = value;
  }

  isSuperAdmin(): boolean {
    return this.state.role === 'super-admin';
  }
}
