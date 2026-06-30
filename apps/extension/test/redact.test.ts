import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { maskHeaders, redactBody } from '../src/shared/redact.js';

/**
 * Capture-time masking for network logs (change: configurable-test-type, task
 * 4.2 / 9.3 capture side). Run: node --import tsx --test test/redact.test.ts
 */
describe('network-log capture-time masking', () => {
  it('masks sensitive headers case-insensitively, keeps the rest', () => {
    const out = maskHeaders({
      Authorization: 'Bearer abc.def.ghi',
      Cookie: 'session=xyz',
      'X-Api-Key': 'k-123',
      'Content-Type': 'application/json',
    });
    assert.equal(out.Authorization, '[REDACTED]');
    assert.equal(out.Cookie, '[REDACTED]');
    assert.equal(out['X-Api-Key'], '[REDACTED]');
    assert.equal(out['Content-Type'], 'application/json', 'non-sensitive header preserved');
  });

  it('redacts secret shapes in bodies', () => {
    const body = '{"password":"hunter2","token":"sk-ABCDEFGHIJKLMNOPQRSTUV","ok":true}';
    const out = redactBody(body)!;
    assert.doesNotMatch(out, /hunter2/, 'password value redacted');
    assert.doesNotMatch(out, /sk-ABCDEFGHIJKLMNOPQRSTUV/, 'api key redacted');
    assert.match(out, /"ok":true/, 'non-secret content preserved');
  });

  it('is safe on null bodies', () => {
    assert.equal(redactBody(null), null);
  });
});
