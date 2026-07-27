## Context

QAssistant's specs assumed GCP managed services throughout, but nothing was ever actually deployed (no Dockerfiles, no applied Terraform state). The operator provided a blank Hetzner VPS (CentOS Stream 10, 3.5GB RAM, 38GB disk) and asked for a self-hosted, production-ready deployment with CI/CD, replacing the managed identity provider with plain email/password. Confirmed decisions (asked directly): TLS via a `sslip.io` hostname + Caddy/Let's Encrypt (no domain yet); MinIO for object storage; a Postgres-backed job table + in-process poller for async codegen (no Redis); local nightly `pg_dump` backups only, for now; access tokens live 2 hours, refresh tokens 30 days.

## Goals / Non-Goals

**Goals:**
- Drop every GCP managed-service dependency; run the full stack (Postgres, object storage, API, dashboard) on one VPS via Docker Compose.
- Self-hosted email/password auth preserving the existing role/tenant/provisioning/forced-password-change model exactly, swapping only the backing identity provider.
- Automatic deploy on push to `main`, safe enough to call production-ready at this scale: backup-before-migrate, pinned image tags, health-gated rollout, no application secrets passing through CI/CD.
- Keep the change tightly scoped to what the migration requires — no speculative multi-server HA, no managed identity provider, no off-site backups (all explicitly deferred, see proposal.md Non-goals).

**Non-Goals:**
- Horizontal scaling or multi-instance deployment of the API (a single instance is assumed everywhere, including the codegen poller's locking strategy).
- Zero-downtime blue-green deploys (a VPS this size doesn't have headroom for two full stacks; brief downtime during the container swap is accepted).
- Migrating any existing production data (none exists).

## Decisions

### D1 — Opaque, DB-backed bearer tokens instead of JWT
The request pipeline already does a mandatory per-request `tenant_users` lookup for RLS setup and active-status enforcement (`TransactionInterceptor`), so JWT's core value proposition — avoiding a DB hit — doesn't exist in this codebase. Opaque tokens (random value, only its SHA-256 hash stored) give instant revocation (disable a user → delete/mark rows, no waiting for expiry) and eliminate an entire class of JWT bugs (algorithm confusion, secret rotation, clock skew) for the cost of one indexed lookup, which is negligible next to the RLS transaction already being opened. *Alternative considered*: JWT access + opaque refresh (a common hybrid). Rejected — the request pipeline already pays the DB-hit cost, so the hybrid buys nothing over pure opaque tokens while adding a signing-key lifecycle to manage.

### D2 — Refresh rotation with a grace window, not strict single-use rotation
Strict single-use rotation (revoke-old/mint-new, no exceptions) breaks under a benign double-fire (two extension contexts refreshing near-simultaneously, or a retried network call): the second caller sees an already-revoked token and would otherwise be treated as a theft signal. Mitigation: a revoked-token replay within ~20s of its revocation is treated as a benign race (rejected with a distinct error so the client falls back to whatever token it currently holds, rather than being forced to a full re-login); outside that window, replay is treated as theft and every token for the subject is revoked. *Note*: the server cannot literally "hand back the same new pair" on a race, since only token hashes are stored (never plaintext) — client-side single-flight around refresh calls (implemented in the extension's service worker) is the complementary fix that prevents the race at the source for that client.

### D3 — Secrets: envelope-encrypted Postgres column, not a separate encrypted file store
The current spec says secrets "SHALL NOT" be stored in Postgres, written for a plaintext-exposure threat model. Given a single VPS, an AES-256-GCM-encrypted blob in a Postgres table — with the key held only in the server's `.env`, never in the database — is not meaningfully weaker than a separate encrypted file store, and avoids provisioning, and separately backing up, a second persistent volume just for secrets. This is a deliberate reinterpretation of the requirement's literal wording, recorded here rather than silently reworked. *Alternative considered*: a dedicated encrypted-file-store volume (the original draft). Rejected in favor of reusing the Postgres backup/restore story already required anyway.

### D4 — Postgres-backed job queue + in-process poller, not Redis/BullMQ
Confirmed decision, driven by the 3.5GB RAM budget: a `codegen_jobs` table claimed via `SELECT ... FOR UPDATE SKIP LOCKED` from a poller running inside the API process needs no new container and no new failure mode to operate, at the cost of not being a "real" queue (no pub/sub, no cross-language consumers) — acceptable since the only consumer is this same API.

### D5 — Debian-slim (`node:20-bookworm-slim`), not Alpine, for the API image
`@node-rs/argon2` (and other native deps) has broader, more reliable prebuilt-binary coverage for glibc than musl; pinning Debian-slim now avoids a class of native-dependency build failures across the whole app, not just password hashing.

### D6 — Plain shell scripts for VPS provisioning/deploy, not Ansible
For a single VPS, Docker Compose already provides the declarative, idempotent state management Ansible would otherwise add — a second declarative layer managing largely the same container state. Plain shell (`bootstrap.sh` once, `deploy.sh` per push) has fewer moving parts and is easier to review in a PR. Revisit if a second server is ever added.

### D7 — Runtime image ships full source, not just `dist/`
The migration runner (`db:migrate`) already runs via `tsx` against TypeScript source, not compiled output, and changing that would be a needless divergence from the existing script. The API image therefore includes both the compiled `dist/` (used by `node dist/main.js` for the actual server) and the full `src/` (used only for the one-off `db:migrate` invocation) — simpler than maintaining a second migration-only image at this scale.

## Risks / Trade-offs

- [Losing `SECRETS_ENCRYPTION_KEY` or `DB_PASSWORD` permanently loses the ability to decrypt stored secrets / restore backups] → No off-box backup of `.env` by design (matches the "local backups only" decision); the operator is told explicitly to save a copy outside the VPS.
- [The `deploy` SSH key is root-equivalent once it has `docker` group membership] → Restrict it via `authorized_keys command="..."` to only ever invoke `deploy.sh` (documented exact syntax in `infra/vps/bootstrap.sh`), never an interactive shell.
- [A burst of concurrent logins each running a ~19MB memory-hard argon2id hash could pressure the 3.5GB budget] → Explicit OWASP-baseline params (not library defaults) sized deliberately; revisit if login volume grows.
- [Single-VPS, single-instance assumption baked into the codegen poller's locking and the deploy process] → Acceptable at current scale; `FOR UPDATE SKIP LOCKED` degrades safely (not correctly-but-slowly) if a second instance is ever added, so this would need revisiting before any horizontal scale-out.
- [No off-site backup] → Confirmed, accepted decision; a total VPS/disk loss loses all data. Revisit if this becomes unacceptable.

## Migration Plan

No live data exists, so this is a clean-cut migration, not a phased cutover:
1. DB migration `0009_self_hosted_auth.sql` drops the GCIP columns and adds the new schema in one shot.
2. Code changes (auth, storage, secrets, job queue, DB connectivity, clients) land together in one PR/branch, verified by the full test suite before merge.
3. VPS OS-level bootstrap (`infra/vps/bootstrap.sh`) and the persistent `.env` are set up directly (no PR/review gate applies to provisioning a blank box).
4. Merging the PR to `main` triggers `deploy.yml`, which performs the actual first production rollout (build → push → SSH deploy).

**Rollback**: redeploy the previous git SHA's images (never `:latest`, always pinned); for a bad migration, restore the `pg_dump` taken immediately before it ran (`deploy.sh` always backs up before migrating).

## Open Questions

- None blocking. Follow-ups explicitly deferred (see proposal.md Non-goals): off-site backups, a real domain instead of `sslip.io`, and Ansible/multi-server provisioning if a second VPS is ever added.
