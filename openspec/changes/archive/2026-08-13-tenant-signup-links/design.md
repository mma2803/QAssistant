## Context

Tenant provisioning is a `@SuperAdminOnly()` path: `AdminService.createTenant`
opens a `withSuperadmin` (BYPASSRLS) transaction, inserts the `tenants` row with
a slug from `uniqueSlug()`, then creates the first admin via
`IdentityService.createTenantUser`. The self-hosted auth model already stores
only SHA-256 hashes of bearer tokens (`auth_tokens`) and never the plaintext.
This change reuses both patterns: a link's token is an opaque secret whose hash
is the only thing persisted, and redemption runs on the same privileged,
tenant-less path as direct creation.

## Goals / Non-Goals

**Goals:**
- Add a super-admin-issued, reusable, expiring signup link that delegates tenant
  + first-admin creation without weakening the super-admin-as-root-of-trust
  model.
- Keep the existing direct creation path byte-for-byte unchanged as the
  fallback.
- Reuse the existing token-hashing and privileged-transaction patterns rather
  than inventing new ones.

**Non-Goals:**
- Single-use links, email delivery, an approval step, and a dedicated
  rate-limiting layer (all deferred — see proposal Non-Goals).

## Decisions

### D1 — Reusable links, not single-use
A signup link is a long-lived onboarding credential: one link handed to a
partner or an internal onboarding channel can provision several client tenants
over its lifetime. It is bounded by an **expiry** and by **manual revocation**,
not by a use count. Consequence: the link row has no `used_at`; instead each
created tenant records the link it came from (`tenants.created_via_invitation_id`,
nullable) so the super-admin can see how many tenants a link produced. Direct
creation leaves that column null.

### D2 — Store only the token hash; plaintext returned once
The token is 32 random bytes, URL-safe base64. Only its SHA-256 hash is stored
in `tenant_invitations.token_hash` (unique), identical to the `auth_tokens`
posture. The plaintext URL is returned exactly once, in the issue response, and
the dashboard shows a copy-once affordance. There is no way to recover the URL
later — the super-admin re-issues if it is lost.

### D3 — Public validate + redeem endpoints, gated only by the token
Redemption must work for a signed-out recipient, so `GET /signup/:token` and
`POST /signup` are `@Public()`. `GET /signup/:token` returns only
`{ valid, expiresAt }` — never anything tenant- or account-identifying — so the
public page can distinguish "link ok" from "expired/revoked/unknown" and render
the form or an error. `POST /signup` runs the same `withSuperadmin` path as
direct creation. Token entropy (256 bits) is the brute-force defense; a throttle
on these two routes is noted as future hardening, not built here.

### D4 — Duplicate tenant name is a hard rejection on the redemption path
Direct creation uses `uniqueSlug()`, which silently appends `-1`, `-2`, … on a
name collision. On the self-service path that is wrong: the recipient chose a
name and must get a clear "that tenant name already exists" error rather than a
surprise slug. So redemption computes the slug and rejects (409, nothing
created) if it already exists. Direct super-admin creation keeps the auto-suffix
behavior — the super-admin is trusted to see the resulting slug.

### D5 — Link-created admin is not forced to change password
`createTenantUser` defaults `mustChangePassword = true` because an admin-set
initial password is a temporary secret the user must replace. On the signup form
the first admin types their **own** password, so forcing an immediate change is
redundant friction. Redemption creates the first admin with
`mustChangePassword = false`; direct creation keeps the default `true`.

### D6 — Refactor a shared internal creation method
Both paths (direct `POST /admin/tenants` and redemption `POST /signup`) create a
tenant + first admin. Extract the core into a single internal method that takes
the name, first-admin credentials, a `forcePasswordChange` flag, an
`onDuplicateName: 'suffix' | 'reject'` policy, and an optional
`invitationId`. The two entry points differ only in those parameters, keeping
one source of truth for the transaction.

## Risks / Trade-offs

- **A leaked link provisions tenants.** Mitigated by expiry + revocation + the
  super-admin seeing every tenant a link created (D1). A revoked or expired link
  fails closed at redemption.
- **Public endpoints are unauthenticated.** Accepted for MVP on token entropy
  alone (D3); throttling is the named next step if abuse appears.
- **Two divergent duplicate-name behaviors** (D4) could confuse. Documented in
  the spec scenarios so the difference is intentional and testable.
