## MODIFIED Requirements

### Requirement: Multi-tenant identity model
The system SHALL model each client/account as an isolated tenant in its own PostgreSQL `tenants` row, where each user belongs to exactly one tenant (via `tenant_users.tenant_id`) and data is isolated per tenant by row-level security. Each tenant has a unique, human-readable `slug` used to select it at login.

#### Scenario: User scoped to a tenant
- **WHEN** a tenant user authenticates
- **THEN** the issued access token resolves to the user's `uid`, `role`, and the `tenantId` of the tenant they belong to

#### Scenario: Cross-tenant access denied
- **WHEN** a request bears a token for tenant A and targets data belonging to tenant B
- **THEN** the system denies the request

### Requirement: Three-level provisioning
The system SHALL support three provisioning levels: a platform-level `super-admin` creates tenants and each tenant's first admin; a tenant `admin` administers one tenant and all of its projects, adding users manually from a dashboard screen; a `qa-engineer` cannot provision any account. There SHALL be no self-registration: an account exists only if a `super-admin` or `admin` created it.

#### Scenario: Super-admin bootstraps a client
- **WHEN** the super-admin onboards a new client
- **THEN** the system creates a tenant (with a generated unique slug) and a first admin user for that tenant

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

### Requirement: In-dashboard user management via Admin SDK
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

### Requirement: Custom-claim authorization enforced server-side
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
