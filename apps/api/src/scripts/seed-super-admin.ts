/**
 * First super-admin bootstrap (task 2.1, spec "First super-admin bootstrap").
 *
 * Creates the platform-level super-admin GCIP account (no tenant) and bakes the
 * `{ role: 'super-admin' }` custom claim. This is the ONLY way the first
 * super-admin is created: there is no UI path (spec). Run it once after the
 * Identity Platform / Firebase Auth emulator is up.
 *
 * Usage:
 *   SUPER_ADMIN_EMAIL=ops@example.com SUPER_ADMIN_PASSWORD='changeme123' \
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_PROJECT_ID=main-nima \
 *   node --import tsx apps/api/src/scripts/seed-super-admin.ts
 *
 * Idempotent: re-running re-applies the password and the super-admin claim to
 * the existing account.
 *
 * Locally this talks to the Firebase Auth emulator (FIREBASE_AUTH_EMULATOR_HOST,
 * D28). In a real environment it uses application default credentials.
 */
import 'reflect-metadata';
import { loadConfig } from '../config/config.service.js';
import { FirebaseService } from '../auth/firebase.service.js';

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
  // Reuse the Admin SDK wrapper. onModuleInit is normally called by Nest; here
  // we call it directly since we run outside the application context.
  const firebase = new FirebaseService(config);
  firebase.onModuleInit();

  const uid = await firebase.createSuperAdmin(email, password);

  // eslint-disable-next-line no-console
  console.log(
    `Super-admin ready: uid=${uid}, email=${email}` +
      (config.FIREBASE_AUTH_EMULATOR_HOST
        ? ` (Auth emulator ${config.FIREBASE_AUTH_EMULATOR_HOST})`
        : ''),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to seed super-admin:', err);
  process.exit(1);
});
