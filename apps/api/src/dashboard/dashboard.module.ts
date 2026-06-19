import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { LifecycleService } from './lifecycle.service.js';
import {
  GCS_DELETER,
  LocalGcsDeleter,
  CloudGcsDeleter,
  type GcsDeleter,
} from './gcs-deleter.service.js';

/**
 * Dashboard module (contract sections 4.6, 4.7, 6). Relies on the global Db /
 * Auth / Storage modules: DashboardService and LifecycleService inject
 * RequestContext + DbService, and the lifecycle export/purge inject the GcsReader
 * (read side) and a module-local GcsDeleter (purge side). The deleter driver is
 * selected from STORAGE_DRIVER, mirroring the storage module's reader/signer.
 */
@Module({
  controllers: [DashboardController],
  providers: [
    DashboardService,
    LifecycleService,
    {
      provide: GCS_DELETER,
      useFactory: (config: AppConfig): GcsDeleter =>
        config.STORAGE_DRIVER === 'gcs' ? new CloudGcsDeleter(config) : new LocalGcsDeleter(config),
      inject: [APP_CONFIG],
    },
  ],
})
export class DashboardModule {}
