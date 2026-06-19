import { z } from 'zod';

/**
 * Environment schema. Mirrors .env.example. Validated once at boot; missing or
 * malformed values fail fast (design D9 "fail fast").
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GCP_REGION: z.string().default('europe-west1'),
  GCP_PROJECT_ID: z.string().default('main-nima'),
  API_PORT: z.coerce.number().int().positive().default(8080),

  // Database connectivity
  DB_DRIVER: z.enum(['local', 'cloud-sql']).default('local'),
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
  CLOUD_SQL_INSTANCE: z.string().optional(),
  CLOUD_SQL_IP_TYPE: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),

  // Identity Platform / firebase-admin
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().default('main-nima'),

  // GCS
  ARTIFACTS_BUCKET: z.string().default('qassistant-artifacts-local'),
  STORAGE_EMULATOR_HOST: z.string().optional(),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // Storage driver: 'local' mints fake signed URLs (no GCP); 'gcs' uses V4 signing.
  STORAGE_DRIVER: z.enum(['local', 'gcs']).default('local'),
  // Base URL of a local upload sink used only by the 'local' storage driver.
  LOCAL_UPLOAD_BASE_URL: z.string().default('http://127.0.0.1:4443'),

  // Secret Manager: 'local' keeps secrets in a temp dir; 'gcp' uses the API.
  SECRETS_DRIVER: z.enum(['local', 'gcp']).default('local'),
  LOCAL_SECRETS_DIR: z.string().optional(),

  // Jira: 'local' uses an in-memory fixture client; 'http' calls the live REST API.
  JIRA_DRIVER: z.enum(['local', 'http']).default('local'),

  // Shared secret guarding internal worker endpoints (inactivity / purge) in
  // local/dev. In prod these are OIDC-gated at the ingress; this is a backstop.
  INTERNAL_TASK_TOKEN: z.string().default('local-internal-task-token'),

  // Gemini
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL_FLASH: z.string().default('gemini-flash-latest'),
  GEMINI_MODEL_PRO: z.string().default('gemini-pro-latest'),

  // Cloud Tasks. 'inline' runs the codegen worker synchronously in-process
  // (offline dev); 'cloud-tasks' enqueues to a real queue targeting the
  // OIDC-gated worker endpoint.
  CLOUD_TASKS_DRIVER: z.enum(['inline', 'cloud-tasks']).default('inline'),
  CLOUD_TASKS_QUEUE: z.string().default('codegen'),
  CLOUD_TASKS_LOCATION: z.string().default('europe-west1'),
  CLOUD_TASKS_TARGET_BASE_URL: z.string().default('http://127.0.0.1:8080'),
  // Service account the queue uses to mint the OIDC token for the worker call.
  CLOUD_TASKS_INVOKER_SA: z.string().optional(),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>> & {
  readonly isEmulator: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const cfg = parsed.data;
  return Object.freeze({
    ...cfg,
    isEmulator: cfg.DB_DRIVER === 'local' || Boolean(cfg.FIREBASE_AUTH_EMULATOR_HOST),
  });
}
