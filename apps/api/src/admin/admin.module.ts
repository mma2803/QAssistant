import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { InvitationsService } from './invitations.service.js';
import { SignupController } from './signup.controller.js';

/**
 * Super-admin provisioning module (contract section 4.1). Relies on the global
 * DbModule (withSuperadmin / BYPASSRLS path) and AuthModule (IdentityService,
 * super-admin guard). No tenant scoping here by design (D24).
 *
 * Also hosts the public tenant self-signup flow (change: tenant-signup-links):
 * the super-admin issues reusable links (AdminController) and recipients redeem
 * them at the @Public() SignupController — both backed by InvitationsService.
 */
@Module({
  controllers: [AdminController, SignupController],
  providers: [AdminService, InvitationsService],
})
export class AdminModule {}
