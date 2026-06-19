import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { FirebaseService } from './firebase.service.js';
import { RequestContext } from './request-context.js';
import { AuthGuard } from './auth.guard.js';
import { TransactionInterceptor } from './transaction.interceptor.js';

/**
 * Foundational auth module. Wires the request pipeline that every feature
 * module relies on:
 *   1. AuthGuard (APP_GUARD)            - verify ID token, populate identity,
 *                                          enforce must_change_password / role gates.
 *   2. TransactionInterceptor (APP_INTERCEPTOR) - open the per-request tenant /
 *                                          super-admin transaction, set
 *                                          app.tenant_id, resolve acting user.
 *
 * Both enhancers are singletons; they read/write the per-request identity and
 * DB handle on the request object (see RequestState in request-context.ts).
 * RequestContext is the request-scoped, typed view over that state and is
 * exported so feature controllers/services inject the verified actor and the
 * per-request DB transaction (ctx.dbTx). FirebaseService is exported so the
 * user-management feature module can call the Admin SDK.
 *
 * Global so feature modules get RequestContext / FirebaseService without
 * re-importing AuthModule.
 */
@Global()
@Module({
  providers: [
    FirebaseService,
    RequestContext,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
  ],
  exports: [FirebaseService, RequestContext],
})
export class AuthModule {}
