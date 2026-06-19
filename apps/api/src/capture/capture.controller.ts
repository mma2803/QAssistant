import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  startSessionRequestSchema,
  uploadUrlsRequestSchema,
  registerArtifactRequestSchema,
  createFlagRequestSchema,
  inactivitySweepRequestSchema,
  type StartSessionRequest,
  type UploadUrlsRequest,
  type UploadUrlsResponse,
  type RegisterArtifactRequest,
  type CreateFlagRequest,
  type InactivitySweepRequest,
  type InactivitySweepResponse,
  type Session,
  type Artifact,
  type Flag,
} from '@qassistant/shared';
import { Public, Roles } from '../auth/decorators.js';
import { AppException } from '../auth/errors.js';
import { HttpStatus } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import { CaptureService } from './capture.service.js';
import { InactivityService } from './inactivity.service.js';

/**
 * Extension capture endpoints (contract section 4.4). All client-facing routes
 * are tenant-scoped (recorder = qa-engineer or admin); the internal inactivity
 * sweep is @Public and guarded by a shared token (OIDC at ingress in prod).
 */
@Controller()
export class CaptureController {
  constructor(
    private readonly capture: CaptureService,
    private readonly inactivity: InactivityService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('sessions')
  @Roles('admin', 'qa-engineer')
  startSession(
    @Body(new ZodValidationPipe(startSessionRequestSchema)) body: StartSessionRequest,
  ): Promise<Session> {
    return this.capture.startSession(body);
  }

  @Get('sessions/:sessionId/upload-urls')
  @Roles('admin', 'qa-engineer')
  mintUploadUrls(
    @Param('sessionId') sessionId: string,
    @Query(new ZodValidationPipe(uploadUrlsRequestSchema)) query: UploadUrlsRequest,
  ): Promise<UploadUrlsResponse> {
    return this.capture.mintUploadUrls(sessionId, query);
  }

  @Post('sessions/:sessionId/artifacts')
  @Roles('admin', 'qa-engineer')
  registerArtifact(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(registerArtifactRequestSchema)) body: RegisterArtifactRequest,
  ): Promise<Artifact> {
    return this.capture.registerArtifact(sessionId, body);
  }

  @Post('sessions/:sessionId/flags')
  @Roles('admin', 'qa-engineer')
  createFlag(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(createFlagRequestSchema)) body: CreateFlagRequest,
  ): Promise<Flag> {
    return this.capture.createFlag(sessionId, body);
  }

  @Post('sessions/:sessionId/stop')
  @Roles('admin', 'qa-engineer')
  stopSession(@Param('sessionId') sessionId: string): Promise<Session> {
    return this.capture.stopSession(sessionId);
  }

  /**
   * Internal inactivity sweep (contract 4.4 backstop). @Public so the AuthGuard
   * skips ID-token verification; guarded instead by a shared internal token. In
   * prod this is OIDC-gated at the ingress and the token is a second factor.
   */
  @Post('internal/tasks/inactivity-sweep')
  @Public()
  @HttpCode(200)
  async inactivitySweep(
    @Headers('x-internal-task-token') token: string | undefined,
    @Body(new ZodValidationPipe(inactivitySweepRequestSchema)) body: InactivitySweepRequest,
  ): Promise<InactivitySweepResponse> {
    if (!token || token !== this.config.INTERNAL_TASK_TOKEN) {
      throw new AppException('unauthenticated', 'Invalid internal task token', HttpStatus.UNAUTHORIZED);
    }
    const now = body.now ? new Date(body.now) : new Date();
    const closedSessionIds = await this.inactivity.sweep(now);
    return { closedSessionIds };
  }
}
