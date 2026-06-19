import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import {
  SECRET_MANAGER,
  LocalSecretManager,
  GcpSecretManager,
  type SecretManager,
} from './secret-manager.service.js';

/**
 * Provides the SecretManager behind the SECRET_MANAGER token, selecting the
 * driver from config (SECRETS_DRIVER). Global so projects/capture inject it
 * without re-importing. Local driver keeps offline dev self-contained.
 */
@Global()
@Module({
  providers: [
    {
      provide: SECRET_MANAGER,
      useFactory: (config: AppConfig): SecretManager =>
        config.SECRETS_DRIVER === 'gcp'
          ? new GcpSecretManager(config)
          : new LocalSecretManager(config),
      inject: [APP_CONFIG],
    },
  ],
  exports: [SECRET_MANAGER],
})
export class SecretsModule {}
