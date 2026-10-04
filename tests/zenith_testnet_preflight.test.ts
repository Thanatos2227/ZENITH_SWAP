import test from 'node:test';
import assert from 'node:assert/strict';
import { runTestnetDiagnostic } from '../scripts/diagnose-testnet';

interface CompletePreflightContext {
  signerPresent: boolean;
  chainId: number;
  expectedChainId: number;
  isMainnetScope: boolean;
  isMockProvider: boolean;
  nativeBalance: bigint;
  requiredNative: bigint;
  tokenBalance: bigint;
  requiredToken: bigint;
  tokenAddress: string | null;
  tokenBytecode: string | null;
  bridgeSpokePool: string | null;
  bridgeBytecode: string | null;
  routerAddress: string | null;
  routerBytecode: string | null;
  expectedRouterBytecodeHash: string | null;
  actualRouterBytecodeHash: string | null;
  isAuthorizedSolver: boolean;
}

function evaluateComprehensiveTestnetPreflight(ctx: CompletePreflightContext): { status: 'READY_FOR_REAL_TESTNET_EXECUTION' | 'BLOCKED'; blockerReason?: string } {
  if (!ctx.signerPresent) {
    return { status: 'BLOCKED', blockerReason: 'BLOCKED_NO_SIGNER: Testnet signer key is not configured' };
  }
  if (ctx.isMainnetScope) {
    return { status: 'BLOCKED', blockerReason: 'BLOCKED_MAINNET_SCOPE_ACCIDENTAL: Mainnet scope selected in testnet execution path' };
  }
  if (ctx.isMockProvider) {
    return { status: 'BLOCKED', blockerReason: 'BLOCKED_MOCK_PROVIDER: Mock/synthetic provider detected in production testnet path' };
  }
  if (ctx.chainId !== ctx.expectedChainId) {
    return { status: 'BLOCKED', blockerReason: `BLOCKED_WRONG_CHAIN: RPC chainId ${ctx.chainId} != expected testnet chainId ${ctx.expectedChainId}` };
  }
  if (ctx.nativeBalance < ctx.requiredNative) {
    return { status: 'BLOCKED', blockerReason: `BLOCKED_INSUFFICIENT_NATIVE_BALANCE: Native gas balance ${ctx.nativeBalance} < required ${ctx.requiredNative}` };
  }
  if (ctx.tokenBalance < ctx.requiredToken) {
    return { status: 'BLOCKED', blockerReason: `BLOCKED_INSUFFICIENT_TOKEN_BALANCE: Token balance ${ctx.tokenBalance} < required ${ctx.requiredToken}` };
  }
  if (!ctx.tokenAddress || !ctx.tokenBytecode || ctx.tokenBytecode === '0x') {
    return { status: 'BLOCKED', blockerReason: 'BLOCKED_INVALID_TOKEN_ADDRESS: Source token contract address invalid or has no bytecode' };
  }
  if (!ctx.bridgeSpokePool || !ctx.bridgeBytecode || ctx.bridgeBytecode === '0x') {
    return { status: 'BLOCKED', blockerReason: 'BLOCKED_INVALID_BRIDGE_ADDRESS: Across SpokePool address invalid or has no bytecode' };
  }
  if (!ctx.routerAddress || !ctx.routerBytecode || ctx.routerBytecode === '0x') {
    return { status: 'BLOCKED', blockerReason: 'BLOCKED_MISSING_CONTRACT_DEPLOYMENT: ZenithCrossChainRouter is not deployed on testnet' };
  }
  if (ctx.expectedRouterBytecodeHash !== ctx.actualRouterBytecodeHash) {
    return { status: 'BLOCKED', blockerReason: 'BLOCKED_WRONG_DEPLOYED_BYTECODE: Deployed router bytecode hash does not match compiled artifact' };
  }
  if (!ctx.isAuthorizedSolver) {
    return { status: 'BLOCKED', blockerReason: 'BLOCKED_INCORRECT_AUTHORIZATION: Signer is not an authorized solver/caller on the router' };
  }

  return { status: 'READY_FOR_REAL_TESTNET_EXECUTION' };
}

