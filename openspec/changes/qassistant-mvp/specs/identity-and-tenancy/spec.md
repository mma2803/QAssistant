## ADDED Requirements

### Requirement: Multi-tenant identity model
The system SHALL model each client/account as an isolated tenant in Identity Platform, mapping one GCIP tenant to one app tenant, where each user belongs to exactly one tenant and data is isolated per tenant.

#### Scenario: User scoped to a tenant
- **WHEN** a tenant user authenticates
- **THEN** the issued ID token carries the user's `uid`, `role`, and the `tenantId` of the tenant they belong to

#### Scenario: Cross-tenant access denied
- **WHEN** a request bears a token for tenant A and targets data belonging to tenant B
- **THEN** the system denies the request

### Requirement: Tenant-owned projects
The system SHALL allow each tenant to own multiple projects, where a project is the unit for optional Jira configuration, app context, capture sessions, artifacts, and code generation.

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
The system SHALL support three provisioning levels: a platform-level `super-admin` creates tenants and each tenant's first admin; a tenant `admin` administers one tenant and all of its projects, adding users manually from a dashboard screen; a `qa-engineer` cannot provision any account. There SHALL be no self-registration: an account exists only if a `super-admin` or `admin` created it.

#### Scenario: Super-admin bootstraps a client
- **WHEN** the super-admin onboards a new client
- **THEN** the system creates a tenant and a first admin user for that tenant

#### Scenario: Admin adds a user by any email
- **WHEN** a tenant admin adds a user by email (including a Gmail or mixed-domain address) with a role from the dashboard
- **THEN** the system creates the user inside that tenant's GCIP tenant and sets the role claim

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
The system SHALL authenticate users through Identity Platform's email and password provider. Tenant users sign in within their GCIP tenant; the `super-admin` is a project-level user that belongs to no tenant. Email addresses are not verified, since accounts are admin-created and therefore trusted, and there SHALL be no email sending in MVP.

#### Scenario: Tenant user signs in with email and password
- **WHEN** a provisioned tenant user submits their email and password for their tenant
- **THEN** the system authenticates them against their GCIP tenant and issues an ID token

#### Scenario: Super-admin signs in at project level
- **WHEN** the super-admin submits their email and password
- **THEN** the system authenticates them as a project-level user that carries no `tenantId`

### Requirement: In-dashboard user management via Admin SDK
The system SHALL manage users from the dashboard, not a separate console, by calling the Identity Platform Admin SDK from the backend to create users, set an initial password, assign roles, disable users, and reset passwords. Initial passwords are handed over out of band by the creating admin, and a forgotten password SHALL be reset by an admin rather than by self-service.

#### Scenario: Admin sets an initial password
- **WHEN** an admin creates a user
- **THEN** the backend uses the Admin SDK to create the account and set an initial password that the admin hands over out of band

#### Scenario: Admin resets a forgotten password
- **WHEN** a user forgets their password
- **THEN** an admin resets it through the dashboard rather than the user using self-service recovery

#### Scenario: Admin disables a user
- **WHEN** an admin disables a user
- **THEN** the backend uses the Admin SDK to disable the account

#### Scenario: Admin manages another admin
- **WHEN** a tenant admin disables or resets the password of another admin in the same tenant
- **THEN** the system permits the operation; any tenant admin may manage any user in their tenant, including other admins

#### Scenario: Disabled user data preserved
- **WHEN** an admin disables a user account
- **THEN** all sessions, artifacts, and generated tests owned by that user remain intact and visible to tenant admins; only the user's ability to sign in is revoked

### Requirement: Forced password change on first login and after reset
Because the admin who creates or resets a password knows that password, the system SHALL require the user to change it before any app access. Creating or resetting a password SHALL set a `mustChangePassword` marker (custom claim or metadata); login SHALL route the user to a forced set-new-password step before granting app access; completing it SHALL clear the marker.

#### Scenario: First login forces password change
- **WHEN** a user signs in with an admin-set initial password
- **THEN** the system routes them to a forced set-new-password step, grants no app access until they set a new password, and then clears the `mustChangePassword` marker

#### Scenario: Forced change after admin reset
- **WHEN** an admin resets a user's password and the user next signs in
- **THEN** the system again requires a forced password change before app access

### Requirement: Custom-claim authorization enforced server-side
The system SHALL carry authorization in custom claims baked into the verified ID token: tenant users carry `{ role, tenantId }` where `role` is `admin` or `qa-engineer`, and the `super-admin` carries `{ role: "super-admin" }` with no `tenantId`. The backend SHALL verify the token and enforce tenant and role before any data access; the client SHALL NOT assert identity. Role and access changes SHALL take effect on the next token refresh; immediate revocation is out of scope for MVP.

#### Scenario: Role claim set at creation
- **WHEN** a user is created with the admin role
- **THEN** the user's token includes a `role` claim of `admin` and the `tenantId` of their tenant

#### Scenario: Backend enforces claims on every request
- **WHEN** any request reaches the backend
- **THEN** the backend verifies the ID token and enforces the `role` and `tenantId` claims before any data access

#### Scenario: Super-admin carries no tenant
- **WHEN** the super-admin's token is verified
- **THEN** it carries `role: "super-admin"` and no `tenantId`, and the super-admin uses a separate privileged path rather than a tenant binding

#### Scenario: Revocation takes effect on token refresh
- **WHEN** an admin changes a user's role or disables access
- **THEN** the change takes effect on the next token refresh (up to about one hour), with no immediate revocation in MVP

### Requirement: First super-admin bootstrap
The system SHALL bootstrap the first `super-admin` via a seed script or Terraform, not through any UI.

#### Scenario: Seed creates the first super-admin
- **WHEN** the platform is first provisioned
- **THEN** a seed script or Terraform creates the first super-admin, and no UI path creates it

### Requirement: Single-tenant resolution without domain assumptions
The system SHALL resolve a user's tenant from the user's single tenant binding established at invitation, not from the email domain. Each user belongs to exactly one tenant and can access only the data of that tenant. After sign-in, the system SHALL require the user to select a project before capture starts.

#### Scenario: Tenant resolved from single binding
- **WHEN** a tenant user signs in
- **THEN** the system resolves their tenant from their single tenant binding and never infers it from the email domain

#### Scenario: User selects a project before capture
- **WHEN** a signed-in user opens the extension without a remembered project
- **THEN** the system presents active projects in the user's tenant and requires one before session start
