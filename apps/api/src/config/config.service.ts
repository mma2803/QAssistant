import { z } from 'zod';

/**
 * Environment schema. Mirrors .env.example. Validated once at boot; missing or
 * malformed values fail fast (design D9 "fail fast").
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(8080),

  // Database connectivity (self-hosted Postgres — the app's own container in
  // prod, docker-compose in dev; no managed-DB driver).
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('qassistant'),
  DB_USER: z.string().default('app_user'),
  DB_PASSWORD: z.string().default('app_user_pw'),
  DB_SUPERADMIN_USER: z.string().default('app_superadmin'),
  DB_SUPERADMIN_PASSWORD: z.string().default('app_superadmin_pw'),
  DB_MIGRATOR_USER: z.string().default('app_migrator'),
  DB_MIGRATOR_PASSWORD: z.string().default('app_migrator_pw'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Self-hosted auth (opaque bearer tokens, see auth/token.service.ts).
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(7200),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  // Secrets: envelope encryption key for the 'postgres' SecretManager driver
  // (32 bytes, base64). Never itself stored in the database.
  SECRETS_DRIVER: z.enum(['local', 'postgres']).default('local'),
  SECRETS_ENCRYPTION_KEY: z.string().optional(),
  LOCAL_SECRETS_DIR: z.string().optional(),

  // Object storage: 'local' mints fake signed URLs (no dependency); 's3' uses
  // an S3-compatible endpoint (MinIO in prod) with real presigned URLs.
  ARTIFACTS_BUCKET: z.string().default('qassistant-artifacts-local'),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_UPLOAD_BASE_URL: z.string().default('http://127.0.0.1:4443'),
  S3_ENDPOINT: z.string().optional(),
  // Browser-reachable S3 endpoint used ONLY when minting presigned upload URLs.
  // In prod MinIO is internal (S3_ENDPOINT=http://minio:9000, unreachable from a
  // browser), so presigned PUT URLs must carry a public host that Caddy proxies
  // back to MinIO (e.g. https://storage.<site>). Server-side reads/deletes keep
  // using S3_ENDPOINT (internal). Falls back to S3_ENDPOINT when unset (local dev,
  // where MinIO is directly reachable).
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Jira: 'local' uses an in-memory fixture client; 'http' calls the live REST API.
  JIRA_DRIVER: z.enum(['local', 'http']).default('local'),

  // Shared secret guarding internal worker endpoints (inactivity / purge) in
  // local/dev, and the Cloud-Tasks-worker-endpoint compatibility path.
  INTERNAL_TASK_TOKEN: z.string().default('local-internal-task-token'),

  // Gemini
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL_FLASH: z.string().default('gemini-flash-latest'),
  GEMINI_MODEL_PRO: z.string().default('gemini-pro-latest'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // Async codegen queue. 'inline' runs the worker synchronously in-process
  // (tests/dev). 'postgres' enqueues to codegen_jobs; CodegenPollerService
  // claims and runs it in-process (self-hosted VPS migration; replaces Cloud
  // Tasks — no separate worker container or Redis).
  CLOUD_TASKS_DRIVER: z.enum(['inline', 'postgres']).default('inline'),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return Object.freeze(parsed.data);
}
