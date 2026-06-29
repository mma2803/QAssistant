import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPrompt } from '../src/codegen/prompt-builder.js';

/**
 * Locks in the generator robustness defaults (change:
 * robust-test-generation-defaults). The platform rules live in the system
 * prompt, which OVERRIDES untrusted input, so we assert the rules are present
 * there for the relevant tier.
 */
describe('prompt-builder robustness rules', () => {
  const base = {
    framework: 'Cypress',
    language: 'TypeScript',
    sources: [{ label: 'recording.dom', kind: 'recording', text: '<html>flow</html>' }],
  };

  it('Pro tier carries selectors, assert-effect, base URL, invariants, and flagged-state precedence', () => {
    const { prompt } = buildPrompt({ ...base, kind: 'playwright_test', tier: 'pro' });
    const sys = prompt.system;
    assert.match(sys, /nth-child/, 'forbids positional selectors');
    assert.match(sys, /EFFECT of each action/i, 'asserts the effect of state-changing actions');
    assert.match(sys, /project\.base_url/, 'targets the project base URL');
    assert.match(sys, /state relations and invariants/i, 'invariants over exact values');
    assert.match(sys, /takes precedence/i, 'tester-flagged exact value still wins');
  });

  it('Flash tier carries the selector + base-URL subset (assertions stay optional)', () => {
    const { prompt } = buildPrompt({ ...base, kind: 'replay_script', tier: 'flash' });
    const sys = prompt.system;
    assert.match(sys, /nth-child/, 'forbids positional selectors in replay too');
    assert.match(sys, /project\.base_url/, 'targets the base URL in replay too');
    assert.match(sys, /Assertions are optional/i, 'replay keeps assertions optional');
  });
});
