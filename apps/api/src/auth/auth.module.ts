import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { IdentityService } from './identity.service.js';
import { RequestContext } from './request-context.js';
import { AuthGuard } from './auth.guard.js';
import { TransactionInterceptor } from './transaction.interceptor.js';

/**
 * Foundational auth module. Wires the request pipeline that every feature
 * module relies on:
 *   1. AuthGuard (APP_GUARD)            - verify the bearer token, populate
 *                                          identity, enforce must_change_password
 *                                          / role gates.
 *   2. TransactionInterceptor (APP_INTERCEPTOR) - open the per-request tenant /
 *                                          super-admin transaction, set
 *                                          app.tenant_id, resolve acting user.
 *
 * Both enhancers are singletons; they read/write the per-request identity and
 * DB handle on the request object (see RequestState in request-context.ts).
 * RequestContext is the request-scoped, typed view over that state and is
 * exported so feature controllers/services inject the verified actor and the
 * per-request DB transaction (ctx.dbTx). PasswordService/TokenService/
 * IdentityService are exported so the auth-routes and user-management feature
 * modules can hash passwords, issue/verify/revoke tokens, and manage
 * tenant_users/super_admins rows.
 *
 * Global so feature modules get these without re-importing AuthModule.
 */
@Global()
@Module({
  providers: [
    PasswordService,
    TokenService,
    IdentityService,
    RequestContext,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
  ],
  exports: [PasswordService, TokenService, IdentityService, RequestContext],
})
export class AuthModule {}
