# QAssistant

QAssistant is a greenfield, multi-tenant QA capture platform. It records manual web testing sessions, stores the replayable evidence, generates Playwright automation, and gives QA managers tenant-scoped visibility.

> **QA manager?** See the benefit-first product pitch → [`docs/qa-managers/README.md`](docs/qa-managers/README.md)

## Current State

The OpenSpec change at `openspec/changes/archive/2026-06-23-qassistant-mvp` records the original MVP decisions and the API/data-model contract; `openspec/changes/archive/2026-07-27-self-hosted-vps-migration` records the move off GCP to a self-hosted VPS. The application code exists: a NestJS API, a React dashboard, a Chrome MV3 extension, an MCP server, a shared TypeScript package, and the self-hosted infra (Docker Compose + Caddy + GitHub Actions). See `openspec/changes/archive/2026-06-23-qassistant-mvp/data-model-and-api-contract.md` for the authoritative schema and REST surface, and `openspec/specs/platform-infrastructure/spec.md` / `openspec/specs/identity-and-tenancy/spec.md` for the current infrastructure and auth requirements.

For the privacy and capture posture (what is captured, masking, screenshots, retention, deletion, secrets), see [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Operator Promise

The target operator input is: a blank VPS with SSH access, plus a `main`-branch push to deploy.

```bash
ssh root@<vps-ip> 'bash -s' < infra/vps/bootstrap.sh   # once, on a blank box
```

`bootstrap.sh` installs Docker, configures the firewall, and creates a dedicated deploy user. After the remaining one-time manual steps it prints (generating the persistent `.env`, restricting the deploy SSH key, adding GitHub Actions secrets), every push to `main` deploys automatically via `.github/workflows/deploy.yml`.

## Repo Layout

```text
apps/api/                 NestJS backend API (Drizzle + RLS); tests in apps/api/test
apps/dashboard/           React + Vite dashboard SPA
apps/extension/           Chrome MV3 extension (Vite + @crxjs, rrweb capture)
apps/mcp/                 MCP server (stdio): exposes records + generated code to MCP clients, records integration outcomes; never pushes to Git
packages/shared/          Shared zod schemas, enum constants, and inferred types
infra/docker/             Dockerfiles (api, web/dashboard+Caddy) and the Caddyfile
infra/docker-compose.prod.yml  Production stack: postgres, minio, api, web
infra/vps/                bootstrap.sh (one-time OS setup), deploy.sh (CI/CD entrypoint), backup.sh (nightly pg_dump)
infra/local/              docker-compose dev config (postgres roles)
docs/PRIVACY.md           Privacy and capture posture
.github/workflows/        ci.yml (lint/typecheck/test/e2e), deploy.yml (build+push+deploy on push to main)
openspec/                 OpenSpec proposal, design, specs, contract, and tasks
docker-compose.yml        Local dev services (postgres + minio)
```

This is an npm-workspaces monorepo (`apps/*`, `packages/*`), TypeScript throughout, Node 20+. Local development runs against docker-compose (`npm run dev:infra`). Backend tests live in `apps/api/test` (`npm test -w @qassistant/api`); see `apps/api/test/E2E.md`.

## Running locally

Prerequisites: Node 20 (`.nvmrc`) and Docker.

```bash
npm install
cp .env.example .env

# 1) Postgres + MinIO
npm run dev:infra

# 2) Load env into THIS shell. The app reads process.env directly and does NOT
#    auto-load .env (no dotenv).
set -a; . ./.env; set +a          # or run each command with `node --env-file=.env`

# 3) Backend
npm run db:migrate -w @qassistant/api
npm run seed:super-admin -w @qassistant/api    # first super-admin (no UI path)
npm run start:dev -w @qassistant/api           # API on http://127.0.0.1:8080 (/api/v1)

# 4) Dashboard (new terminal; re-run the `set -a; . ./.env; set +a` line first)
# The proxy target defaults to the hosted VPS; override it to hit the local API.
VITE_API_PROXY_TARGET=http://127.0.0.1:8080 \
  npm run dev -w @qassistant/dashboard         # http://localhost:5173, proxies /api -> :8080

# 5) Extension (Chrome MV3)
npm run build -w @qassistant/extension         # then chrome://extensions ->
                                               # Developer mode -> Load unpacked -> apps/extension/dist
```

Sign-in flow: the seeded super-admin creates a tenant (with a slug) + first admin; admins create qa-engineers; first login forces a password change. The offline drivers (`STORAGE_DRIVER=local`, `SECRETS_DRIVER=local`, `JIRA_DRIVER=local`, `CLOUD_TASKS_DRIVER=inline`, fake Gemini when `GEMINI_API_KEY` is empty) need no external services at all beyond Postgres. Per-app run notes: [`apps/api/README.md`](apps/api/README.md), [`apps/dashboard/README.md`](apps/dashboard/README.md), [`apps/extension/README.md`](apps/extension/README.md), [`apps/mcp/README.md`](apps/mcp/README.md). Backend tests need only a reachable Postgres: `npm test -w @qassistant/api`.

## End-to-end verification

With Docker and Google Chrome installed, run the complete OpenSpec-linked E2E gate:

```bash
npm run test:e2e
```

The command starts and waits for Postgres + MinIO, runs Playwright against
the dashboard and built extension popup, runs the production-compiled Nest HTTP
flow plus service/RLS suites, verifies every declared controller route was
exercised, and regenerates `docs/e2e-coverage/` only after success.

## Deploying to a self-hosted VPS

Prerequisites: a VPS with SSH access, a GitHub repo with Actions enabled.

```bash
ssh root@<vps-ip> 'bash -s' < infra/vps/bootstrap.sh
```

Follow the manual steps it prints (persistent `.env` with generated secrets, restricted deploy SSH key, GitHub Actions secrets `DEPLOY_SSH_HOST`/`DEPLOY_SSH_USER`/`DEPLOY_SSH_KEY`, a `backup.sh` cron entry). From then on, pushing to `main` runs `.github/workflows/deploy.yml`: it builds and pushes the `api`/`web` images to GHCR, then SSHes in to run `infra/vps/deploy.sh`, which syncs config from git, backs up Postgres, applies migrations, and rolls out the new images behind Caddy (automatic HTTPS).

## Key Decisions

- Language/runtime: TypeScript for API, dashboard, extension, and shared schemas.
- Operational datastore: self-hosted PostgreSQL (the app's own Docker container), with row-level security keyed off the verified `tenantId` as the tenant-isolation floor.
- Artifacts: MinIO (S3-compatible) with tenant/project/session object paths.
- Identity: self-hosted email/password auth — opaque, DB-backed bearer tokens (argon2id password hashing, 2h access / 30d rotated refresh tokens, instant revocation on disable/reset); admin-created accounts, no self-registration, forced password change on first login.
- AI: Gemini Developer API (paid tier) with the API key from the server's persistent `.env`; model IDs supplied as config.
- Async codegen: a Postgres-backed job table with an in-process polling worker (no Redis).
- Infrastructure: Docker Compose on a single VPS, Caddy reverse proxy with automatic HTTPS, GitHub Actions CI/CD.
