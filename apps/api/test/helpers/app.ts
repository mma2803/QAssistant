/**
 * Service-layer test harness for the end-to-end flow (task 6.2).
 *
 * Builds the REAL NestJS service objects (no inline SQL) wired to a real
 * Postgres + RLS, with in-memory fakes only at the true external boundaries
 * (GCS, Gemini). Auth (PasswordService/TokenService/IdentityService) is no
 * longer an external boundary to fake — it is self-hosted, backed by the same
 * Postgres the tests already use, so the harness wires the REAL identity
 * services. Each "request" runs through DbService.withTenant / withSuperadmin
 * exactly like the runtime, so RLS, the transaction-local tenant var, and the
 * role scoping are all exercised by the services themselves rather than
 * re-implemented by the test.
 *
 * Faked boundaries:
 *   - InMemoryGcsReader: returns the bytes the test "uploaded" for a gcsPath.
 *   - FakeGeminiClient : the production offline client (asserted Playwright test).
 * Secret Manager / GCS signer / Jira client are no-op fakes: the happy
 * description-path flow never invokes them (proven by the throwing stubs).
 */
import { gzipSync } from 'node:zlib';
import { loadConfig, type AppConfig } from '../../src/config/config.service.js';
import { DbService } from '../../src/db/db.service.js';
import { RequestContext } from '../../src/auth/request-context.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { IdentityService } from '../../src/auth/identity.service.js';
import type { GcsReader } from '../../src/storage/gcs-reader.service.js';
import type { GcsSigner } from '../../src/storage/gcs-signer.service.js';
import type { SecretManager } from '../../src/secrets/secret-manager.service.js';
import type { JiraClient } from '../../src/jira/jira-client.service.js';
import { FakeGeminiClient } from '../../src/codegen/gemini.service.js';
import { InlineCloudTasksDispatcher } from '../../src/codegen/cloud-tasks.service.js';
import { CodegenWorkerService } from '../../src/codegen/codegen-worker.service.js';

/** Verified-identity inputs for a tenant-scoped "request". */
export interface TenantIdentity {
  uid: string;
  role: 'admin' | 'qa-engineer';
  tenantId: string;
  actingUserId: string;
  mustChangePassword?: boolean;
}

/** In-memory GcsReader: serves bytes the test placed for a gcsPath. */
export class InMemoryGcsReader implements GcsReader {
  private readonly store = new Map<string, Buffer>();

  put(gcsPath: string, bytes: Buffer): void {
    this.store.set(gcsPath, bytes);
  }

  /** Convenience: store an rrweb-style event array as a gzipped dom_chunk. */
  putDomChunk(gcsPath: string, events: unknown[]): void {
    this.store.set(gcsPath, gzipSync(Buffer.from(JSON.stringify(events), 'utf8')));
  }

  async download(gcsPath: string): Promise<Buffer | null> {
    return this.store.get(gcsPath) ?? null;
  }
}

/** Fakes for boundaries the happy description-path flow must never touch. */
const throwingSigner: GcsSigner = {
  signUpload() {
    throw new Error('GcsSigner should not be called in the description-path flow');
  },
};
const noopSecrets: SecretManager = {
  async putSecret() {
    throw new Error('SecretManager should not be called in this flow');
  },
  async getSecret() {
    throw new Error('SecretManager should not be called in this flow');
  },
  async deleteSecret() {
    throw new Error('SecretManager should not be called in this flow');
  },
  refFor(secretId: string) {
    return `local://${secretId}`;
  },
};
const throwingJira: JiraClient = {
  async getIssue() {
    throw new Error('JiraClient should not be called in the description-path flow');
  },
  async getIssueContext() {
    throw new Error('JiraClient should not be called in the description-path flow');
  },
};

export interface Harness {
  config: AppConfig;
  db: DbService;
  password: PasswordService;
  tokens: TokenService;
  identity: IdentityService;
  reader: InMemoryGcsReader;
  signer: GcsSigner;
  secrets: SecretManager;
  jira: JiraClient;
  gemini: FakeGeminiClient;
  worker: CodegenWorkerService;
  dispatcher: InlineCloudTasksDispatcher;
  /** Run `work` as a tenant user inside a real RLS-scoped request transaction. */
  asTenant<T>(identity: TenantIdentity, work: (ctx: RequestContext) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Build the harness: real DbService + real services wiring, fake boundaries. */
export async function buildHarness(): Promise<Harness> {
  const config = loadConfig(process.env);
  const db = new DbService(config);
  await db.init();

  const password = new PasswordService();
  const tokens = new TokenService(config, db);
  const identity = new IdentityService(db, password, tokens);
  const reader = new InMemoryGcsReader();
  const gemini = new FakeGeminiClient(config);

  // Real worker wired to the real DbService + fakes; the inline dispatcher runs
  // it synchronously, exactly like the dev CLOUD_TASKS_DRIVER=inline path.
  const worker = new CodegenWorkerService(db, reader, noopSecrets, throwingJira, gemini);
  const dispatcher = new InlineCloudTasksDispatcher((payload) => worker.runTask(payload));

  async function asTenant<T>(
    identityCtx: TenantIdentity,
    work: (ctx: RequestContext) => Promise<T>,
  ): Promise<T> {
    return db.withTenant(identityCtx.tenantId, async ({ db: tx }) => {
      const ctx = new RequestContext();
      ctx.uid = identityCtx.uid;
      ctx.role = identityCtx.role;
      ctx.tenantId = identityCtx.tenantId;
      ctx.actingUserId = identityCtx.actingUserId;
      ctx.mustChangePassword = identityCtx.mustChangePassword ?? false;
      ctx.dbTx = tx;
      return work(ctx);
    });
  }

  return {
    config,
    db,
    password,
    tokens,
    identity,
    reader,
    signer: throwingSigner,
    secrets: noopSecrets,
    jira: throwingJira,
    gemini,
    worker,
    dispatcher,
    asTenant,
    async close() {
      await db.onModuleDestroy();
    },
  };
}
