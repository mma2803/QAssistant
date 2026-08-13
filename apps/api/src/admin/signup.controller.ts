import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  redeemInvitationRequestSchema,
  type RedeemInvitationRequest,
  type RedeemInvitationResponse,
  type ValidateInvitationResponse,
} from '@qassistant/shared';
import { Public } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { InvitationsService } from './invitations.service.js';

/**
 * Public tenant self-signup via a super-admin-issued reusable link (change:
 * tenant-signup-links). @Public() because a signed-out recipient must reach it;
 * the link token is the only credential. Rate-limited (mirroring the login
 * endpoint) since these routes are unauthenticated — token entropy is the
 * primary defense, throttling is defense in depth.
 */
@Controller('signup')
@Public()
export class SignupController {
  constructor(private readonly invitations: InvitationsService) {}

  /** GET /signup/{token}: validity probe for the public form (leaks nothing identifying). */
  @Get(':token')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  validate(@Param('token') token: string): Promise<ValidateInvitationResponse> {
    return this.invitations.validate(token);
  }

  /** POST /signup: redeem a link to create a tenant + first admin. */
  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  redeem(
    @Body(new ZodValidationPipe(redeemInvitationRequestSchema)) body: RedeemInvitationRequest,
  ): Promise<RedeemInvitationResponse> {
    return this.invitations.redeem(body);
  }
}
