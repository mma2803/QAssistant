# identity-and-tenancy Specification

## Purpose
TBD - created by archiving change qassistant-mvp. Update Purpose after archive.
## Requirements
### Requirement: Multi-tenant identity model
The system SHALL model each client/account as an isolated tenant in its own PostgreSQL `tenants` row, where each user belongs to exactly one tenant (via `tenant_users.tenant_id`) and data is isolated per tenant by row-level security. Each tenant has a unique, human-readable `slug` used to select it at login.

#### Scenario: User scoped to a tenant
- **WHEN** a tenant user authenticates
- **THEN** the issued access token resolves to the user's `uid`, `role`, and the `tenantId` of the tenant they belong to

#### Scenario: Cross-tenant access denied
- **WHEN** a request bears a token for tenant A and targets data belonging to tenant B
- **THEN** the system denies the request

### Requirement: Tenant-owned projects
The system SHALL allow each tenant to own multiple projects, where a project is the unit for app context, capture sessions, artifacts, and code generation.

#### Scenario: Admin creates a project inside a tenant
- **WHEN** a tenant admin creates a project
- **THEN** the project is stored under that admin's tenant and cannot be attached to another tenant

#### Scenario: Same-tenant project access allowed
- **WHEN** an active user in tenant A requests a project-scoped resource for an active project in tenant A
- **THEN** the system permits access according to the user's role

#### Scenario: Cross-tenant project access denied
- **WHEN** a user in tenant A requests a project-scoped resource for a project in tenant B
- **THEN** the system denies the request

### Requirement: Three-level provisioning
The system SHALL support three provisioning levels: a platform-level `super-admin` provisions tenants — either directly (creating a tenant and its first admin) or by issuing a reusable signup link that lets a recipient provision a tenant and its first admin themselves; a tenant `admin` administers one tenant and all of its projects, adding users manually from a dashboard screen; a `qa-engineer` cannot provision any account. There SHALL be no open self-registration: a tenant and its first admin come into existence only through the `super-admin` — directly, or through a `super-admin`-issued signup link — and any further user account exists only if a `super-admin` or `admin` created it.

#### Scenario: Super-admin bootstraps a client directly
- **WHEN** the super-admin onboards a new client directly
- **THEN** the system creates a tenant (with a generated unique slug) and a first admin user for that tenant

#### Scenario: Super-admin delegates onboarding via a signup link
- **WHEN** the super-admin issues a signup link and a recipient redeems it
- **THEN** the system creates a tenant and its first admin from the recipient's submission, with no super-admin action required at redemption time

#### Scenario: Admin adds a user by any email
- **WHEN** a tenant admin adds a user by email (including a Gmail or mixed-domain address) with a role from the dashboard
- **THEN** the system creates the user inside that tenant with a hashed initial password and the given role

#### Scenario: Admin can assign admin role
- **WHEN** a tenant admin creates a new user
- **THEN** the admin may assign either the `admin` or `qa-engineer` role; there is no restriction preventing a tenant admin from creating another tenant admin

#### Scenario: QA engineer cannot add users
- **WHEN** a user with role qa-engineer attempts to create another user
- **THEN** the system rejects the request

#### Scenario: Non-provisioned email has no account
- **WHEN** someone whose email was never created by a super-admin or admin attempts to sign in
- **THEN** the system finds no account for that email and sign-in fails

### Requirement: Email and password authentication
The system SHALL authenticate users through its own self-hosted email/password check: a tenant user signs in with `{ tenantSlug, email, password }` against the `tenant_users` row scoped to that tenant (verified with argon2id); the `super-admin` is a project-level user (a `super_admins` row) that belongs to no tenant and signs in by omitting `tenantSlug`. Email addresses are not verified, since accounts are admin-created and therefore trusted, and there SHALL be no email sending in MVP. Login failure responses SHALL be uniform and constant-time across all failure stages (unknown tenant slug, unknown email, wrong password) to avoid a tenant/email enumeration side channel.

#### Scenario: Tenant user signs in with email and password
- **WHEN** a provisioned tenant user submits their tenant slug, email, and password
- **THEN** the system verifies the password against that tenant's user row and issues an access/refresh token pair

#### Scenario: Super-admin signs in at project level
- **WHEN** the super-admin submits their email and password with no tenant slug
- **THEN** the system authenticates them as a project-level user that carries no `tenantId`

#### Scenario: Login failure responses do not leak which stage failed
- **WHEN** a login request fails because the tenant slug does not exist, the email does not exist within that tenant, or the password is wrong
- **THEN** the system returns the same generic error with comparable response timing in every case

