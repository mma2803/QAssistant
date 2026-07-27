import { Module } from '@nestjs/common';
import { AuthRoutesController } from './auth-routes.controller.js';
import { AuthRoutesService } from './auth-routes.service.js';

/**
 * Auth routes (contract section 4.2, extended by the self-hosted auth
 * migration): login/refresh/logout, the forced password-change completion,
 * and the /auth/me bootstrap. Relies on the global Db/Auth modules (request
 * transaction, verified identity, PasswordService/TokenService/IdentityService).
 */
@Module({
  controllers: [AuthRoutesController],
  providers: [AuthRoutesService],
})
export class AuthRoutesModule {}
