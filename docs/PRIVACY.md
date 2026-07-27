# QAssistant privacy and capture posture

This document states, in plain terms, what QAssistant captures during a QA recording session, why it captures it, how it protects it, how long it keeps it, and the known limits of that protection. It is the canonical reference for the MVP; it reflects the decisions in `TECHNICAL_CHOICES.md` and the OpenSpec `session-capture`, `identity-and-tenancy`, and `qa-dashboards` specs.

QAssistant is multi-tenant. Every tenant's data is isolated at the database layer by PostgreSQL row-level security keyed on the verified `tenantId` claim (see "Tenant isolation" below). Nothing in this document weakens that boundary.

## 1. What is captured, and why

### DOM-replay event stream (source of truth)

The primary artifact of a session is an `rrweb` DOM-replay event stream. This is the authoritative record: it is what the dashboard replays, and it is the primary grounding input for test generation. It records the structure and mutations of the page (the DOM), input events, navigation, and timing, so a reviewer can watch the session back and so the code generator can produce an asserted Playwright test from real interactions.

We capture the DOM stream (rather than only video) because it is the human-watchable and machine-usable record at the same time: it replays for a human reviewer and feeds the generator with selectors and a concrete event timeline.

### Optional viewport-only screenshots

Screenshots are optional and off unless enabled. They are captured viewport-only via `chrome.tabs.captureVisibleTab` (no full-page, no `debugger` permission). There is a project-level default (set by an admin) and a per-session override the tester chooses at session start. Their purpose is to be a quick human-watchable artifact alongside the DOM replay.

### Flags

A tester can flag a selector or state with a hotkey during capture. Flags are stored as codegen hints (selector, optional note, replay offset). They contain only what the tester chooses to flag.

### Work context

Each session is frozen to one project and one work context: either a validated Jira ticket (key, summary, status snapshot) or a non-empty tester description. When a Jira ticket is supplied, QAssistant reads issue metadata, description, comments, and attachments read-only to ground generation. No Jira writes or transitions are ever performed.

### Identity stamping

The recording user (`recorded_by`), tenant, and project are always derived server-side from the verified Identity Platform token and the authorized project. The client never asserts who it is or which tenant it belongs to.

## 2. Default DOM masking

DOM capture masks sensitive content by default. Using `rrweb`'s built-in masking configuration:

- password and token/secret input fields are masked by default;
- additional per-project CSS selectors (`projects.masking_selectors`) are masked or blocked, so a tenant can mask known-sensitive regions of their own app;
- masking is applied at capture time in the content script, so masked values are not written into the DOM-replay stream that leaves the browser.

Masking is on by default. There is no "capture everything unmasked" mode in the MVP. URL allow/deny capture lists and broad PII redaction are explicitly out of scope for the MVP.

## 3. Screenshot limitation (not fully redacted)

Screenshots are treated as sensitive full-image artifacts. The DOM masking described above does **not** apply to screenshots: a screenshot is a picture of the viewport and may show whatever was on screen, including content that DOM masking would have hidden in the replay stream. QAssistant does **not** claim screenshots are redacted. This is why screenshots are optional and off by default. Enable them only when the captured app's viewport content is acceptable to store as-is for the session's retention period.

When screenshots are used as model context and are too large or costly, they are compressed or downsampled before being sent to the model. That is a size/cost step, not a redaction step, and does not change the "not fully redacted" posture.

## 4. Where bytes live, and the upload credential

DOM-replay payloads and screenshots are uploaded to MinIO (S3-compatible object storage) under a tenant/project/session-namespaced path: `s3://<artifacts-bucket>/<tenantId>/<projectId>/<sessionId>/...`. Metadata (size, checksum, sequence, content type) lives in PostgreSQL; bytes live in object storage.

The browser uploads using a per-object V4 signed URL that is `PUT`-only, short-lived (about 15 minutes), and scoped to that session's object path. The client cannot read, list, or delete in the bucket. The backend mints these URLs only after it has authorized the session, and records artifact metadata itself.

## 5. Retention, deletion, and export

### Retention: indefinite by default

