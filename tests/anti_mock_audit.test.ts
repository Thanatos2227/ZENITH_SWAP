import test from 'node:test';
import assert from 'node:assert/strict';
import { runAudit } from '../scripts/audit-anti-mock';

test('ZENITH Anti-Mock and Anti-Simulation Policy Audit', () => {
  const violations = runAudit();

  if (violations.length > 0) {
    console.error('Audit violations found:', violations);
  }

  assert.equal(violations.length, 0, `Expected 0 violations but found ${violations.length}`);
});
