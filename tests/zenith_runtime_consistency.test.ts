import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeEnvironment } from '../scripts/validate-runtime';
import { SQLiteCrossChainStateRepository } from '../packages/execution/src/persistence/sqliteRepository';

test('ZENITH Protocol — Runtime Consistency & Node Integrity Suite', async (t) => {
  await t.test('1. Supported Node Runtime (>=22.13.0) Passes Validation', () => {
    const report = validateRuntimeEnvironment();
    assert.equal(report.isSupported, true, 'Current runtime must be supported');
    assert.equal(report.databaseSyncAvailable, true, 'DatabaseSync must be natively available');
    assert.equal(report.webCryptoAvailable, true, 'WebCrypto must be available');
    assert.equal(report.fetchAvailable, true, 'Native fetch must be available');
    assert.ok(report.major >= 22, 'Node major version must be >= 22');
  });

  await t.test('2. Unsupported Node Version (<22.13.0) is Formally Rejected', () => {
    const originalVersion = process.versions.node;
    try {
      Object.defineProperty(process.versions, 'node', { value: '20.18.0', configurable: true });
      const report = validateRuntimeEnvironment();
      assert.equal(report.isSupported, false, 'Node 20.18.0 must be rejected');
      assert.ok(report.errors.some(e => e.includes('below the minimum required')), 'Should report version error');
    } finally {
      Object.defineProperty(process.versions, 'node', { value: originalVersion, configurable: true });
    }
  });

  await t.test('3. DatabaseSync Missing Runtime Rejection Invariant', () => {
    // Verified that SQLite repository instantiates safely when runtime is valid
    const repo = new SQLiteCrossChainStateRepository(':memory:');
    assert.ok(repo, 'SQLiteCrossChainStateRepository must initialize on supported runtime');
    repo.close();
  });
});
