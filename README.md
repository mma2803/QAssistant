# QAssistant

QAssistant is a greenfield, multi-tenant QA capture platform. It records manual web testing sessions, stores the replayable evidence, generates Playwright automation, and gives QA managers tenant-scoped visibility.

## Current State

The OpenSpec change at `openspec/changes/qassistant-mvp` records the MVP decisions and the API/data-model contract. The MVP application code now exists: a NestJS API, a React dashboard, a Chrome MV3 extension, a shared TypeScript package, and the Terraform stack. See `openspec/changes/qassistant-mvp/data-model-and-api-contract.md` for the authoritative schema and REST surface.

For the privacy and capture posture (what is captured, masking, screenshots, retention, deletion, secrets, and the ~1h revocation gap), see [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Operator Promise

The target operator input is:

```bash
scripts/bootstrap-gcp.sh <gcp-project-id>
```

The bootstrap uses the active Google account through `gcloud`. It can create/select the project, link billing interactively when needed, enable required APIs, create the Terraform state bucket, and write local Terraform input files. After that, Terraform owns the cloud resources.

## Repo Layout

```text
apps/api/                NestJS backend API (Drizzle + RLS); tests in apps/api/test
apps/dashboard/          React + Vite dashboard SPA
apps/extension/          Chrome MV3 extension (Vite + @crxjs, rrweb capture)
packages/shared/         Shared zod schemas, enum constants, and inferred types
infra/terraform/         GCP managed-service stack
infra/local/             docker-compose emulator config (postgres roles, firebase, gcs)
docs/PRIVACY.md          Privacy and capture posture
scripts/bootstrap-gcp.sh One-time gcloud bootstrap from project ID
openspec/                OpenSpec proposal, design, specs, contract, and tasks
docker-compose.yml       Local emulators (postgres + firebase-auth + fake-gcs)
```

This is an npm-workspaces monorepo (`apps/*`, `packages/*`), TypeScript throughout, Node 20+. Local development runs against the docker-compose emulators (`npm run dev:infra`). Backend tests live in `apps/api/test` (`npm test -w @qassistant/api`); see `apps/api/test/E2E.md`.

## Running locally

Prerequisites: Node 20 (`.nvmrc`) and Docker (for the emulators).

```bash
npm install
cp .env.example .env

# 1) Emulators: Postgres (+ app roles) + Firebase Auth + fake-gcs
npm run dev:infra

# 2) Load env into THIS shell. The app reads process.env directly and does NOT
#    auto-load .env (no dotenv); without the emulator hosts set, firebase-admin
#    falls back to real GCP credentials and fails locally.
set -a; . ./.env; set +a          # or run each command with `node --env-file=.env`

# 3) Backend
npm run db:migrate -w @qassistant/api
npm run seed:super-admin -w @qassistant/api    # first super-admin (no UI path)
npm run start:dev -w @qassistant/api           # API on http://127.0.0.1:8080 (/api/v1)

# 4) Dashboard (new terminal; re-run the `set -a; . ./.env; set +a` line first)
npm run dev -w @qassistant/dashboard           # http://localhost:5173, proxies /api -> :8080

# 5) Extension (Chrome MV3)
npm run build -w @qassistant/extension         # then chrome://extensions ->
                                               # Developer mode -> Load unpacked -> apps/extension/dist
```

Sign-in flow: the seeded super-admin creates a tenant + first admin; admins create qa-engineers; first login forces a password change. The offline drivers (`STORAGE_DRIVER=local`, `SECRETS_DRIVER=local`, `JIRA_DRIVER=local`, `CLOUD_TASKS_DRIVER` inline, fake Gemini when `GEMINI_API_KEY` is empty) need no cloud access. Per-app run notes: [`apps/api/README.md`](apps/api/README.md), [`apps/dashboard/README.md`](apps/dashboard/README.md), [`apps/extension/README.md`](apps/extension/README.md). Backend tests need only a reachable Postgres: `npm test -w @qassistant/api`.

## End-to-end verification

With Docker and Google Chrome installed, run the complete OpenSpec-linked E2E gate:

```bash
npm run test:e2e
```

The command starts and waits for the local emulators, runs Playwright against
the dashboard and built extension popup, runs the production-compiled Nest HTTP
flow plus service/RLS suites, verifies every declared controller route was
exercised, and regenerates `docs/e2e-coverage/` only after success.

## Deploying to GCP

Prerequisites: Google Cloud CLI and Terraform.

```bash
scripts/bootstrap-gcp.sh my-qassistant-project
cd infra/terraform
terraform init
terraform plan
terraform apply
```

The initial Terraform creates managed foundations and placeholder Cloud Run services. Replace the placeholder images with real API/dashboard images once application code exists.

## Key Decisions

- Language/runtime: TypeScript for API, dashboard, extension, and shared schemas.
- Operational datastore: Cloud SQL PostgreSQL, with row-level security keyed off the verified `tenantId` claim as the tenant-isolation floor.
- Artifacts: GCS with tenant/project/session object paths.
- Identity: GCP Identity Platform multi-tenancy (one GCIP tenant per app tenant) with the email/password provider; admin-created accounts, no self-registration, and forced password change on first login.
- AI: Gemini Developer API (paid tier) with the API key in Secret Manager; model IDs supplied as config.
- Infrastructure: gcloud bootstrap plus Terraform-managed GCP services.
