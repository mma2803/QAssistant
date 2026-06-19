/**
 * Service-layer test harness for the end-to-end flow (task 6.2).
 *
 * Builds the REAL NestJS service objects (no inline SQL) wired to a real
 * Postgres + RLS, with in-memory fakes only at the true external boundaries
 * (Identity Platform / Firebase Admin, GCS, Gemini). Each "request" runs through
 * DbService.withTenant / withSuperadmin exactly like the runtime, so RLS, the
 * transaction-local tenant var, and the role scoping are all exercised by the
 * services themselves rather than re-implemented by the test.
 *
 * Faked boundaries:
 *   - FakeFirebase    : in-memory GCIP users/claims/passwords, inspectable so the
 *                       forced-password-change path can be asserted at the
 *                       authoritative (claim) source, not just the DB mirror.
 *   - InMemoryGcsReader: returns the bytes the test "uploaded" for a gcsPath.
 *   - FakeGeminiClient : the production offline client (asserted Playwright test).
 * Secret Manager / GCS signer / Jira client are no-op fakes: the happy
 * description-path flow never invokes them (proven by the throwing stubs).
 */
import { gzipSync } from 'node:zlib';
import type { Role } from '@qassistant/shared/enums';
import { loadConfig, type AppConfig } from '../../src/config/config.service.js';
import { DbService } from '../../src/db/db.service.js';
import { RequestContext } from '../../src/auth/request-context.js';
import type { FirebaseService } from '../../src/auth/firebase.service.js';
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

/** In-memory GCIP record for one user. */
interface FakeUser {
  uid: string;
  gcipTenantId: string | null;
  email: string;
  password: string;
  disabled: boolean;
  claims: Record<string, unknown>;
}

/**
 * In-memory stand-in for the Firebase Admin SDK. Implements exactly the methods
 * the services call, recording claims/passwords so the test can assert GCIP-side
 * effects (e.g. mustChangePassword cleared on the claim, not just the DB mirror).
 */
export class FakeFirebase {
  private readonly users = new Map<string, FakeUser>();
  private readonly tenants = new Set<string>();
  private seq = 0;

  private nextUid(): string {
    this.seq += 1;
    return `fake-uid-${this.seq}`;
  }

  getUserByUid(uid: string): FakeUser | undefined {
    return this.users.get(uid);
  }

  async createGcipTenant(displayName: string): Promise<string> {
    const id = `gcip-${displayName.replace(/\W+/g, '').slice(0, 8)}-${++this.seq}`;
    this.tenants.add(id);
    return id;
  }

  async createTenantUser(params: {
    gcipTenantId: string;
    appTenantId: string;
    email: string;
    password: string;
    role: Role;
  }): Promise<string> {
    const uid = this.nextUid();
    this.users.set(uid, {
      uid,
      gcipTenantId: params.gcipTenantId,
      email: params.email,
      password: params.password,
      disabled: false,
      claims: { role: params.role, tenantId: params.appTenantId, mustChangePassword: true },
    });
    return uid;
  }

  async setTenantUserPassword(_gcipTenantId: string, uid: string, password: string): Promise<void> {
    this.mustExist(uid).password = password;
  }

  async clearMustChangePassword(
    _gcipTenantId: string,
    uid: string,
    appTenantId: string,
    role: Role,
  ): Promise<void> {
    // Mirrors the real method: re-applies role/tenantId and drops the marker.
    this.mustExist(uid).claims = { role, tenantId: appTenantId };
  }

  async setTenantUserRole(
    _gcipTenantId: string,
    uid: string,
    appTenantId: string,
    role: Role,
  ): Promise<void> {
    const u = this.mustExist(uid);
    u.claims = { ...u.claims, role, tenantId: appTenantId };
  }

  async setTenantUserDisabled(_gcipTenantId: string, uid: string, disabled: boolean): Promise<void> {
    this.mustExist(uid).disabled = disabled;
  }

  async resetTenantUserPassword(
    _gcipTenantId: string,
    uid: string,
    appTenantId: string,
    role: Role,
    password: string,
  ): Promise<void> {
    const u = this.mustExist(uid);
    u.password = password;
    u.claims = { role, tenantId: appTenantId, mustChangePassword: true };
  }

  private mustExist(uid: string): FakeUser {
    const u = this.users.get(uid);
    if (!u) throw new Error(`FakeFirebase: unknown uid ${uid}`);
    return u;
  }
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
  firebase: FakeFirebase;
  reader: InMemoryGcsReader;
  signer: GcsSigner;
  secrets: SecretManager;
  jira: JiraClient;
  gemini: FakeGeminiClient;
  worker: CodegenWorkerService;
  dispatcher: InlineCloudTasksDispatcher;
  /** Run `work` as a tenant user inside a real RLS-scoped request transaction. */
  asTenant<T>(identity: TenantIdentity, work: (ctx: RequestContext) => Promise<T>): Promise<T>;
  /** As the firebase service type the real services expect. */
  firebaseAs(): FirebaseService;
  close(): Promise<void>;
}

/** Build the harness: real DbService + real services wiring, fake boundaries. */
export async function buildHarness(): Promise<Harness> {
  const config = loadConfig(process.env);
  const db = new DbService(config);
  await db.init();

  const firebase = new FakeFirebase();
  const reader = new InMemoryGcsReader();
  const gemini = new FakeGeminiClient(config);

  // Real worker wired to the real DbService + fakes; the inline dispatcher runs
  // it synchronously, exactly like the dev CLOUD_TASKS_DRIVER=inline path.
  const worker = new CodegenWorkerService(db, reader, noopSecrets, throwingJira, gemini);
  const dispatcher = new InlineCloudTasksDispatcher((payload) => worker.runTask(payload));

  const firebaseAs = (): FirebaseService => firebase as unknown as FirebaseService;

  async function asTenant<T>(
    identity: TenantIdentity,
    work: (ctx: RequestContext) => Promise<T>,
  ): Promise<T> {
    return db.withTenant(identity.tenantId, async ({ db: tx }) => {
      const ctx = new RequestContext();
      ctx.uid = identity.uid;
      ctx.role = identity.role;
      ctx.tenantId = identity.tenantId;
      ctx.actingUserId = identity.actingUserId;
      ctx.mustChangePassword = identity.mustChangePassword ?? false;
      ctx.dbTx = tx;
      return work(ctx);
    });
  }

  return {
    config,
    db,
    firebase,
    reader,
    signer: throwingSigner,
    secrets: noopSecrets,
    jira: throwingJira,
    gemini,
    worker,
    dispatcher,
    asTenant,
    firebaseAs,
    async close() {
      await db.onModuleDestroy();
    },
  };
}
