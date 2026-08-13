## MODIFIED Requirements

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

## ADDED Requirements

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

#### Scenario: Super-admin sees how many tenants a link created
- **WHEN** the super-admin lists issued signup links
- **THEN** each link shows its status (active, expired, or revoked) and the number of tenants it has provisioned

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
