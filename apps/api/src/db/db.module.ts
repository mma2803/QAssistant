import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import { DbService } from './db.service.js';

/**
 * Foundational database module. Provides the singleton DbService (the two pools
 * + per-request transaction wrappers). Global so feature modules can inject
 * DbService without re-importing. The pools are opened once at startup via the
 * async factory below.
 */
@Global()
@Module({
  providers: [
    {
      provide: DbService,
      useFactory: async (config: AppConfig) => {
        const svc = new DbService(config);
        await svc.init();
        return svc;
      },
      inject: [APP_CONFIG],
    },
  ],
  exports: [DbService],
})
export class DbModule {}
