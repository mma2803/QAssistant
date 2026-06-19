import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  generateRequestSchema,
  regenerateRequestSchema,
  createCommentRequestSchema,
  generateTaskPayloadSchema,
  type GenerateRequest,
  type RegenerateRequest,
  type CreateCommentRequest,
  type GenerateTaskPayload,
  type JobResponse,
  type GeneratedTest,
  type GenerationComment,
  type GenerationsListResponse,
} from '@qassistant/shared';
import { Public, Roles } from '../auth/decorators.js';
import { AppException } from '../auth/errors.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import { CodegenService } from './codegen.service.js';
import { CodegenWorkerService } from './codegen-worker.service.js';

/**
 * Codegen endpoints (contract section 4.5). Client-facing routes are tenant
 * scoped (recorder = qa-engineer or admin; approve/integrate = any tenant user).
 * The worker endpoint is @Public (the AuthGuard skips ID-token verification) and
 * guarded by a shared internal token; in prod it is OIDC-gated at the ingress.
 */
@Controller()
export class CodegenController {
  constructor(
    private readonly codegen: CodegenService,
    private readonly worker: CodegenWorkerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('sessions/:sessionId/generate')
  @Roles('admin', 'qa-engineer')
  @HttpCode(202)
  generate(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(generateRequestSchema)) body: GenerateRequest,
  ): Promise<JobResponse> {
    return this.codegen.generate(sessionId, body);
  }

  @Post('sessions/:sessionId/regenerate')
  @Roles('admin', 'qa-engineer')
  @HttpCode(202)
  regenerate(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(regenerateRequestSchema)) body: RegenerateRequest,
  ): Promise<JobResponse> {
    return this.codegen.regenerate(sessionId, body);
  }

  @Post('sessions/:sessionId/comments')
  @Roles('admin', 'qa-engineer')
  addComment(
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(createCommentRequestSchema)) body: CreateCommentRequest,
  ): Promise<GenerationComment> {
    return this.codegen.addComment(sessionId, body);
  }

  @Get('sessions/:sessionId/generations')
  @Roles('admin', 'qa-engineer')
  async listGenerations(
    @Param('sessionId') sessionId: string,
  ): Promise<GenerationsListResponse> {
    const items = await this.codegen.listGenerations(sessionId);
    return { items };
  }

  @Get('generations/:generatedTestId')
  @Roles('admin', 'qa-engineer')
  getGeneration(
    @Param('generatedTestId') generatedTestId: string,
  ): Promise<GeneratedTest> {
    return this.codegen.getGeneration(generatedTestId);
  }

  @Post('generations/:generatedTestId/approve')
  @Roles('admin', 'qa-engineer')
  approve(@Param('generatedTestId') generatedTestId: string): Promise<GeneratedTest> {
    return this.codegen.approve(generatedTestId);
  }

  @Post('generations/:generatedTestId/integrate')
  @Roles('admin', 'qa-engineer')
  integrate(@Param('generatedTestId') generatedTestId: string): Promise<GeneratedTest> {
    return this.codegen.integrate(generatedTestId);
  }

  /**
   * Internal codegen worker (contract 4.5 POST /internal/tasks/generate). @Public
   * so the AuthGuard skips ID-token verification; guarded instead by a shared
   * internal token. In prod this is OIDC-gated at the ingress and the token is a
   * second factor. Runs Gemini and writes a generated_tests row.
   */
  @Post('internal/tasks/generate')
  @Public()
  @HttpCode(200)
  async runGenerateTask(
    @Headers('x-internal-task-token') token: string | undefined,
    @Body(new ZodValidationPipe(generateTaskPayloadSchema)) body: GenerateTaskPayload,
  ): Promise<{ ok: true }> {
    if (!token || token !== this.config.INTERNAL_TASK_TOKEN) {
      throw new AppException(
        'unauthenticated',
        'Invalid internal task token',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.worker.runTask(body);
    return { ok: true };
  }
}
