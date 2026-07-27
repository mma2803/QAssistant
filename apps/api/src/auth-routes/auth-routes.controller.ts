import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  completePasswordChangeRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  logoutRequestSchema,
  type AuthMeResponse,
  type CompletePasswordChangeRequest,
  type LoginRequest,
  type RefreshRequest,
  type LogoutRequest,
  type TokenPairResponse,
} from '@qassistant/shared';
import { AllowDuringPasswordChange, Public, Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthRoutesService } from './auth-routes.service.js';

const REFRESH_COOKIE = 'qa_refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Auth endpoints (contract section 4.2, extended by the self-hosted auth
 * migration). login/refresh/logout are @Public() (no token yet); the
 * remaining routes carry @AllowDuringPasswordChange so they pass the
 * must_change_password gate in the AuthGuard, and @Roles('admin',
 * 'qa-engineer') at the class level keeps the super-admin token
 * (provisioning only) off these tenant routes — public routes bypass that via
 * @Public() short-circuiting the guard before role checks run.
 *
 * The refresh token is delivered two ways: as an httpOnly/Secure/SameSite
 * cookie scoped to this path (what the dashboard relies on, since it is
 * same-origin behind Caddy and never touches the token directly — an
 * XSS-hardening upgrade over the old Firebase-SDK-in-localStorage pattern),
 * and in the JSON response body (what the extension/MCP client persist
 * themselves, exactly as they persisted the Firebase refresh token before).
 */
@Controller('auth')
@Roles('admin', 'qa-engineer')
export class AuthRoutesController {
  constructor(private readonly authRoutesService: AuthRoutesService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenPairResponse> {
    const pair = await this.authRoutesService.login(body);
    setRefreshCookie(res, pair.refreshToken);
    return pair;
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  async refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenPairResponse> {
    const refreshToken = body.refreshToken ?? readRefreshCookie(req);
    const pair = await this.authRoutesService.refresh(refreshToken);
    setRefreshCookie(res, pair.refreshToken);
    return pair;
  }

  @Public()
  @Post('logout')
  async logout(
    @Body(new ZodValidationPipe(logoutRequestSchema)) body: LogoutRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const refreshToken = body.refreshToken ?? readRefreshCookie(req);
    await this.authRoutesService.logout(refreshToken);
    clearRefreshCookie(res);
    return { ok: true };
  }

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

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

function readRefreshCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[REFRESH_COOKIE];
}
