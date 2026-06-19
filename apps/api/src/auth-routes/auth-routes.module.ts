import { Module } from '@nestjs/common';
import { AuthRoutesController } from './auth-routes.controller.js';
import { AuthRoutesService } from './auth-routes.service.js';

/**
 * Self auth routes (contract section 4.2): the forced password-change
 * completion and the /auth/me bootstrap. Relies on the global Db/Auth modules
 * (request transaction, verified identity, FirebaseService).
 */
@Module({
  controllers: [AuthRoutesController],
  providers: [AuthRoutesService],
})
export class AuthRoutesModule {}
