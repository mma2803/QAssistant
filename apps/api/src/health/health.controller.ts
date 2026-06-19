import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { Public } from '../auth/decorators.js';

/**
 * Health endpoint. Public (no token). Pings the DB on the RLS-enforced app_user
 * pool (no tenant context needed for SELECT 1).
 */
@Controller()
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get('health')
  async health(): Promise<{ status: 'ok'; db: 'up' | 'down' }> {
    let dbStatus: 'up' | 'down' = 'down';
    try {
      await this.db.app.execute(sql`SELECT 1`);
      dbStatus = 'up';
    } catch {
      dbStatus = 'down';
    }
    return { status: 'ok', db: dbStatus };
  }
}
