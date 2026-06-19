import { Inject, Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';

/**
 * Secret Manager abstraction (contract sections 3.4, 5). Project Jira tokens and
 * default-creds live only in Secret Manager; the DB stores a `token_secret_ref`
 * resource name, never the secret value (design D-Jira).
 *
 * Two drivers behind one interface:
 *   - 'gcp'   : @google-cloud/secret-manager (loaded dynamically so the package
 *               is not a hard build/runtime dependency in local/test).
 *   - 'local' : secrets persisted under a temp dir keyed by a hash of the ref,
 *               so offline dev works without the API. Never used in prod.
 *
 * A ref is a Secret Manager resource name:
 *   projects/<project>/secrets/<id>            (latest implied on read)
 *   projects/<project>/secrets/<id>/versions/latest
 * For the project Jira token we use the stable id
 *   qassistant-jira-token-<projectId>
 * and rotation overwrites the latest version (contract 3.4: "row unchanged").
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
  private readonly project: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.dir = config.LOCAL_SECRETS_DIR ?? join(tmpdir(), 'qassistant-secrets');
    this.project = config.GCP_PROJECT_ID;
  }

  refFor(secretId: string): string {
    return `projects/${this.project}/secrets/${secretId}/versions/latest`;
  }

  private fileFor(ref: string): string {
    // Hash the full ref so the on-disk name is filesystem-safe and stable.
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
    return fs.readFile(this.fileFor(this.normalize(ref)), 'utf8');
  }

  async deleteSecret(secretId: string): Promise<void> {
    try {
      await fs.unlink(this.fileFor(this.refFor(secretId)));
    } catch {
      // not-found is fine
    }
  }

  /** Normalize a ref to the canonical "/versions/latest" form for lookup. */
  private normalize(ref: string): string {
    if (ref.includes('/versions/')) return ref.replace(/\/versions\/.+$/, '/versions/latest');
    return `${ref}/versions/latest`;
  }
}

/**
 * GCP-backed driver. Loads @google-cloud/secret-manager dynamically so the
 * package is only required when SECRETS_DRIVER=gcp. Read-only token semantics
 * are enforced by the Jira token's own scope, not here.
 */
@Injectable()
export class GcpSecretManager implements SecretManager {
  private readonly project: string;
  // Typed loosely: the client is loaded at runtime to keep it an optional dep.
  private client: any;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.project = config.GCP_PROJECT_ID;
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const mod: any = await import('@google-cloud/secret-manager' as string);
    this.client = new mod.SecretManagerServiceClient();
    return this.client;
  }

  refFor(secretId: string): string {
    return `projects/${this.project}/secrets/${secretId}/versions/latest`;
  }

  async putSecret(secretId: string, value: string): Promise<string> {
    const client = await this.getClient();
    const parent = `projects/${this.project}`;
    const name = `${parent}/secrets/${secretId}`;
    try {
      await client.createSecret({
        parent,
        secretId,
        secret: { replication: { automatic: {} } },
      });
    } catch (err: any) {
      // ALREADY_EXISTS (code 6) is expected on rotation.
      if (err?.code !== 6) throw err;
    }
    await client.addSecretVersion({
      parent: name,
      payload: { data: Buffer.from(value, 'utf8') },
    });
    return this.refFor(secretId);
  }

  async getSecret(ref: string): Promise<string> {
    const client = await this.getClient();
    const name = ref.includes('/versions/') ? ref : `${ref}/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    const data = version?.payload?.data;
    if (!data) throw new Error(`Secret has no payload: ${ref}`);
    return Buffer.from(data).toString('utf8');
  }

  async deleteSecret(secretId: string): Promise<void> {
    const client = await this.getClient();
    try {
      await client.deleteSecret({ name: `projects/${this.project}/secrets/${secretId}` });
    } catch (err: any) {
      if (err?.code !== 5) throw err; // NOT_FOUND is fine
    }
  }
}
