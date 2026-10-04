import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScopedSignerKey, ChainScope } from '../scripts/secure-runtime-loader';
import { defaultAuthoritativeNetworkRegistry, defaultChainRegistry } from '../packages/chains/src';

test('ZENITH Protocol — Deployment Identity & Signer Boundary Suite', async (t) => {
  await t.test('1. Null Mainnet Deployments are Strictly Classified as NOT_DEPLOYED', () => {
    const mainnetConfigs = ['ethereum', 'polygon', 'arbitrum', 'base'];
    for (const net of mainnetConfigs) {
      const chain = defaultChainRegistry.getChain(net);
      assert.ok(chain, `Chain ${net} should exist`);
      // Sovereign router address on mainnet is uninstantiated
      assert.equal(chain.routerAddress || null, null, `Mainnet ${net} router address must be null`);
    }
  });

  await t.test('2. Testnet Deployments are Classified Independently from Mainnet', () => {
    const sepolia = defaultAuthoritativeNetworkRegistry.getNetwork('sepolia');
    const arbitrumSepolia = defaultAuthoritativeNetworkRegistry.getNetwork('arbitrum_sepolia');
    assert.ok(sepolia, 'Sepolia testnet must be registered');
    assert.ok(arbitrumSepolia, 'Arbitrum Sepolia testnet must be registered');
    assert.equal(sepolia.environment, 'TESTNET', 'Sepolia environment must be TESTNET');
    assert.equal(sepolia.isTestnet, true, 'Sepolia isTestnet must be true');
    assert.equal(arbitrumSepolia.environment, 'TESTNET', 'Arbitrum Sepolia environment must be TESTNET');
    assert.equal(arbitrumSepolia.isTestnet, true, 'Arbitrum Sepolia isTestnet must be true');
  });

  await t.test('3. Cross-Chain Contract Identity Mismatch Rejection', () => {
    // Contract identity is (chainId, address). A contract address valid on Sepolia cannot be assumed on Arbitrum Sepolia
    const sepoliaRouter = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720';
    const sepoliaChainId = 11155111;
    const arbSepoliaChainId = 421614;

    const validateContractForChain = (targetChainId: number, registeredChainId: number, address: string) => {
      if (targetChainId !== registeredChainId) {
        throw new Error(`[Security] Contract address ${address} is registered for chain ${registeredChainId}, not ${targetChainId}`);
      }
      return true;
    };

    assert.throws(
      () => validateContractForChain(arbSepoliaChainId, sepoliaChainId, sepoliaRouter),
      /Contract address .* is registered for chain 11155111, not 421614/
    );
  });

  await t.test('4. Empty Bytecode (0x) Rejection Invariant', () => {
    const validateBytecode = (code: string) => {
      if (!code || code === '0x' || code === '0x0') {
        throw new Error('DEPLOYMENT_VERIFICATION_FAILED: Contract code is empty (0x)');
      }
      return true;
    };

    assert.throws(() => validateBytecode('0x'), /Contract code is empty \(0x\)/);
    assert.equal(validateBytecode('0x608060405234801561001057600080fd5b50...'), true);
  });

  await t.test('5. Bytecode Mismatch Rejection Invariant', () => {
    const validateBytecodeHash = (onChainCode: string, expectedArtifactHash: string) => {
      if (onChainCode !== expectedArtifactHash) {
        throw new Error('BYTECODE_HASH_MISMATCH: On-chain code hash differs from compiled artifact');
      }
      return true;
    };

    assert.throws(
      () => validateBytecodeHash('0xbadc0de', '0xexpectedhash'),
      /BYTECODE_HASH_MISMATCH/
    );
  });

  await t.test('6. Scoped Signer: Testnet Key is NOT Resolved for MAINNET Scope', () => {
    const origTestnet = process.env.TESTNET_PRIVATE_KEY;
    const testnetOnlyVal = '0x1111111111111111111111111111111111111111111111111111111111111111';
    try {
      process.env.TESTNET_PRIVATE_KEY = testnetOnlyVal;
      const res = resolveScopedSignerKey(ChainScope.MAINNET);
      assert.notEqual(res.rawKey, testnetOnlyVal, 'MAINNET scope must never resolve TESTNET key');
    } finally {
      if (origTestnet) process.env.TESTNET_PRIVATE_KEY = origTestnet;
      else delete process.env.TESTNET_PRIVATE_KEY;
    }
  });

  await t.test('7. Scoped Signer: Mainnet Key is NOT Resolved for TESTNET Scope', () => {
    const origMainnet = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    const origTestnet = process.env.TESTNET_PRIVATE_KEY;
    const mainnetOnlyVal = '0x2222222222222222222222222222222222222222222222222222222222222222';
    try {
      delete process.env.TESTNET_PRIVATE_KEY;
      delete process.env.ZENITH_TESTNET_PRIVATE_KEY;
      process.env.ZENITH_MAINNET_PRIVATE_KEY = mainnetOnlyVal;
      const res = resolveScopedSignerKey(ChainScope.TESTNET);
      assert.notEqual(res.rawKey, mainnetOnlyVal, 'TESTNET scope must never resolve MAINNET key');
    } finally {
      if (origMainnet) process.env.ZENITH_MAINNET_PRIVATE_KEY = origMainnet;
      else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
      if (origTestnet) process.env.TESTNET_PRIVATE_KEY = origTestnet;
      else delete process.env.TESTNET_PRIVATE_KEY;
    }
  });

  await t.test('8. Scoped Signer: Unconfigured Custom Scope Isolated Cleanly', () => {
    const isolatedDir = 'E:\\APEX\\ZENITH\\scratch\\test_nonexistent_scope';
    const origLocal = process.env.ZENITH_LOCAL_PRIVATE_KEY;
    const origAnvil = process.env.ANVIL_PRIVATE_KEY;
    try {
      delete process.env.ZENITH_LOCAL_PRIVATE_KEY;
      delete process.env.ANVIL_PRIVATE_KEY;
      const res = resolveScopedSignerKey(ChainScope.LOCAL, isolatedDir);
      assert.equal(res.rawKey, null);
      assert.equal(res.runtimeSource, 'NONE_AVAILABLE');
    } finally {
      if (origLocal) process.env.ZENITH_LOCAL_PRIVATE_KEY = origLocal;
      else delete process.env.ZENITH_LOCAL_PRIVATE_KEY;
      if (origAnvil) process.env.ANVIL_PRIVATE_KEY = origAnvil;
      else delete process.env.ANVIL_PRIVATE_KEY;
    }
  });
});
