import { Pool, type PoolConfig } from 'pg';
import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import type { AppConfig } from '../config/config.service.js';

/**
 * Builds the two in-process pg pools described in the contract section 8:
 *   - the runtime `app_user` pool (RLS-enforced, no BYPASSRLS), used by all
 *     tenant-scoped requests;
 *   - the privileged `app_superadmin` pool (BYPASSRLS), used only by the
 *     super-admin provisioning path.
 *
 * Connectivity is driven by DB_DRIVER:
 *   - "local"     -> plain host/port pool (docker-compose, emulators);
 *   - "cloud-sql" -> @google-cloud/cloud-sql-connector (keyless, workload
 *                    identity, no proxy sidecar) per design D23.
 *
 * Pool size is capped (DB_POOL_MAX) to respect Cloud SQL max_connections
 * divided by max instances (design D22).
 */

export interface DbPools {
  /** RLS-enforced runtime pool (role app_user). */
  app: Pool;
  /** BYPASSRLS privileged pool (role app_superadmin). */
  superadmin: Pool;
  /** Releases the connector (cloud-sql driver) when the app shuts down. */
  close(): Promise<void>;
}

export async function createPools(config: AppConfig): Promise<DbPools> {
  if (config.DB_DRIVER === 'cloud-sql') {
    if (!config.CLOUD_SQL_INSTANCE) {
      throw new Error('CLOUD_SQL_INSTANCE is required when DB_DRIVER=cloud-sql');
    }
    const connector = new Connector();
    const ipType =
      config.CLOUD_SQL_IP_TYPE === 'PRIVATE' ? IpAddressTypes.PRIVATE : IpAddressTypes.PUBLIC;
    const clientOpts = await connector.getOptions({
      instanceConnectionName: config.CLOUD_SQL_INSTANCE,
      ipType,
    });

    const app = new Pool({
      ...clientOpts,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      max: config.DB_POOL_MAX,
    });
    const superadmin = new Pool({
      ...clientOpts,
      database: config.DB_NAME,
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
        connector.close();
      },
    };
  }

  // local driver
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
