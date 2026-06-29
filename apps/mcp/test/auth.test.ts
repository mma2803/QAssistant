import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthSession } from '../src/auth.js';
import { ApiClient } from '../src/api-client.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig({ QASSISTANT_API_URL: 'http://localhost:0' } as NodeJS.ProcessEnv);

describe('MCP auth gating (spec: tool call before authenticate is rejected)', () => {
  it('a fresh session is not authenticated', () => {
    const auth = new AuthSession(config);
    assert.equal(auth.isAuthenticated(), false);
    assert.throws(() => auth.requireToken(), /Not authenticated/);
  });

  it('an API call before authenticate is rejected and never reaches the network', async () => {
    let fetched = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error('fetch should not be called');
    }) as typeof fetch;
    try {
      const auth = new AuthSession(config);
      const api = new ApiClient(config, auth);
      await assert.rejects(api.listRecords({}), /Not authenticated/);
      assert.equal(fetched, false, 'no tenant data was requested before authentication');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
