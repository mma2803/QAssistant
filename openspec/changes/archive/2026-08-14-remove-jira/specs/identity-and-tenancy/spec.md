## MODIFIED Requirements

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
