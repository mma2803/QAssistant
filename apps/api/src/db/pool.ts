import { Pool, type PoolConfig } from 'pg';
import type { AppConfig } from '../config/config.service.js';

/**
 * Builds the two in-process pg pools described in the contract section 8:
 *   - the runtime `app_user` pool (RLS-enforced, no BYPASSRLS), used by all
 *     tenant-scoped requests;
 *   - the privileged `app_superadmin` pool (BYPASSRLS), used only by the
 *     super-admin provisioning path.
 *
 * Plain host/port connectivity against the VPS's own Postgres container
 * (self-hosted VPS migration; the Cloud SQL Connector driver is gone — this
 * is now the only path, in dev and prod alike).
 *
 * Pool size is capped (DB_POOL_MAX), sized for the VPS's memory budget.
 */

export interface DbPools {
  /** RLS-enforced runtime pool (role app_user). */
  app: Pool;
  /** BYPASSRLS privileged pool (role app_superadmin). */
  superadmin: Pool;
  close(): Promise<void>;
}

export async function createPools(config: AppConfig): Promise<DbPools> {
  const base: PoolConfig = {
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : undefined,
  };
  const app = new Pool({
    ...base,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    max: config.DB_POOL_MAX,
  });
  const superadmin = new Pool({
    ...base,
    user: config.DB_SUPERADMIN_USER,
    password: config.DB_SUPERADMIN_PASSWORD,
    // Provisioning is low-volume; keep this pool small.
    max: Math.max(2, Math.floor(config.DB_POOL_MAX / 4)),
  });

  return {
    app,
    superadmin,
    async close() {
      await Promise.all([app.end(), superadmin.end()]);
    },
  };
}
