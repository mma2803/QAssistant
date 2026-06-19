import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  completePasswordChangeRequestSchema,
  type AuthMeResponse,
  type CompletePasswordChangeRequest,
} from '@qassistant/shared';
import { AllowDuringPasswordChange, Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthRoutesService } from './auth-routes.service.js';

/**
 * Self auth endpoints (contract section 4.2). Both routes carry
 * @AllowDuringPasswordChange so they pass the must_change_password gate in the
 * AuthGuard; every OTHER tenant route stays blocked while the marker is set.
 * @Roles('admin','qa-engineer') keeps the super-admin token (provisioning only)
 * off these tenant routes.
 */
@Controller('auth')
@Roles('admin', 'qa-engineer')
export class AuthRoutesController {
  constructor(private readonly authRoutesService: AuthRoutesService) {}

  @Post('complete-password-change')
  @AllowDuringPasswordChange()
  completePasswordChange(
    @Body(new ZodValidationPipe(completePasswordChangeRequestSchema))
    body: CompletePasswordChangeRequest,
  ): Promise<{ mustChangePassword: false }> {
    return this.authRoutesService.completePasswordChange(body);
  }

  @Get('me')
  @AllowDuringPasswordChange()
  me(): Promise<AuthMeResponse> {
    return this.authRoutesService.me();
  }
}
