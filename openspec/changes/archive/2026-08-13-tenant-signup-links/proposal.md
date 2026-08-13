## Why

Onboarding a client today requires the super-admin to open the dashboard and
create each tenant by hand (`POST /admin/tenants`), typing the tenant name and
the first admin's email and password. That keeps the super-admin in the loop for
every single onboarding and does not scale when several clients need to
self-serve their own setup.

This change adds a second, delegated provisioning path: the super-admin issues a
**reusable signup link**, and anyone holding that link fills a single form
(tenant name + first-admin email + password) to provision their own tenant. The
super-admin stays the root of trust — no link, no tenant — but is no longer a
manual step in each onboarding. The existing hands-on creation path is kept
unchanged as the fallback ("plan B").

This modifies a requirement the specs already assert (`identity-and-tenancy`
→ *Three-level provisioning*: "There SHALL be no self-registration"), so the
specs, being the source of truth, must record the new gated path.

## What Changes

- **Reusable, expiring signup links (super-admin issued)**: the super-admin can
  mint a signup link that carries a high-entropy token. The link has an
  expiry and can be revoked manually. It is **reusable**: one link may provision
  many tenants until it expires or is revoked (deliberately not single-use).
- **Self-service tenant provisioning via a link**: a recipient opens the link,
  submits a tenant name + first-admin email + password, and the system creates
  the tenant (with a generated unique slug) and its first admin in one step.
- **Duplicate tenant name is declined**: if the submitted name resolves to a
  slug that already exists, the redemption is rejected and nothing is created —
  the recipient must choose another name (no silent `-1` slug suffixing on this
  path).
- **No forced password change for a link-created admin**: the first admin picks
  their own password in the signup form, so they are not flagged
  `mustChangePassword` and sign in directly with it.
- **Direct creation retained as plan B**: `POST /admin/tenants` and the
  super-admin "Add tenant" dialog stay exactly as they are today.
- **Super-admin can delete a tenant (soft delete)**: alongside deactivate, the
  super-admin can delete a tenant — it is hidden from the list, its users can no
  longer sign in (tokens revoked), and its slug is freed for reuse; data is
  preserved and the action is reversible.
- **Password complexity policy**: since the signup form is the first place an
  untrusted recipient sets a password, this change also tightens the shared
  password rule applied everywhere a password is *set* (signup, direct tenant
  creation, user creation, admin reset, forced/self-service change): at least 8
  characters with a lowercase letter, an uppercase letter, a digit, and a
  special character. Sign-in is unaffected, so existing accounts keep working.

## Capabilities

### Modified Capabilities
- `identity-and-tenancy`: the provisioning model gains a super-admin-issued,
  reusable signup-link path for creating a tenant and its first admin, alongside
  the existing direct super-admin creation. Adds the link lifecycle
  (issue / list / revoke / expire) and the public redemption flow, including
  duplicate-name rejection and no forced password change for link-created
  admins.

## Impact

- **Shared**: new DTOs for issuing a link, listing links, validating a token,
  and redeeming a link. Additive only; no breaking change to existing contracts.
- **API**: new `tenant_invitations` table (migration) storing only the SHA-256
  hash of each token; new `@SuperAdminOnly()` endpoints to issue/list/revoke
  links and new `@Public()` endpoints to validate a token and redeem it. Tenant
  creation logic is refactored into a shared internal path used by both the
  direct-create and the redemption flows.
- **Dashboard**: the super-admin Tenants page gains a "Create signup link"
  action (choose expiry, copy the generated URL once) and a list of issued links
  with status and a revoke action. A new **public** signup page (reachable
  while signed out) renders the redemption form.
- **Security/Privacy**: the redemption endpoint is public and unauthenticated;
  the token is the only credential, so it is high-entropy (32 random bytes) and
  only its hash is stored, mirroring the existing `auth_tokens` posture. No
  email is sent (consistent with the MVP no-email decision); distributing the
  link is out of band.

## Non-Goals

- **Single-use / per-tenant links**: links are intentionally reusable; a
  one-link-one-tenant mode is not in scope.
- **Email delivery of links or invitations**: no email sending is added (the
  platform still sends no email); the super-admin copies and shares the URL
  themselves.
- **Self-service beyond the first admin**: a link provisions a tenant and its
  first admin only; further users are still added by a tenant admin from the
  dashboard, unchanged.
- **Rate-limiting infrastructure**: relying on token entropy for now; a
  dedicated throttling layer on the public endpoints is a future hardening step,
  noted in design but not built here.
- **Approval workflow**: a redeemed link creates the tenant immediately; there
  is no super-admin approval step between redemption and creation.