### Requirement: In-dashboard user management
The system SHALL manage users from the dashboard, not a separate console, by calling the backend's `IdentityService` (the self-hosted replacement for the prior Admin SDK wrapper) to create users, set an initial password, assign roles, disable users, and reset passwords. Initial passwords are handed over out of band by the creating admin, and a forgotten password SHALL be reset by an admin rather than by self-service. Disabling a user or resetting their password SHALL immediately revoke every outstanding token for that user.

#### Scenario: Admin sets an initial password
- **WHEN** an admin creates a user
- **THEN** the backend hashes and stores an initial password that the admin hands over out of band

#### Scenario: Admin resets a forgotten password
- **WHEN** a user forgets their password
- **THEN** an admin resets it through the dashboard rather than the user using self-service recovery, and every outstanding token for that user is immediately revoked

#### Scenario: Admin disables a user
- **WHEN** an admin disables a user
- **THEN** the backend marks the account disabled and immediately revokes every outstanding token for that user

#### Scenario: Admin manages another admin
- **WHEN** a tenant admin disables or resets the password of another admin in the same tenant
- **THEN** the system permits the operation; any tenant admin may manage any user in their tenant, including other admins

#### Scenario: Disabled user data preserved
- **WHEN** an admin disables a user account
- **THEN** all sessions, artifacts, and generated tests owned by that user remain intact and visible to tenant admins; only the user's ability to sign in is revoked

### Requirement: Forced password change on first login and after reset
Because the admin who creates or resets a password knows that password, the system SHALL require the user to change it before any app access. Creating or resetting a password SHALL set a `must_change_password` database column; login SHALL route the user to a forced set-new-password step before granting app access; completing it SHALL clear the marker without revoking the current session (the user continues in the same session that just cleared it).

#### Scenario: First login forces password change
- **WHEN** a user signs in with an admin-set initial password
- **THEN** the system routes them to a forced set-new-password step, grants no app access until they set a new password, and then clears the `must_change_password` marker

#### Scenario: Forced change after admin reset
- **WHEN** an admin resets a user's password and the user next signs in
- **THEN** the system again requires a forced password change before app access

### Requirement: Token-based authorization enforced server-side
The system SHALL carry authorization in an opaque, DB-backed bearer access token: verifying it resolves `{ role, tenantId }` for a tenant user (`role` is `admin` or `qa-engineer`) or `{ role: "super-admin" }` with no `tenantId` for the super-admin. The backend SHALL verify the token and enforce tenant and role before any data access; the client SHALL NOT assert identity. Access tokens are valid for 2 hours; refresh tokens for 30 days and are rotated on use. Disabling a user or resetting their password revokes every outstanding token immediately — there is no revocation-gap wait for token expiry.

#### Scenario: Role resolved at token verification
- **WHEN** a user created with the admin role presents their access token
- **THEN** verification resolves a `role` of `admin` and the `tenantId` of their tenant

#### Scenario: Backend enforces claims on every request
- **WHEN** any request reaches the backend
- **THEN** the backend verifies the access token and enforces the resolved `role` and `tenantId` before any data access

#### Scenario: Super-admin carries no tenant
- **WHEN** the super-admin's token is verified
- **THEN** it resolves `role: "super-admin"` and no `tenantId`, and the super-admin uses a separate privileged path rather than a tenant binding

#### Scenario: Revocation is immediate
- **WHEN** an admin changes a user's role, disables access, or resets a password
- **THEN** every outstanding token for that user is revoked immediately, not on a delayed token-refresh cycle

### Requirement: First super-admin bootstrap
The system SHALL bootstrap the first `super-admin` via a seed script, not through any UI. The seed script is idempotent on email: re-running it resets the password on an existing super-admin row.

#### Scenario: Seed creates the first super-admin
- **WHEN** the platform is first provisioned
- **THEN** a seed script creates the first super-admin as a `super_admins` row, and no UI path creates it

### Requirement: Single-tenant resolution without domain assumptions
The system SHALL resolve a user's tenant from the user's single tenant binding established at invitation, not from the email domain. Each user belongs to exactly one tenant and can access only the data of that tenant. After sign-in, the system SHALL require the user to select a project before capture starts.

#### Scenario: Tenant resolved from single binding
- **WHEN** a tenant user signs in
- **THEN** the system resolves their tenant from their single tenant binding and never infers it from the email domain

#### Scenario: User selects a project before capture
- **WHEN** a signed-in user opens the extension without a remembered project
- **THEN** the system presents active projects in the user's tenant and requires one before session start

### Requirement: Reusable tenant signup links
The system SHALL let the `super-admin` issue reusable signup links that delegate tenant provisioning. Issuing a link SHALL generate a high-entropy token of which only a hash is stored, and SHALL return the link's plaintext URL exactly once. A link SHALL carry an expiry and MAY be revoked by the super-admin at any time. A link is reusable: it MAY provision multiple tenants until it expires or is revoked (it is not consumed by a single redemption). Redeeming a valid link SHALL create a tenant (with a generated unique slug) and its first admin from a single submission of tenant name, first-admin email, and first-admin password, on the same privileged, tenant-less path as direct creation. Redemption SHALL be rejected when the link is unknown, expired, or revoked, and when the submitted tenant name resolves to a slug that already exists. A first admin created via a signup link SHALL NOT be forced to change their password, since they chose it themselves. The direct super-admin creation path SHALL remain available unchanged.

