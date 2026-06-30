import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPrompt } from '../src/codegen/prompt-builder.js';
import { resolveTestType } from '../src/codegen/codegen.service.js';

/**
 * Unit coverage for the configurable-test-type change (no DB). Covers the
 * resolution cascade and the test-type branch of the prompt builder, including
 * that the backend branch grounds in network traffic, redacts secrets, and
 * records the resolved type in the summary. The worker-level / persistence /
 * RLS coverage lives in the DB-backed e2e flow.
 */

describe('resolveTestType cascade', () => {
  it('per-generation override wins over project and tenant defaults', () => {
    assert.equal(resolveTestType('backend', 'ui', 'ui'), 'backend');
    assert.equal(resolveTestType('ui', 'backend', 'backend'), 'ui');
  });

  it('project default wins over tenant default when no override', () => {
    assert.equal(resolveTestType(undefined, 'backend', 'ui'), 'backend');
  });

  it('null project default inherits the tenant default', () => {
    assert.equal(resolveTestType(undefined, null, 'backend'), 'backend');
  });

  it('falls back to ui (hard default) when nothing is set', () => {
    assert.equal(resolveTestType(undefined, null, null), 'ui');
    assert.equal(resolveTestType(undefined, undefined, undefined), 'ui');
  });
});

describe('prompt-builder test-type branch', () => {
  const base = {
    framework: 'Playwright',
    language: 'TypeScript',
  };

  it('backend test emits API rules grounded in captured traffic and records testType', () => {
    const { prompt, summary } = buildPrompt({
      ...base,
      kind: 'playwright_test',
      tier: 'pro',
      testType: 'backend',
      sources: [
        {
          label: 'recording.network',
          kind: 'recording',
          text: 'POST https://api.acme.test/cart -> 201\n  response body: {"id":"c1","total":42}',
        },
      ],
    });
    const sys = prompt.system;
    assert.match(sys, /back-end \/ API test/i, 'announces a backend/API test');
    assert.match(sys, /response status/i, 'asserts on response status');
    assert.match(sys, /recording\.network/i, 'reproduces the recorded HTTP calls');
    assert.doesNotMatch(sys, /nth-child/, 'no UI selector rules in the backend prompt');
    assert.match(prompt.user, /back-end \/ API test/i, 'user header asks for the API test');
    assert.equal(summary.testType, 'backend', 'records the resolved test type');
  });

  it('backend prompt redacts secrets from the captured traffic before model use', () => {
    const { prompt } = buildPrompt({
      ...base,
      kind: 'playwright_test',
      tier: 'pro',
      testType: 'backend',
      sources: [
        {
          label: 'recording.network',
          kind: 'recording',
          text: 'GET /me\n  request headers: authorization: Bearer abc.def.ghi123456',
        },
      ],
    });
    assert.match(prompt.user, /\[REDACTED\]/, 'auth bearer token is redacted');
    assert.doesNotMatch(prompt.user, /abc\.def\.ghi123456/, 'raw token never reaches the prompt');
  });

  it('ui test is unchanged: keeps UI selector rules and records testType=ui', () => {
    const { prompt, summary } = buildPrompt({
      ...base,
      kind: 'playwright_test',
      tier: 'pro',
      testType: 'ui',
      sources: [{ label: 'recording.dom', kind: 'recording', text: '<html>flow</html>' }],
    });
    assert.match(prompt.system, /nth-child/, 'UI rules still forbid positional selectors');
    assert.doesNotMatch(prompt.system, /back-end \/ API test/i, 'no backend wording in the UI prompt');
    assert.equal(summary.testType, 'ui');
  });

  it('defaults to a ui prompt when testType is omitted', () => {
    const { summary } = buildPrompt({
      ...base,
      kind: 'playwright_test',
      tier: 'pro',
      sources: [{ label: 'recording.dom', kind: 'recording', text: 'x' }],
    });
    assert.equal(summary.testType, 'ui');
  });
});
