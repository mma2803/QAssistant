import { Global, Module } from '@nestjs/common';
import { AppConfig, loadConfig } from './config.service.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Foundational config module. Loads and validates process env once at boot and
 * exposes a typed, frozen AppConfig via the APP_CONFIG token. Global so every
 * feature module can inject it without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
