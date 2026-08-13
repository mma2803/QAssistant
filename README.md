# QAssistant

QAssistant turns manual QA testing into reusable automated tests. A tester runs
through a scenario in their browser as usual; QAssistant records the real session (the
page, the network calls, screenshots), and an AI turns that recording into an automated
test (e.g. Playwright) the team can run again and again. A web dashboard gives each
organisation a clear, role-scoped view of its recordings, generated tests, and activity.

> **QA manager?** For the benefit-first product tour, see
> [`docs/qa-managers/README.md`](docs/qa-managers/README.md).

## How it works

1. **Record.** A tester picks a project, adds a short description of what they're testing,
   and runs their scenario while a Chrome extension captures the session (DOM via rrweb,
   network traffic, optional screenshots) and streams it to the backend.
2. **Review & generate.** In the dashboard you open a recording and let the AI generate
   an automated test from it, choosing the test type (UI or back-end), the framework, and
   the language. Iterate with instructions until it's right, then approve the version you
   want.
3. **Integrate.** An MCP server exposes the approved tests to an AI coding client
   (e.g. Claude Code), which adds the test to your repository and runs it. A test is
   kept only if it actually passes.

Everything is **multi-tenant**: each client is an isolated organisation, and data is
separated per organisation at the database level (row-level security).

## Cloud or Local?

You can use QAssistant two ways. It's the same application; only *where it runs*
differs. Pick whichever fits you:

| | ☁️ QAssistant Cloud (hosted) | 💻 QAssistant Local (self-hosted) |
|---|---|---|
| **Best for** | Teams who just want to use it | Running it on your own infrastructure, or developing it |
| **Setup** | Nothing to install: use a signup link to create your organisation, then sign in | Clone the repo, Docker + Node, run the stack yourself |
| **Where your data lives** | On our server (the VPS) | On your own machine/server |
| **AI test generation** | Ready out of the box | Works offline with a fake generator; set `GEMINI_API_KEY` for real generation |
| **Updates & backups** | Handled for you (auto-deploy) | You update, deploy, and back up yourself |
| **Chrome extension** | Load it into Chrome | Build it, then load it into Chrome |
| **Upsides** | Ready in minutes, nothing to maintain, always up to date | Full control of your infra and data, works offline, no dependency on us |
| **Trade-offs** | Data sits on our server; you depend on our hosted instance | You set up, maintain, and back it up; real AI generation needs your own Gemini key |

**The Chrome extension** (used to record sessions) is installed the same way in both
modes: build it, then load it into Chrome via `chrome://extensions` → Developer mode →
Load unpacked → `apps/extension/dist`. There's no one-click Web Store install yet. The
only difference is the backend the build targets: it defaults to the hosted instance
(Cloud), or you set `VITE_API_BASE_URL` to your local API (Local). See
[`apps/extension/README.md`](apps/extension/README.md).


## QAssistant Cloud (hosted)

The hosted instance runs on our server and is ready to use, at
**https://135-181-104-90.sslip.io/**.

**Roles in your organisation.**
- **Admin:** runs your organisation (projects, team members, recordings).
- **QA engineer:** records sessions and reviews recordings and generated tests.

**Getting access.** There's no public self-signup: your organisation is set up by the
platform operator, who sends you a **signup link**. Use it once to create your
organisation and its first admin (name + email + password), then sign in with your
**email**, **password**, and **organisation identifier** (a short slug). The first admin
adds testers from the **Users** screen.

