import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  dashboardSessionsQuerySchema,
  purgeSweepRequestSchema,
  type DashboardSessionsQuery,
  type DashboardSessionsResponse,
  type SessionDetailResponse,
  type SessionReplayResponse,
  type MetricsResponse,
  type RankingResponse,
  type Session,
  type PurgeSweepRequest,
  type PurgeSweepResponse,
} from '@qassistant/shared';
import { Public, Roles } from '../auth/decorators.js';
import { AppException } from '../auth/errors.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import { DashboardService } from './dashboard.service.js';
import { LifecycleService } from './lifecycle.service.js';

/**
 * Dashboard reads (contract 4.7), session lifecycle/admin ops (contract 4.6),
 * and the internal purge sweep (contract 3.10). Role scoping:
 *   - reads: admin tenant-wide; qa-engineer own-only (applied in the service).
 *   - metrics/ranking: admin only (role guard here).
 *   - DELETE: admin any; qa-engineer own (service enforces own-only).
 *   - restore: admin only.
 *   - export: admin or any qa-engineer in the tenant.
 *   - purge: @Public internal endpoint guarded by the shared internal token.
 */
@Controller()
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly lifecycle: LifecycleService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // --- 4.7 reads --------------------------------------------------------------

  @Get('dashboard/sessions')
  @Roles('admin', 'qa-engineer')
  listSessions(
    @Query(new ZodValidationPipe(dashboardSessionsQuerySchema)) query: DashboardSessionsQuery,
  ): Promise<DashboardSessionsResponse> {
    return this.dashboard.listSessions(query);
  }

  @Get('dashboard/sessions/:sessionId')
  @Roles('admin', 'qa-engineer')
  getSession(@Param('sessionId') sessionId: string): Promise<SessionDetailResponse> {
    return this.dashboard.getSession(sessionId);
  }

  @Get('dashboard/sessions/:sessionId/replay')
  @Roles('admin', 'qa-engineer')
  replay(@Param('sessionId') sessionId: string): Promise<SessionReplayResponse> {
    return this.dashboard.getReplay(sessionId);
  }

  @Get('dashboard/sessions/:sessionId/artifacts/:artifactId')
  @Roles('admin', 'qa-engineer')
  async artifact(
    @Param('sessionId') sessionId: string,
    @Param('artifactId') artifactId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, contentType, filename } = await this.dashboard.getArtifactBytes(
      sessionId,
      artifactId,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    // Private: the bytes are tenant data behind an authenticated, role-scoped read.
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.status(HttpStatus.OK).send(bytes);
  }

  @Get('dashboard/metrics')
  @Roles('admin')
  metrics(): Promise<MetricsResponse> {
    return this.dashboard.metrics();
  }

  @Get('dashboard/ranking')
  @Roles('admin')
  ranking(): Promise<RankingResponse> {
    return this.dashboard.ranking();
  }

  // --- 4.6 lifecycle / admin ops ---------------------------------------------

  @Delete('sessions/:sessionId')
  @Roles('admin', 'qa-engineer')
  softDelete(@Param('sessionId') sessionId: string): Promise<Session> {
    return this.lifecycle.softDelete(sessionId);
  }

  @Post('sessions/:sessionId/restore')
  @Roles('admin')
  restore(@Param('sessionId') sessionId: string): Promise<Session> {
    return this.lifecycle.restore(sessionId);
  }

  @Get('sessions/:sessionId/export')
  @Roles('admin', 'qa-engineer')
  async export(
    @Param('sessionId') sessionId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, buffer } = await this.lifecycle.export(sessionId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.status(HttpStatus.OK).send(buffer);
  }

  // --- 3.10 internal purge sweep ---------------------------------------------

  /**
   * POST /internal/tasks/purge: @Public so the AuthGuard skips ID-token
   * verification; guarded by the shared internal token (OIDC at ingress in prod).
   * Sweeps purge_at <= now() on the BYPASSRLS pool.
   */
  @Post('internal/tasks/purge')
  @Public()
  @HttpCode(200)
  async purge(
    @Headers('x-internal-task-token') token: string | undefined,
    @Query(new ZodValidationPipe(purgeSweepRequestSchema)) query: PurgeSweepRequest,
  ): Promise<PurgeSweepResponse> {
    if (!token || token !== this.config.INTERNAL_TASK_TOKEN) {
      throw new AppException('unauthenticated', 'Invalid internal task token', HttpStatus.UNAUTHORIZED);
    }
    const now = query.now ? new Date(query.now) : new Date();
    return this.lifecycle.purgeSweep(now);
  }
}
