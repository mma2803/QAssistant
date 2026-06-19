import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config. `drizzle-kit generate` emits SQL from src/db/schema.ts
 * into src/db/migrations. RLS is NOT expressible in the schema, so the
 * generated SQL is followed by hand-written RLS migration steps
 * (see src/db/migrations) per contract section 8.
 *
 * Migrations connect as the migrator role (DDL owner), never app_user.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'qassistant',
    user: process.env.DB_MIGRATOR_USER ?? 'app_migrator',
    password: process.env.DB_MIGRATOR_PASSWORD ?? 'app_migrator_pw',
    ssl: process.env.DB_SSL === 'true',
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