test('ZENITH Protocol — Comprehensive Real Testnet Readiness & Preflight Suite', async (t) => {
  const baseReadyCtx: CompletePreflightContext = {
    signerPresent: true,
    chainId: 11155111,
    expectedChainId: 11155111,
    isMainnetScope: false,
    isMockProvider: false,
    nativeBalance: 100000000000000000n, // 0.1 ETH
    requiredNative: 50000000000000000n, // 0.05 ETH
    tokenBalance: 100000000n, // 100 USDC (6 dec)
    requiredToken: 10000000n, // 10 USDC
    tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    tokenBytecode: '0x608060405234801561001057600080fd5b50...',
    bridgeSpokePool: '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662',
    bridgeBytecode: '0x608060405234801561001057600080fd5b50...',
    routerAddress: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
    routerBytecode: '0x608060405234801561001057600080fd5b50...',
    expectedRouterBytecodeHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    actualRouterBytecodeHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    isAuthorizedSolver: true,
  };

  await t.test('1. Missing Signer is Formally Blocked', () => {
    const res = evaluateComprehensiveTestnetPreflight({ ...baseReadyCtx, signerPresent: false });
    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.blockerReason?.includes('BLOCKED_NO_SIGNER'));
  });

  await t.test('2. Wrong Chain ID is Formally Blocked', () => {
    const res = evaluateComprehensiveTestnetPreflight({ ...baseReadyCtx, chainId: 421614 });
    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.blockerReason?.includes('BLOCKED_WRONG_CHAIN'));
  });

  await t.test('3. Insufficient Native Balance Fails Closed', () => {
    const res = evaluateComprehensiveTestnetPreflight({
      ...baseReadyCtx,
      nativeBalance: 10000000000000000n, // 0.01 ETH < 0.05 ETH
    });
    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.blockerReason?.includes('BLOCKED_INSUFFICIENT_NATIVE_BALANCE'));
  });

  await t.test('4. Insufficient Token Balance Fails Closed', () => {
    const res = evaluateComprehensiveTestnetPreflight({
      ...baseReadyCtx,
      tokenBalance: 5000000n, // 5 USDC < 10 USDC
    });
    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.blockerReason?.includes('BLOCKED_INSUFFICIENT_TOKEN_BALANCE'));
  });

  await t.test('5. Invalid Token Address (or Empty Bytecode) is Blocked', () => {
    const res = evaluateComprehensiveTestnetPreflight({
      ...baseReadyCtx,
      tokenBytecode: '0x',
    });
    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.blockerReason?.includes('BLOCKED_INVALID_TOKEN_ADDRESS'));
  });

  await t.test('6. Invalid Bridge Address (or Empty Bytecode) is Blocked', () => {
    const res = evaluateComprehensiveTestnetPreflight({
      ...baseReadyCtx,
      bridgeBytecode: '0x',
    });
    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.blockerReason?.includes('BLOCKED_INVALID_BRIDGE_ADDRESS'));
  });

  await t.test('7. Missing Contract Deployment is Blocked', () => {
    const res = evaluateComprehensiveTestnetPreflight({
      ...baseReadyCtx,
      routerAddress: null,
    });
    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.blockerReason?.includes('BLOCKED_MISSING_CONTRACT_DEPLOYMENT'));
  });

  await t.test('8. Wrong Deployed Bytecode Hash is Blocked', () => {
    const res = evaluateComprehensiveTestnetPreflight({
      ...baseReadyCtx,
      actualRouterBytecodeHash: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });
    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.blockerReason?.includes('BLOCKED_WRONG_DEPLOYED_BYTECODE'));
  });

  await t.test('9. Incorrect Authorization / Unauthorized Solver is Blocked', () => {
    const res = evaluateComprehensiveTestnetPreflight({
      ...baseReadyCtx,
      isAuthorizedSolver: false,
    });
    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.blockerReason?.includes('BLOCKED_INCORRECT_AUTHORIZATION'));
  });

  await t.test('10. Mainnet Configuration Accidentally Selected is Blocked', () => {
    const res = evaluateComprehensiveTestnetPreflight({
      ...baseReadyCtx,
      isMainnetScope: true,
    });
    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.blockerReason?.includes('BLOCKED_MAINNET_SCOPE_ACCIDENTAL'));
  });

  await t.test('11. Mock Provider Accidentally Selected is Blocked', () => {
    const res = evaluateComprehensiveTestnetPreflight({
      ...baseReadyCtx,
      isMockProvider: true,
    });
    assert.equal(res.status, 'BLOCKED');
    assert.ok(res.blockerReason?.includes('BLOCKED_MOCK_PROVIDER'));
  });

  await t.test('12. Successful Readiness when All Prerequisites are Proven', () => {
    const res = evaluateComprehensiveTestnetPreflight(baseReadyCtx);
    assert.equal(res.status, 'READY_FOR_REAL_TESTNET_EXECUTION');
    assert.equal(res.blockerReason, undefined);
  });

  await t.test('13. Authoritative Real Diagnostic Evaluates Fail-Closed', async () => {
    const report = await runTestnetDiagnostic();
    assert.equal(report.network, 'Ethereum Sepolia');
    assert.equal(report.chainId, 11155111);
    assert.equal(report.preflightStatus, 'BLOCKED');
    assert.ok(report.blockerReason?.includes('BLOCKED_NO_FUNDED_KEY'));
  });
});
