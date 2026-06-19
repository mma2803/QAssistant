import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import { createPools, type DbPools } from './pool.js';
import { schema, type DbSchema } from './schema.js';

export type Database = NodePgDatabase<DbSchema>;

/**
 * A per-request transaction handle. The transaction has already had
 * `app.tenant_id` set transaction-locally (for tenant users) before the route
 * handler runs, so every query through `db` is RLS-scoped to that tenant.
 */
export interface RequestDb {
  db: Database;
  client: PoolClient;
}

/**
 * Owns the two pg pools and the Drizzle instances. Provides the canonical
 * per-request transaction wrapper that sets the tenant session variable
 * transaction-locally with set_config(..., true) (never plain SET) so a pooled
 * connection cannot leak tenant A's scope into tenant B's request (design D22).
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private pools!: DbPools;
  private appDb!: Database;
  private superadminDb!: Database;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Lazily initialize pools. Called by DbModule's factory at startup. */
  async init(): Promise<void> {
    if (this.pools) return;
    this.pools = await createPools(this.config);
    this.appDb = drizzle(this.pools.app, { schema, casing: 'snake_case' });
    this.superadminDb = drizzle(this.pools.superadmin, { schema, casing: 'snake_case' });
  }

  /** Non-transactional handle on the RLS-enforced app_user pool (health checks, etc.). */
  get app(): Database {
    return this.appDb;
  }

  /** Non-transactional handle on the BYPASSRLS app_superadmin pool. */
  get superadmin(): Database {
    return this.superadminDb;
  }

  /**
   * Run `work` inside a transaction on the RLS-enforced app_user pool with
   * `app.tenant_id` set transaction-locally to `tenantId`. This is the entry
   * point for every tenant-scoped request.
   */
  async withTenant<T>(tenantId: string, work: (tx: RequestDb) => Promise<T>): Promise<T> {
    const client = await this.pools.app.connect();
    const db = drizzle(client, { schema, casing: 'snake_case' });
    try {
      await client.query('BEGIN');
      // Transaction-local: scoped to this transaction only (the `true` arg).
      await db.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      const result = await work({ db, client });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Run `work` inside a transaction on the privileged app_superadmin
   * (BYPASSRLS) pool. No tenant variable is set. Used only by the super-admin
   * provisioning path (design D24).
   */
  async withSuperadmin<T>(work: (tx: RequestDb) => Promise<T>): Promise<T> {
    const client = await this.pools.superadmin.connect();
    const db = drizzle(client, { schema, casing: 'snake_case' });
    try {
      await client.query('BEGIN');
      const result = await work({ db, client });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pools) {
      await this.pools.close();
    }
  }
}
