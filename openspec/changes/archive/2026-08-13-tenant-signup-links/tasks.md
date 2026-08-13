## 0. Decision checkpoints (resolve before building)

- [x] 0.1 Links are reusable, expiring, super-admin-issued (D1)
- [x] 0.2 Tenant name entered in the form; duplicate name is rejected on redemption (D4)
- [x] 0.3 Link-created first admin is not forced to change password (D5)
- [x] 0.4 Direct `POST /admin/tenants` creation retained unchanged as plan B
- [x] 0.5 Expiry input is in days; default 7, max 90 (owner-confirmed)

## 1. Shared contract (additive)

- [x] 1.1 `createInvitationRequest` `{ expiresInDays }` + `createInvitationResponse` `{ id, token, expiresAt }` (`packages/shared/src/dto/admin.ts`) — URL is composed client-side from the dashboard origin, so no server base-URL coupling
- [x] 1.2 `invitationSchema` entity for listing `{ id, expiresAt, revokedAt, createdTenantCount, status, createdAt }` (status derived: active / expired / revoked)
- [x] 1.3 `validateInvitationResponse` `{ valid, expiresAt }` and `redeemInvitationRequest` `{ token, name, firstAdmin: { email, password } }`
- [x] 1.4 Build `@qassistant/shared`

## 2. API — data model

- [x] 2.1 Migration `0010_tenant_invitations.sql`: `tenant_invitations` (`id`, `token_hash` unique, `created_by` → super_admins, `expires_at`, `revoked_at` nullable, timestamps); no RLS (superadmin/public path, per `auth_tokens`)
- [x] 2.2 Add `tenants.created_via_invitation_id` (nullable FK → tenant_invitations); direct creation leaves it null (D1)
- [x] 2.3 Mirror both in `apps/api/src/db/schema.ts`

## 3. API — service & endpoints

- [x] 3.1 Refactor tenant creation into a shared internal method (name, first-admin creds, `forcePasswordChange`, `onDuplicateName: 'suffix' | 'reject'`, optional `invitationId`) (D6)
- [x] 3.2 `InvitationsService`: issue (32-byte token, store hash only), list (with per-link tenant count), revoke, validate, redeem
- [x] 3.3 `@SuperAdminOnly()` routes: `POST /admin/tenants/invitations`, `GET /admin/tenants/invitations`, `DELETE /admin/tenants/invitations/:id`
- [x] 3.4 `@Public()` routes: `GET /signup/:token` (returns only `{ valid, expiresAt }`), `POST /signup` (redeem on the `withSuperadmin` path); both throttled
- [x] 3.5 Redemption enforces: link exists + not expired + not revoked; duplicate slug → 409, nothing created; first admin `mustChangePassword = false`

## 4. Dashboard — super-admin

- [x] 4.1 Tenants page: "Create signup link" dialog (pick expiry, 1–90 days) → generated URL shown once with a copy affordance
- [x] 4.2 Issued-links section: list with status (active/expired/revoked), tenants-created count, revoke action
- [x] 4.3 `lib/api.ts`: `createInvitation`, `listInvitations`, `revokeInvitation` (authed)

## 5. Dashboard — public signup page

- [x] 5.1 Route `/signup/:token` reachable while signed out (matched before the auth gates in `App.tsx`)
- [x] 5.2 `SignupPage`: validate token on mount → form (tenant name + admin email + password) or a clear invalid/expired/revoked message
- [x] 5.3 On success: confirm + tenant slug + link to sign-in; `publicApi.validateInvitation` / `redeemInvitation` (no bearer)
- [x] 5.4 UI tests: super-admin link creation (`tenants.spec.ts`); public redeem, duplicate-name error, invalid-link state (`signup.spec.ts`)

## 5b. Password complexity policy (applies to all password-setting)

- [x] 5b.1 Tighten shared `passwordSchema` (min 8 + lower + upper + digit + special) and reuse it for `completePasswordChange`; export a `PASSWORD_REQUIREMENTS` hint (`packages/shared/src/dto/auth.ts`)
- [x] 5b.2 Sign-in stays a plain non-empty string so existing accounts still authenticate
- [x] 5b.3 Enforce + surface the rule in the dashboard (signup, add-tenant, user create/reset, forced/self-service change) and the extension popup, reusing `passwordSchema` + `PASSWORD_REQUIREMENTS`
- [x] 5b.4 Update API + Playwright fixtures/tests to use policy-compliant passwords

## 5c. Tenant soft-delete (super-admin)

- [x] 5c.1 Migration `0011_tenant_soft_delete.sql`: `tenants.deleted_at` (+ index); mirror in `schema.ts`
- [x] 5c.2 `AdminService.deleteTenant`: set `deleted_at`, revoke the tenant's users' tokens, free the slug; `listTenants` hides soft-deleted rows
- [x] 5c.3 `DELETE /admin/tenants/:tenantId` (@SuperAdminOnly, 204); login rejects a soft-deleted tenant with the uniform failure
- [x] 5c.4 Dashboard: "Delete" action + confirmation dialog on the Tenants page; `api.deleteTenant`; i18n keys
- [x] 5c.5 Tests: http-e2e delete + hidden-from-list (route coverage); tenant-signup-links delete → sign-in blocked; Playwright delete-with-confirm

## 6. Spec & docs

- [ ] 6.1 On archive: fold this delta into `openspec/specs/identity-and-tenancy/spec.md`
- [ ] 6.2 Note the public `/signup` surface in any deploy/privacy docs if relevant

## 7. Tests

- [x] 7.1 API: issue link returns plaintext token + expiry (`test/tenant-signup-links.test.ts`)
- [x] 7.2 E2E: redeem a valid link creates tenant + first admin; admin signs in directly (no forced change)
- [x] 7.3 E2E: **reuse** — same link redeems a second, distinct tenant
- [x] 7.4 E2E: duplicate tenant name → 409, nothing created
- [x] 7.5 E2E: expired link and revoked link both rejected; unknown token rejected
- [x] 7.6 API/RLS: redemption runs on the privileged `withSuperadmin` path; full RLS-isolation suite still green
- [x] 7.7 Regression: full API suite (90/90) green, incl. direct `POST /admin/tenants` (plan B) + route-coverage guard in `http-e2e`