#### Scenario: Super-admin issues a signup link
- **WHEN** the super-admin issues a signup link with an expiry
- **THEN** the system stores only the hash of a high-entropy token and returns the link's URL exactly once for the super-admin to share

#### Scenario: Recipient redeems a valid link
- **WHEN** a recipient opens a valid, unexpired, unrevoked link and submits a tenant name, first-admin email, and password
- **THEN** the system creates the tenant with a generated unique slug and its first admin, and the first admin can sign in immediately with the chosen password without a forced password change

#### Scenario: A link provisions more than one tenant
- **WHEN** the same valid link is redeemed a second time with a different tenant name
- **THEN** the system creates a second, distinct tenant — the link is not consumed by the first redemption

#### Scenario: Duplicate tenant name is declined
- **WHEN** a recipient redeems a link with a tenant name whose slug already exists
- **THEN** the system rejects the redemption and creates no tenant and no admin, and the recipient is told the tenant name already exists

#### Scenario: Expired or revoked link cannot be redeemed
- **WHEN** a recipient attempts to redeem a link that has expired or been revoked by the super-admin
- **THEN** the system rejects the redemption and creates nothing

#### Scenario: Unknown token cannot be redeemed
- **WHEN** a redemption is attempted with a token that matches no issued link
- **THEN** the system rejects the request and creates nothing

#### Scenario: Link validity check leaks nothing identifying
- **WHEN** a signed-out client checks a signup link's validity before showing the form
- **THEN** the system returns only whether the link is valid and its expiry, and no tenant- or account-identifying information

#### Scenario: Super-admin sees which accounts used a link
- **WHEN** the super-admin lists issued signup links
- **THEN** each link shows its status (active, expired, or revoked) and the tenants it provisioned, each with the first-admin email of the account that redeemed it (not just a count)

### Requirement: Password complexity policy
Every password the system accepts when a password is **set** — a tenant's first admin (direct creation or signup-link redemption), an admin-created user, an admin password reset, and a user's forced or self-service password change — SHALL be at least 8 characters and SHALL contain at least one lowercase letter, one uppercase letter, one digit, and one special (non-alphanumeric) character. Sign-in SHALL NOT apply this policy, so existing accounts whose passwords predate it can still authenticate; the policy governs newly set passwords only. The same requirement text SHALL be surfaced to the user at the point of entry (dashboard and extension) and returned by the API when a password is rejected.

#### Scenario: A password missing a character class is rejected
- **WHEN** a password is set that lacks a lowercase letter, an uppercase letter, a digit, or a special character, or is shorter than 8 characters
- **THEN** the system rejects it and reports the complexity requirement

#### Scenario: A compliant password is accepted
- **WHEN** a password is set that is at least 8 characters and includes a lowercase letter, an uppercase letter, a digit, and a special character
- **THEN** the system accepts and stores it

#### Scenario: Sign-in is not subject to the complexity policy
- **WHEN** an existing user whose stored password predates the policy signs in with that password
- **THEN** authentication succeeds, since the policy applies only when a password is set, not at sign-in

### Requirement: Super-admin can delete a tenant (soft delete)
The `super-admin` SHALL be able to delete a tenant, in addition to deactivating it. Deletion is a soft delete: the tenant is hidden from the provisioning list and its users can no longer sign in (their outstanding tokens are revoked immediately), but no tenant data is destroyed and the action is reversible. Deletion SHALL free the tenant's slug so a tenant of the same name can be created again. Deactivation (active/inactive status) remains available and is distinct from deletion.

#### Scenario: Super-admin deletes a tenant
- **WHEN** the super-admin deletes a tenant
- **THEN** the tenant no longer appears in the provisioning list, and its users can no longer sign in (a sign-in attempt fails with the same uniform error as an unknown tenant)

#### Scenario: Deleted tenant's data is preserved
- **WHEN** a tenant is deleted
- **THEN** its projects, recordings, artifacts, generated tests, and users are retained (soft delete), not destroyed

#### Scenario: A deleted tenant's name can be reused
- **WHEN** the super-admin later creates or provisions a tenant with the same name as a deleted one
- **THEN** the system accepts it, because deletion frees the previous tenant's slug

#### Scenario: Delete is distinct from deactivate
- **WHEN** the super-admin deactivates a tenant instead of deleting it
- **THEN** the tenant stays in the list with an inactive status and can be reactivated, unchanged from the existing behavior

