import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpConfig } from './config.js';
import { AuthSession } from './auth.js';
import { ApiClient } from './api-client.js';

/**
 * Guidance surfaced to the MCP client. The integration loop is client-driven:
 * QAssistant provides the code and records the outcome; the CLIENT adds the test
 * to the repo, RUNS it, and only pushes (with its own Git credentials) when the
 * run passes. QAssistant never runs tests, never pushes, and stores no Git
 * credentials. "integrated" therefore means "added and the test passed".
 */
const INSTRUCTIONS = `QAssistant MCP server. Guide the user step by step.

FIRST CONTACT: if the user has not authenticated yet, ask them for their
email, password, and tenantId (or point them at the \`connect\` prompt), then
call \`authenticate\`. Do not call any other tool before authentication.

AFTER AUTHENTICATION: present a short menu of what they can do and ask which
they want, rather than guessing:
  1. List all records (their recorded QA sessions).
  2. Get a specific record by id (full content: code versions, artifacts, flags).
  3. List versions ready to integrate.
  4. Integrate a version (add to the repo, run the test, then report the result).
The \`browse\` prompt produces this menu.

INTEGRATION (option 4) — integrated means "added AND the test passes":
  a. Locate the team's automated-test repository yourself. If you cannot find it,
     ASK THE USER which repo or directory to use — never guess. If it stays
     unresolved, call \`update_integration_status\` with
     status="failed_to_integrate" and error="target repository not found".
  b. Add the generated test file to the repo (matching its layout/conventions).
  c. RUN the test (install deps if needed, run that spec). The run is the gate:
     - If it PASSES → commit/push with YOUR OWN Git credentials, then call
       \`update_integration_status\` with status="integrated" and ref set to the
       commit or PR URL.
     - If it FAILS → call \`update_integration_status\` with
       status="failed_to_integrate" and error set to the run output (do NOT push
       the failing test to the main branch).
     - If you genuinely cannot run it (missing toolchain/browsers/env) → report
       status="failed_to_integrate" with error="run impossible: <reason>" rather
       than claiming success on an unverified test.

AFTER A FAILED INTEGRATION (status="failed_to_integrate"): do not stop silently.
  1. Show the user the run output / error you recorded.
  2. Offer concrete next steps and ask which they want:
     - Fix the test or the environment, then retry the integration.
     - Regenerate a new version in the QAssistant dashboard (paste the failure as
       a review comment so the next generation accounts for it), then approve it.
     - Leave it as failed for now.
  3. Tell them retrying requires the version to be ready_to_integrate again: a
     failed_to_integrate version is blocked until it is re-approved in the
     dashboard (re-approval resets it to ready_to_integrate). The MCP server
     itself does not expose approve/regenerate — those happen in the dashboard.

QAssistant never pushes to Git, never runs tests itself, and never stores Git
credentials — the client performs the add, the run, and the push.`;

function jsonContent(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorContent(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

export function buildServer(config: McpConfig): McpServer {
  const auth = new AuthSession(config);
  const api = new ApiClient(config, auth);

  const server = new McpServer(
    { name: 'qassistant', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );

  server.tool(
    'authenticate',
    'Open a session: exchange email/password (+ GCIP tenantId) for a token. ' +
      'Required before any other tool. Acts strictly within that tenant/user.',
    {
      email: z.string().email(),
      password: z.string().min(1),
      tenantId: z.string().min(1).optional(),
    },
    async ({ email, password, tenantId }) => {
      try {
        await auth.authenticate(email, password, tenantId);
        return jsonContent({ authenticated: true, tenantId: auth.currentTenantId() });
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'list_records',
    "List the authenticated tenant's recorded QA sessions (records). " +
      'Optional filters: status (active|completed), projectId, cursor, limit.',
    {
      status: z.enum(['active', 'completed']).optional(),
      projectId: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    async (params) => {
      try {
        return jsonContent(await api.listRecords(params));
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'get_record',
    'Fetch one record by session id: metadata, artifacts, generated code ' +
      'versions, flags, and Jira/description context.',
    { sessionId: z.string().min(1) },
    async ({ sessionId }) => {
      try {
        return jsonContent(await api.getRecord(sessionId));
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'list_ready_to_integrate',
    'List approved generated-test versions whose integration status is ' +
      'ready_to_integrate (candidates for repo integration).',
    {},
    async () => {
      try {
        return jsonContent(await api.listReadyToIntegrate());
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.tool(
    'update_integration_status',
    'Report the outcome of integrating a ready_to_integrate version. Integrated ' +
      'means the test was added to the repo AND its run passed: use ' +
      'status="integrated" with ref (commit or PR URL) only after a passing run. ' +
      'Use status="failed_to_integrate" with an error message when the test run ' +
      'failed (include the run output), the target repository could not be found ' +
      'and the user did not resolve it, or the test could not be run at all.',
    {
      generatedTestId: z.string().min(1),
      status: z.enum(['integrated', 'failed_to_integrate']),
      ref: z.string().min(1).optional(),
      error: z.string().min(1).optional(),
    },
    async ({ generatedTestId, status, ref, error }) => {
      try {
        const result = await api.updateIntegrationStatus(generatedTestId, {
          status,
          ref,
          error,
        });
        return jsonContent(result);
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // --- Prompts: pickable, guided entry points (Claude Code surfaces these as
  // /mcp__qassistant__<name> commands). They inject a user-turn message that
  // drives the tools above. -----------------------------------------------------

  server.prompt(
    'connect',
    'Sign in to QAssistant: fill your email, password, and tenantId.',
    {
      email: z.string().describe('Your QAssistant account email'),
      password: z.string().describe('Your password'),
      tenantId: z.string().describe('Your GCIP tenant id'),
    },
    ({ email, password, tenantId }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Call the \`authenticate\` tool with email="${email}", ` +
              `password="${password}", tenantId="${tenantId}". After it succeeds, ` +
              `show me the menu of what I can do next.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    'browse',
    'Show the menu of QAssistant actions (list records, get a record, ready-to-integrate, integrate).',
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              'List what I can do with QAssistant as numbered options: ' +
              '1) list all my records, 2) get a specific record by id, ' +
              '3) list versions ready to integrate, 4) integrate a version ' +
              '(add it to the repo, run the test, push only if it passes, then ' +
              'report the result). Then ask me which one I want.',
          },
        },
      ],
    }),
  );

  return server;
}
