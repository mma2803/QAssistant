/**
 * First super-admin bootstrap (task 2.1, spec "First super-admin bootstrap").
 *
 * Creates the platform-level super-admin row (no tenant) directly in Postgres.
 * This is the ONLY way the first super-admin is created: there is no UI path
 * (spec). Run it once after migrations have been applied.
 *
 * Usage:
 *   SUPER_ADMIN_EMAIL=ops@example.com SUPER_ADMIN_PASSWORD='changeme123' \
 *   node --import tsx apps/api/src/scripts/seed-super-admin.ts
 *
 * Idempotent: re-running resets the password on the existing account.
 */
import 'reflect-metadata';
import { loadConfig } from '../config/config.service.js';
import { DbService } from '../db/db.service.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { IdentityService } from '../auth/identity.service.js';

async function main(): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set to seed the super-admin',
    );
  }
  if (password.length < 8) {
    throw new Error('SUPER_ADMIN_PASSWORD must be at least 8 characters');
  }

  const config = loadConfig(process.env);
  const db = new DbService(config);
  await db.init();

  try {
    const passwordService = new PasswordService();
    const tokenService = new TokenService(config, db);
    const identity = new IdentityService(db, passwordService, tokenService);

    const id = await identity.createSuperAdmin(email, password);

    // eslint-disable-next-line no-console
    console.log(`Super-admin ready: id=${id}, email=${email}`);
  } finally {
    await db.onModuleDestroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to seed super-admin:', err);
  process.exit(1);
});
