# @qassistant/mcp

MCP server that exposes QAssistant records and generated code to MCP clients
(e.g. Claude Code) over **stdio**, and records integration outcomes. It is a
REST client of the QAssistant API: it authenticates as a tenant user and acts
strictly within that tenant's scope.

> **It never pushes to Git and stores no Git credentials.** The MCP client
> performs the `git commit`/`push` with its own credentials; this server only
> provides the code and records the reported outcome.

## Tools

| Tool | Purpose |
|------|---------|
| `authenticate(email, password, tenantId?)` | Open a session (token held in memory only). Required first. |
| `list_records(status?, projectId?, cursor?, limit?)` | List the tenant's recorded sessions. |
| `get_record(sessionId)` | Full record: artifacts, generated code versions, flags, context. |
| `list_ready_to_integrate()` | Approved versions whose status is `ready_to_integrate`. |
| `update_integration_status(generatedTestId, status, ref?, error?)` | Report `integrated` (+ref) or `failed_to_integrate` (+error). |

When the client cannot locate the target automated-test repository, it asks the
user; if unresolved, it reports `failed_to_integrate` with a "target repository
not found" message.

## Guided prompts

The server also exposes **prompts** (in Claude Code: `/mcp__qassistant__<name>`)
for a step-by-step flow:

| Prompt | Purpose |
|--------|---------|
| `connect` | Collects email, password, tenantId and signs you in. |
| `browse` | Presents the action menu (list records · get a record · ready-to-integrate · integrate). |

The server instructions also tell the client to authenticate first, then offer
the menu — so even without picking a prompt, Claude walks you through it.

> Entering your password in the conversation is fine for local/dev. For a hosted
> deployment, prefer env-provided credentials over typing the password.

## Configuration (environment)

| Variable | Default | Meaning |
|----------|---------|---------|
| `QASSISTANT_API_URL` | `http://localhost:8080` | Base URL of the QAssistant API. The `/api/v1` global prefix is appended automatically when the URL is host-only; pass a URL that already includes a path to override. |
| `FIREBASE_API_KEY` | `local-api-key` | Identity Platform Web API key. |
| `FIREBASE_AUTH_EMULATOR_HOST` | _(unset)_ | e.g. `127.0.0.1:9099` to use the local Auth emulator. |

## Build & run

```bash
npm run build --workspace @qassistant/mcp
node apps/mcp/dist/main.js   # speaks JSON-RPC over stdio
```

## Connect from Claude Code

Local dev (against the Auth emulator and a local API):

```bash
claude mcp add qassistant \
  --env QASSISTANT_API_URL=http://localhost:8080 \
  --env FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  --env FIREBASE_API_KEY=local-api-key \
  -- node /absolute/path/to/QAssistant/apps/mcp/dist/main.js
```

Equivalent `.mcp.json` / settings entry:

```json
{
  "mcpServers": {
    "qassistant": {
      "command": "node",
      "args": ["/absolute/path/to/QAssistant/apps/mcp/dist/main.js"],
      "env": {
        "QASSISTANT_API_URL": "http://localhost:8080",
        "FIREBASE_AUTH_EMULATOR_HOST": "127.0.0.1:9099",
        "FIREBASE_API_KEY": "local-api-key"
      }
    }
  }
}
```

Then, in Claude Code, ask it to authenticate (it will call `authenticate` with
your email/password/tenantId), read a record, push the code to your test repo,
and report the result back.