Artifacts and session metadata are retained indefinitely by default. There is no automatic time-based expiry in the MVP. Per-tenant or time-based retention policies are out of scope for the MVP.

### Deletion: two-step (soft delete, then 30-day purge)

Deletion is two-step so an accidental delete is recoverable:

1. **Soft delete.** Deleting a session sets `deleted_at` and `purge_at = deleted_at + 30 days`. The session is hidden from normal dashboards but metadata and artifacts remain recoverable. An admin may soft-delete any session in the tenant; a qa-engineer may soft-delete only sessions they recorded. An admin can `restore` during the grace period, clearing `deleted_at`/`purge_at`.
2. **Permanent purge.** A scheduled purge job sweeps sessions whose `purge_at` has passed and, per session, deletes the GCS objects under the session prefix first, then the dependent rows (`generation_comments`, `generated_tests`, `flags`, `artifacts`), then the session row. After purge, the session metadata, GCS artifacts, and generated tests are gone.

### Export

A session can be exported as a ZIP containing a metadata JSON, the DOM-replay stream, screenshots (if any), and generated tests. Admins and any qa-engineer in the tenant can export. Export is read-only and tenant-scoped.

## 6. Secret handling

Secrets are never stored in plaintext in PostgreSQL. Project-level secrets are envelope-encrypted (AES-256-GCM) and stored as an opaque blob; the encrypting key never itself touches the database:

- Jira read-only tokens: encrypted and stored in the `encrypted_secrets` table; the DB row holds only `jira_configs.token_secret_ref`. Rotation overwrites the stored value; the row is unchanged.
- Project default credentials: encrypted the same way; the DB row holds only `projects.default_creds_secret_ref`.
- The Gemini Developer API key is the single standing plaintext secret in the stack. It lives only in the server's persistent `.env` file (never committed, never passed through CI/CD, never written to the database) and is injected at runtime. QAssistant uses the **paid** Gemini Developer API tier so submitted DOM/screenshot context is not used to improve the provider's products.

Before any captured content is sent to a model, known-secret redaction is applied (passwords, tokens, API keys, auth headers, cookies). This is known-secret redaction, not full PII redaction.

The `SECRETS_ENCRYPTION_KEY` used to encrypt project secrets also lives only in the server's `.env`, with no off-box backup by design (matching the "local backups only" operator decision) — losing that key or the VPS disk permanently loses the ability to decrypt stored secrets. The operator is expected to keep a copy of it (and `DB_PASSWORD`) somewhere safe outside the VPS.

## 7. Token revocation

Authorization is carried in an opaque, database-backed bearer access token (2 hour TTL) plus a rotated refresh token (30 day TTL). Because verifying an access token and enforcing `tenant_users.status = 'active'` both already require a database lookup on every request (see section 8's RLS transaction setup), disabling a user, resetting their password, or changing their role revokes every outstanding token for that user **immediately** — there is no wait for token expiry or a refresh cycle, unlike a self-contained signed token would require.

This matters most in the Chrome extension, where the auth tokens (especially the refresh token) are stored in `chrome.storage.local`. That storage is isolated per extension, but the stored refresh token *is* the user's identity: a leaked token allows reading the user's data and tenant-wide session export until the affected account is disabled, at which point access is cut off immediately. This is **not** a write-only credential (the write-only credential is the separate object-storage upload URL).

## 8. Tenant isolation (the floor under everything above)

Every tenant-scoped table carries a non-null `tenant_id` and has PostgreSQL row-level security `ENABLE`d and `FORCE`d with the canonical policy:

```sql
USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
```

The runtime role (`app_user`) is not `BYPASSRLS` and is not the table owner, so the policy binds it. Each request runs in a transaction that sets `app.tenant_id` transaction-locally with `set_config(..., true)`, so a pooled connection cannot leak one tenant's scope into another's request. A request that fails to set the variable matches no rows (deny-by-default) rather than seeing everything. The cross-tenant and missing-variable behavior is verified by the isolation tests under `apps/api/test/`.

See `apps/api/test/E2E.md` for how the tenant-isolation and end-to-end behaviors above are exercised (`apps/api/test/rls-isolation.test.ts` and `apps/api/test/e2e-flow.test.ts`).
