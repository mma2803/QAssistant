import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * Tenant user-management module (contract section 4.2). Admin-only routes that
 * run on the tenant-scoped RLS path and call the Admin SDK to keep GCIP and the
 * tenant_users mirror in sync. Relies on global Db/Auth modules.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
