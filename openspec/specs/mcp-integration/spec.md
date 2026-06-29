# mcp-integration Specification

## Purpose
TBD - created by archiving change mcp-integration. Update Purpose after archive.
## Requirements
### Requirement: MCP server exposes QAssistant to MCP clients
The system SHALL provide an MCP server that acts as a client of the QAssistant
REST API, exposing tools that let an MCP client read records and generated code
and report integration outcomes. The server SHALL NOT store Git credentials and
SHALL NOT push code to any repository itself.

#### Scenario: Client lists available tools
- **WHEN** an MCP client connects to the server and lists tools
- **THEN** the server advertises the authentication, record-reading, ready-to-integrate, and integration-status tools

#### Scenario: Server never pushes to Git
- **WHEN** any tool is invoked
- **THEN** the server only reads from or writes to the QAssistant REST API and never performs a Git operation or holds Git credentials

### Requirement: Credential-based tenant-scoped authentication
The MCP server SHALL authenticate via an explicit `authenticate(email, password, tenantId)`
tool that exchanges the credentials for an Identity Platform token, and every
subsequent tool call SHALL act strictly within that authenticated user's tenant
scope. Tool calls made before successful authentication SHALL be rejected.

#### Scenario: Successful authentication
- **WHEN** a client calls `authenticate` with a valid email, password, and tenantId
- **THEN** the server obtains a token and allows subsequent tool calls scoped to that tenant and user

#### Scenario: Tool call without authentication is rejected
- **WHEN** a client calls a record-reading or status tool before a successful `authenticate`
- **THEN** the server rejects the call with an authentication-required error and returns no tenant data

#### Scenario: No cross-tenant access
- **WHEN** an authenticated client requests a record that belongs to a different tenant
- **THEN** the server returns a not-found/forbidden result and never returns another tenant's data

### Requirement: Read records and generated code
The MCP server SHALL provide a `list_records` tool returning the authenticated
tenant's sessions (with optional filters such as status and project) and a
`get_record(sessionId)` tool returning a single session with its full content:
DOM-replay reference, screenshots, generated code versions, flags, and Jira or
description context.

#### Scenario: List records for the tenant
- **WHEN** an authenticated client calls `list_records`
- **THEN** the server returns the tenant's sessions, optionally narrowed by the provided status or project filter

#### Scenario: Fetch a full record
- **WHEN** an authenticated client calls `get_record` with a session id in its tenant
- **THEN** the server returns the session metadata, artifacts, generated code versions, flags, and work context

#### Scenario: Fetch an unknown record
- **WHEN** an authenticated client calls `get_record` with a session id that does not exist in its tenant
- **THEN** the server returns a not-found result without leaking whether the id exists in another tenant

### Requirement: List versions ready to integrate
The MCP server SHALL provide a `list_ready_to_integrate` tool returning the
approved generated-test versions whose integration status is
`ready_to_integrate`, so the client knows which code is a candidate for repo
integration.

#### Scenario: Only ready candidates are listed
- **WHEN** an authenticated client calls `list_ready_to_integrate`
- **THEN** the server returns only versions whose integration status is `ready_to_integrate` and excludes draft, already-integrated, and failed versions

### Requirement: Integration requires the test to be added and to pass
A version SHALL be reported `integrated` only after the client has added the test
to the target repository AND run it with a passing result. The MCP server SHALL
provide an `update_integration_status(generatedTestId, status, ref?, error?)`
tool that records the outcome: `integrated` with a repo reference (commit or PR
URL) when the run passed, or `failed_to_integrate` with an error message when the
run failed or could not be performed. The client's guidance SHALL instruct it to
run the test as the gate and to not push a failing test to the main branch.
QAssistant SHALL NOT run tests itself. The tool SHALL reject transitions that are
not allowed from the version's current state.

#### Scenario: Report a successful integration after a passing run
- **WHEN** the client has added the test to the repo, run it, the run passed, and the client calls `update_integration_status` with status `integrated` and a repo reference
- **THEN** the server records the integrated status, the reference, and the acting user and timestamp

#### Scenario: Failing test run is reported as failed
- **WHEN** the client adds the test, runs it, and the run fails
- **THEN** the client calls `update_integration_status` with status `failed_to_integrate` and the run output as the error message, and does not push the failing test to the main branch

#### Scenario: Test that cannot be run is reported as failed
- **WHEN** the client cannot run the test at all (e.g. missing toolchain, browsers, or environment)
- **THEN** the client calls `update_integration_status` with status `failed_to_integrate` and an error explaining the run could not be performed, rather than reporting `integrated` for an unverified test

#### Scenario: A failed integration offers next steps
- **WHEN** a version has just been reported `failed_to_integrate`
- **THEN** the client shows the recorded run output/error and offers next steps (fix and retry, regenerate a new version in the dashboard with the failure as a review comment, or leave it failed), noting that retrying requires the version to be re-approved back to `ready_to_integrate`

#### Scenario: Report a failed integration
- **WHEN** the client calls `update_integration_status` with status `failed_to_integrate` and an error message
- **THEN** the server records the failed status and the message without requiring a repo reference

#### Scenario: Invalid status transition is rejected
- **WHEN** the client calls `update_integration_status` for a version that is not `ready_to_integrate`
- **THEN** the server rejects the call and leaves the version's integration status unchanged

### Requirement: Guided prompts for a step-by-step flow
The MCP server SHALL expose prompts that give the user a guided entry point: a
`connect` prompt that collects email, password, and tenantId and drives
authentication, and a `browse` prompt that presents the available actions (list
records, get a record, list ready to integrate, integrate). The server's
instructions SHALL direct the client to authenticate first, then offer the
action menu rather than guessing.

#### Scenario: Connect prompt collects credentials
- **WHEN** a client lists prompts and selects `connect` with email, password, and tenantId
- **THEN** the resulting message drives the `authenticate` tool with those values and then asks for the action menu

#### Scenario: Browse prompt presents the action menu
- **WHEN** a client selects the `browse` prompt
- **THEN** the resulting message lists the available actions as numbered options and asks the user which one to run

### Requirement: Target repository located by the client
When integrating, the MCP client SHALL locate the target automated-test
repository itself; QAssistant SHALL NOT store or provide a target-repo
reference. When the client cannot locate the repository, it SHALL ask the user
rather than guessing, and if the repository stays unresolved the version SHALL
be reported `failed_to_integrate` with an explanatory message.

#### Scenario: Repository not found prompts the user
- **WHEN** the client cannot find the target automated-test repository for a record
- **THEN** the client asks the user which repository or directory to use instead of selecting one automatically

#### Scenario: Unresolved repository is reported as failed
- **WHEN** the user does not resolve the target repository and the push cannot proceed
- **THEN** the client calls `update_integration_status` with status `failed_to_integrate` and a message indicating the target repository was not found