Recording, reviewing, generating, and integrating then work as in
[How it works](#how-it-works) above. The interface is in **English or French**, following
your browser language (with a manual switch in the top bar).

## QAssistant Local (run it yourself)

Run the whole stack on your own machine, to develop QAssistant or to try it without the
hosted instance. It's an npm-workspaces monorepo, TypeScript throughout, Node 20+, backed
by docker-compose.

Prerequisites: Node 20 (`.nvmrc`) and Docker.

```bash
npm install
cp .env.example .env

# 1) Postgres + MinIO
npm run dev:infra

# 2) Load env into THIS shell (the app reads process.env directly; no dotenv).
set -a; . ./.env; set +a          # or run each command with `node --env-file=.env`

# 3) Backend
npm run db:migrate -w @qassistant/api
npm run seed:super-admin -w @qassistant/api    # first super-admin (no UI path)
npm run start:dev -w @qassistant/api           # API on http://127.0.0.1:8080 (/api/v1)

# 4) Dashboard (new terminal; re-run the `set -a; . ./.env; set +a` line first)
VITE_API_PROXY_TARGET=http://127.0.0.1:8080 \
  npm run dev -w @qassistant/dashboard         # http://localhost:5173, proxies /api to :8080

# 5) Extension (Chrome MV3) — build it pointing at your LOCAL API, then load it.
#    Without VITE_API_BASE_URL the build targets the hosted instance, not localhost.
VITE_API_BASE_URL=http://127.0.0.1:8080 npm run build -w @qassistant/extension
# chrome://extensions -> Developer mode -> Load unpacked -> apps/extension/dist
```

The offline drivers (`STORAGE_DRIVER=local`, `SECRETS_DRIVER=local`,
`CLOUD_TASKS_DRIVER=inline`, and a fake AI client when `GEMINI_API_KEY` is empty) need
nothing beyond Postgres. Per-app notes: [`apps/api`](apps/api/README.md),
[`apps/dashboard`](apps/dashboard/README.md), [`apps/extension`](apps/extension/README.md),
[`apps/mcp`](apps/mcp/README.md).

Run the full end-to-end gate (Postgres + MinIO + Playwright + the HTTP/RLS suites) with:

```bash
npm run test:e2e            # backend-only tests: npm test -w @qassistant/api
```

## Self-hosting your own instance

To stand up your own production instance (this is how QAssistant Cloud itself is
deployed), see [`infra/`](infra/): `infra/vps/bootstrap.sh` provisions a blank VPS and
`.github/workflows/deploy.yml` deploys on every push to `main`. The operator of an
instance is its **super-admin** (seeded with `npm run seed:super-admin`), who creates
organisations and issues the signup links that onboard each client.

## Repo layout

```text
apps/api/          NestJS backend API (Drizzle + PostgreSQL row-level security)
apps/dashboard/    React + Vite dashboard (the web app you sign in to)
apps/extension/    Chrome MV3 extension (rrweb capture) used to record sessions
apps/mcp/          MCP server: exposes recordings + generated tests to AI clients,
                   records integration outcomes (never pushes to Git itself)
packages/shared/   Shared zod schemas, enums, and TypeScript types
infra/             Dockerfiles, Caddyfile, docker-compose, and VPS bootstrap/deploy/backup
openspec/          Specifications, design, and change history (source of truth)
docs/              Privacy posture, QA-manager tour, and capture/replay notes
```

## How it's built

- **TypeScript** across the API, dashboard, extension, and shared schemas.
- **PostgreSQL** (self-hosted) with **row-level security** keyed off the verified
  `tenantId` as the tenant-isolation floor; **MinIO** (S3-compatible) for artifacts.
- **Self-hosted email/password auth**: opaque, DB-backed bearer tokens (argon2id
  hashing, 2h access / 30d rotated refresh, instant revocation). Accounts are created by
  a super-admin or admin (directly or via a signup link), so there is no *open*
  self-registration. Passwords require upper/lower/digit/special, min 8 characters.
- **AI codegen** via the Gemini Developer API (key from the server's `.env`), run through
  a Postgres-backed job queue with an in-process worker (no Redis). Test **integration**
  into your repo is done by an AI client over the MCP server.
- **Infrastructure**: Docker Compose on a single VPS, Caddy reverse proxy with automatic
  HTTPS, GitHub Actions CI/CD.

For what is captured, masking, retention, and deletion, see
[`docs/PRIVACY.md`](docs/PRIVACY.md).
