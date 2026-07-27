import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './auth/http-exception.filter.js';

/**
 * API bootstrap. Mounts the global error-envelope filter and the /api/v1 base
 * path (contract section 4). The auth guard + transaction interceptor are
 * registered globally inside AuthModule (APP_GUARD / APP_INTERCEPTOR).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  // Trust the immediate hop (the Caddy reverse-proxy container) so req.ip
  // reflects the real client IP from X-Forwarded-For, not Caddy's — required
  // for the login/refresh per-IP rate limiter to actually be per-client.
  app.set('trust proxy', 1);
  app.use(cookieParser());

  app.setGlobalPrefix('api/v1', {
    // /health stays unprefixed for load balancers / readiness probes.
    exclude: ['health'],
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 8080);
  await app.listen(port, '0.0.0.0');
  Logger.log(`QAssistant API listening on :${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start API:', err);
  process.exit(1);
});
