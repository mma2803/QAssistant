import { Inject, Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';
import { DbService } from '../db/db.service.js';
import { encryptedSecrets } from '../db/schema.js';

/**
 * Secret Manager abstraction (contract sections 3.4, 5). Project Jira tokens and
 * default-creds live only encrypted; the DB stores a `token_secret_ref`
 * resource name, never the plaintext secret value (design D-Jira).
 *
 * Two drivers behind one interface:
 *   - 'postgres' : envelope-encrypted (AES-256-GCM) value in the
 *                  `encrypted_secrets` table, keyed with SECRETS_ENCRYPTION_KEY
 *                  from the server's persistent .env — which never itself
 *                  touches the database (self-hosted VPS migration; replaces
 *                  Secret Manager). A stolen pg_dump alone is useless without
 *                  the key. Deliberate reinterpretation of "SHALL NOT store
 *                  secrets in Postgres" (written for a plaintext-exposure
 *                  threat model) — see the openspec change design.md.
 *   - 'local'    : secrets persisted under a temp dir keyed by a hash of the
 *                  ref, so offline dev works without a database. Never used
 *                  in prod.
 *
 * A ref is an opaque resource name, e.g. for the project Jira token the stable
 * id `qassistant-jira-token-<projectId>`; rotation overwrites the stored value
 * (contract 3.4: "row unchanged").
 */
export interface SecretManager {
  /** Create-or-overwrite the secret's latest value; returns the canonical ref. */
  putSecret(secretId: string, value: string): Promise<string>;
  /** Read the latest value for a stored ref; throws if missing. */
  getSecret(ref: string): Promise<string>;
  /** Best-effort delete of a secret by id (ignore not-found). */
  deleteSecret(secretId: string): Promise<void>;
  /** Build the canonical ref string for a secret id (without creating it). */
  refFor(secretId: string): string;
}

export const SECRET_MANAGER = Symbol('SECRET_MANAGER');

/** Deterministic secret id for a project's Jira token. */
export function jiraTokenSecretId(projectId: string): string {
  return `qassistant-jira-token-${projectId}`;
}

@Injectable()
export class LocalSecretManager implements SecretManager {
  private readonly dir: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.dir = config.LOCAL_SECRETS_DIR ?? join(tmpdir(), 'qassistant-secrets');
  }

  refFor(secretId: string): string {
    return secretId;
  }

  private fileFor(ref: string): string {
    // Hash the ref so the on-disk name is filesystem-safe and stable.
    const hash = createHash('sha256').update(ref).digest('hex');
    return join(this.dir, `${hash}.secret`);
  }

  async putSecret(secretId: string, value: string): Promise<string> {
    const ref = this.refFor(secretId);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.fileFor(ref), value, { encoding: 'utf8', mode: 0o600 });
    return ref;
  }

  async getSecret(ref: string): Promise<string> {
    return fs.readFile(this.fileFor(ref), 'utf8');
  }

  async deleteSecret(secretId: string): Promise<void> {
    try {
      await fs.unlink(this.fileFor(this.refFor(secretId)));
    } catch {
      // not-found is fine
    }
  }
}

const GCM_ALGORITHM = 'aes-256-gcm';
const GCM_IV_LENGTH = 12;

/**
 * Self-hosted driver: envelope-encrypted (AES-256-GCM) value stored in the
 * `encrypted_secrets` table. The 32-byte key comes from SECRETS_ENCRYPTION_KEY
 * (base64, in the server's persistent .env) and never touches the database —
 * a stolen pg_dump alone cannot decrypt any stored value.
 */
@Injectable()
export class PostgresSecretManager implements SecretManager {
  private readonly key: Buffer;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
  ) {
    const raw = Buffer.from(config.SECRETS_ENCRYPTION_KEY ?? '', 'base64');
    if (raw.length !== 32) {
      throw new Error('SECRETS_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes');
    }
    this.key = raw;
  }

  refFor(secretId: string): string {
    return secretId;
  }

  private encrypt(value: string): string {
    const iv = randomBytes(GCM_IV_LENGTH);
    const cipher = createCipheriv(GCM_ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // iv (12) + authTag (16) + ciphertext, single base64 blob.
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  private decrypt(blob: string): string {
    const buf = Buffer.from(blob, 'base64');
    const iv = buf.subarray(0, GCM_IV_LENGTH);
    const authTag = buf.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + 16);
    const ciphertext = buf.subarray(GCM_IV_LENGTH + 16);
    const decipher = createDecipheriv(GCM_ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  async putSecret(secretId: string, value: string): Promise<string> {
    const ref = this.refFor(secretId);
    const encrypted = this.encrypt(value);
    await this.db.withSuperadmin(async ({ db }) => {
      const existing = await db
        .select({ ref: encryptedSecrets.ref })
        .from(encryptedSecrets)
        .where(eq(encryptedSecrets.ref, ref))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(encryptedSecrets)
          .set({ value: encrypted, updatedAt: new Date() })
          .where(eq(encryptedSecrets.ref, ref));
      } else {
        await db.insert(encryptedSecrets).values({ ref, value: encrypted });
      }
    });
    return ref;
  }

  async getSecret(ref: string): Promise<string> {
    return this.db.withSuperadmin(async ({ db }) => {
      const rows = await db
        .select({ value: encryptedSecrets.value })
        .from(encryptedSecrets)
        .where(eq(encryptedSecrets.ref, ref))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error(`Secret has no payload: ${ref}`);
      return this.decrypt(row.value);
    });
  }

  async deleteSecret(secretId: string): Promise<void> {
    const ref = this.refFor(secretId);
    await this.db.withSuperadmin(async ({ db }) => {
      await db.delete(encryptedSecrets).where(eq(encryptedSecrets.ref, ref));
    });
  }
}
