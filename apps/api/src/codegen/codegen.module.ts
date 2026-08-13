import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import { DbService } from '../db/db.service.js';
import { CodegenController } from './codegen.controller.js';
import { CodegenService } from './codegen.service.js';
import { CodegenWorkerService } from './codegen-worker.service.js';
import {
  GEMINI_CLIENT,
  GenAiGeminiClient,
  FakeGeminiClient,
  type GeminiClient,
} from './gemini.service.js';
import {
  CLOUD_TASKS_DISPATCHER,
  INLINE_TASK_RUNNER,
  InlineCloudTasksDispatcher,
  PostgresCloudTasksDispatcher,
  CodegenPollerService,
  type CloudTasksDispatcher,
  type InlineTaskRunner,
} from './cloud-tasks.service.js';

/**
 * Knowledge & code generation module (contract section 4.5; spec
 * knowledge-and-codegen). Relies on the global Config / Db / Auth / Storage /
 * Secrets modules.
 *
 * Driver selection (offline-first):
 *   - GEMINI_CLIENT: the live @google/genai client when GEMINI_API_KEY is set,
 *     else the deterministic FakeGeminiClient so codegen runs with no network.
 *   - CLOUD_TASKS_DISPATCHER: the inline dispatcher (runs the worker in-process)
 *     when CLOUD_TASKS_DRIVER='inline' (tests/dev), else the Postgres-backed
 *     dispatcher + CodegenPollerService (self-hosted VPS migration; replaces
 *     Cloud Tasks). The poller no-ops unless CLOUD_TASKS_DRIVER='postgres'.
 *
 * The inline dispatcher (and the poller) need the worker's runTask as their
 * runner; we expose it behind INLINE_TASK_RUNNER (a factory that closes over
 * CodegenWorkerService) so there is no circular constructor dependency.
 */
@Module({
  controllers: [CodegenController],
  providers: [
    CodegenService,
    CodegenWorkerService,
    CodegenPollerService,
    {
      provide: GEMINI_CLIENT,
      useFactory: (config: AppConfig): GeminiClient =>
        config.GEMINI_API_KEY ? new GenAiGeminiClient(config) : new FakeGeminiClient(config),
      inject: [APP_CONFIG],
    },
    {
      provide: INLINE_TASK_RUNNER,
      useFactory: (worker: CodegenWorkerService): InlineTaskRunner =>
        (payload) => worker.runTask(payload),
      inject: [CodegenWorkerService],
    },
    {
      provide: CLOUD_TASKS_DISPATCHER,
      useFactory: (config: AppConfig, runner: InlineTaskRunner, dbService: DbService): CloudTasksDispatcher =>
        config.CLOUD_TASKS_DRIVER === 'postgres'
          ? new PostgresCloudTasksDispatcher(dbService)
          : new InlineCloudTasksDispatcher(runner),
      inject: [APP_CONFIG, INLINE_TASK_RUNNER, DbService],
    },
  ],
  exports: [CodegenService, CodegenWorkerService],
})
export class CodegenModule {}
