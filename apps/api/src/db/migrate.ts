/**
 * Migration runner. Applies the ordered SQL files in src/db/migrations as the
 * migrator role (DDL owner) inside a transaction each, tracking applied files
 * in a `__migrations` table.
 *
 * The table-creation SQL is what drizzle-kit generates; the RLS/roles/grants
 * step is hand-written (contract section 8). Running this with
 * `npm run db:migrate` applies both in order.
 *
 * Run with: node --import tsx ./src/db/migrate.ts
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadConfig } from '../config/config.service.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  // Migrations always connect as the migrator role over plain host/port.
  // (Cloud SQL migration jobs override DB_HOST via the auth proxy / connector
  // sidecar in CI; the runner itself stays driver-agnostic.)
  const pool = new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_MIGRATOR_USER,
    password: config.DB_MIGRATOR_PASSWORD,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "__migrations" (
        "name" text PRIMARY KEY,
        "applied_at" timestamp with time zone NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const applied = await pool.query('SELECT 1 FROM "__migrations" WHERE name = $1', [file]);
      if ((applied.rowCount ?? 0) > 0) {
        // eslint-disable-next-line no-console
        console.log(`skip   ${file} (already applied)`);
        continue;
      }
      const sqlText = await readFile(join(migrationsDir, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sqlText);
        await client.query('INSERT INTO "__migrations" (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        // eslint-disable-next-line no-console
        console.log(`apply  ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    // eslint-disable-next-line no-console
    console.log('migrations complete');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('migration failed:', err);
  process.exit(1);
});
