import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import {
  GCS_SIGNER,
  LocalGcsSigner,
  CloudGcsSigner,
  type GcsSigner,
} from './gcs-signer.service.js';
import {
  GCS_READER,
  LocalGcsReader,
  CloudGcsReader,
  type GcsReader,
} from './gcs-reader.service.js';

/**
 * Provides the GcsSigner (write side, capture) and the GcsReader (read side,
 * codegen) behind their tokens, selecting drivers from config (STORAGE_DRIVER).
 * Global so capture and codegen inject them without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: GCS_SIGNER,
      useFactory: (config: AppConfig): GcsSigner =>
        config.STORAGE_DRIVER === 'gcs'
          ? new CloudGcsSigner(config)
          : new LocalGcsSigner(config),
      inject: [APP_CONFIG],
    },
    {
      provide: GCS_READER,
      useFactory: (config: AppConfig): GcsReader =>
        config.STORAGE_DRIVER === 'gcs'
          ? new CloudGcsReader(config)
          : new LocalGcsReader(config),
      inject: [APP_CONFIG],
    },
  ],
  exports: [GCS_SIGNER, GCS_READER],
})
export class StorageModule {}
