#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

/**
 * QAssistant MCP server entrypoint (stdio transport). The MCP client (e.g.
 * Claude Code) launches this process and speaks JSON-RPC over stdin/stdout.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const server = buildServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Never write to stdout: it is the JSON-RPC channel. Logs go to stderr.
  process.stderr.write(`qassistant-mcp connected (api=${config.apiBaseUrl})\n`);
}

main().catch((err) => {
  process.stderr.write(`qassistant-mcp failed to start: ${String(err)}\n`);
  process.exit(1);
});
