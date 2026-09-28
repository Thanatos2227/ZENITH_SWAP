import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { Wallet } from 'ethers';
import {
  resolveSecureSignerKey,
  isGitIgnoredFile
} from '../scripts/secure-runtime-loader';
import { runSafeSignerProbe } from '../scripts/probe-signer';
import { EXPECTED_OPERATOR_ADDRESS } from '../scripts/execute-controlled-polygon-crosschain';

test('ZENITH Secure Runtime Signer Loader & Probe Diagnostic Suite', async (t) => {
  const repoRoot = path.resolve(__dirname, '..');

  await t.test('1. .gitignore verification: .env and .env.local are strictly ignored', () => {
    assert.equal(isGitIgnoredFile(repoRoot, '.env'), true);
    assert.equal(isGitIgnoredFile(repoRoot, '.env.local'), true);
    assert.equal(isGitIgnoredFile(repoRoot, 'package.json'), false);
  });

  await t.test('2. Missing configuration: fails closed with NONE_AVAILABLE and EMPTY_KEY', async () => {
    const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    const origLegacy = process.env.TESTNET_PRIVATE_KEY;
    try {
      delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
      delete process.env.TESTNET_PRIVATE_KEY;
      delete process.env.ZENITH_PRIVATE_KEY;
      delete process.env.PRIVATE_KEY;

      const result = await runSafeSignerProbe();
      assert.equal(result.signerConfigPresent, false);
      assert.equal(result.signerProviderInitialized, false);
      assert.equal(result.signingGate, 'BLOCKED');
      assert.equal(result.authorizedAddressMatch, false);
      assert.equal(result.derivedAddress, 'NONE');
    } finally {
      if (origKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      if (origLegacy) process.env.TESTNET_PRIVATE_KEY = origLegacy;
    }
  });

  await t.test('3. Synthetic non-compromised key matching check: verifies address match logic', async () => {
    // Generate a temporary mock wallet for verification of derivation without exposure
    const tempWallet = Wallet.createRandom();

    const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    try {
      process.env.ZENITH_MAINNET_PRIVATE_KEY = tempWallet.privateKey;

      const result = await runSafeSignerProbe();
      assert.equal(result.signerRuntimeSource, 'PROCESS_ENV');
      assert.equal(result.signerConfigPresent, true);
      assert.equal(result.signerProviderInitialized, true);
      assert.equal(result.derivedAddress.toLowerCase(), tempWallet.address.toLowerCase());
      // Random wallet does not match authorized operator, so fails closed immediately
      assert.equal(result.authorizedAddressMatch, false);
      assert.equal(result.signingGate, 'BLOCKED');
      assert.equal(result.errorCode, 'SIGNER_ADDRESS_MISMATCH');
    } finally {
      if (origKey) {
        process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      } else {
        delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
      }
    }
  });

  await t.test('4. Local gitignored file resolution: parses key safely without exposure', () => {
    const testEnvFile = path.join(repoRoot, '.env.local');
    const tempWallet = Wallet.createRandom();
    const prevExists = fs.existsSync(testEnvFile);
    const prevContent = prevExists ? fs.readFileSync(testEnvFile, 'utf8') : null;

    try {
      fs.writeFileSync(testEnvFile, `ZENITH_MAINNET_PRIVATE_KEY=${tempWallet.privateKey}\n`, 'utf8');
      // Ensure process.env is clean so it falls through to file
      const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
      delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
      try {
        const res = resolveSecureSignerKey(repoRoot);
        assert.equal(res.runtimeSource, 'LOCAL_GITIGNORED_ENV');
        assert.equal(res.rawKey, tempWallet.privateKey);
      } finally {
        if (origKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      }
    } finally {
      if (prevExists && prevContent !== null) {
        fs.writeFileSync(testEnvFile, prevContent, 'utf8');
      } else if (fs.existsSync(testEnvFile)) {
        fs.unlinkSync(testEnvFile);
      }
    }
  });
});
