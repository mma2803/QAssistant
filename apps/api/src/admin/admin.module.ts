import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

/**
 * Super-admin provisioning module (contract section 4.1). Relies on the global
 * DbModule (withSuperadmin / BYPASSRLS path) and AuthModule (FirebaseService,
 * super-admin guard). No tenant scoping here by design (D24).
 */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
