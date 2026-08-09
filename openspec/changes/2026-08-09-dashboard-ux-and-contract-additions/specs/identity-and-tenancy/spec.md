## ADDED Requirements

### Requirement: Authenticated self-service password change
The system SHALL let a signed-in user change their own password from the dashboard, without an admin. This is distinct from forgotten-password recovery, which remains admin-only (a user who cannot sign in still has their password reset by an admin). A successful self-service change SHALL set the new argon2id hash and SHALL NOT revoke the current session — the user continues in the same session, consistent with completing a forced change.

#### Scenario: Signed-in user changes their own password
- **WHEN** a signed-in user submits a new password (meeting the minimum length) from the account menu
- **THEN** the system stores the new hash, keeps the current session valid, and confirms the change

#### Scenario: Forgotten password stays admin-only
- **WHEN** a user cannot sign in because they forgot their password
- **THEN** recovery is still performed by an admin reset, not by self-service

### Requirement: Identity bootstrap exposes account email
The identity bootstrap (`GET /auth/me`) SHALL include the signed-in account's email, in addition to the opaque user id and role/tenant context, so the dashboard can display who is signed in. The email is for display only and does not change authorization, which remains resolved server-side from the token.

#### Scenario: me returns the account email
- **WHEN** a signed-in user's client calls the identity bootstrap
- **THEN** the response includes the account's email alongside the user id, role, and tenant context
