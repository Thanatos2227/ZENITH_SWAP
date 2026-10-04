import test from 'node:test';
import assert from 'node:assert/strict';
import { runTestnetDiagnostic } from '../scripts/diagnose-testnet';

interface PreflightContext {
  chainId: number;
  expectedChainId: number;
  routerAddress: string | null;
  tokenAddress: string | null;
  bridgeSpokePool: string | null;
  nativeBalance: bigint;
  requiredNative: bigint;
  tokenBalance: bigint;
  requiredToken: bigint;
}

function evaluatePreflightSafetyGate(ctx: PreflightContext): { passed: boolean; error?: string } {
  if (ctx.chainId !== ctx.expectedChainId) {
    return { passed: false, error: `BLOCKED_WRONG_CHAIN_ID: RPC chainId ${ctx.chainId} != expected ${ctx.expectedChainId}` };
  }
  if (!ctx.routerAddress || ctx.routerAddress === '0x0000000000000000000000000000000000000000') {
    return { passed: false, error: 'BLOCKED_MISSING_ROUTER: Sovereign router address is not deployed' };
  }
  if (!ctx.tokenAddress || ctx.tokenAddress === '0x0000000000000000000000000000000000000000') {
    return { passed: false, error: 'BLOCKED_MISSING_TOKEN: Source asset token contract is missing' };
  }
  if (!ctx.bridgeSpokePool || ctx.bridgeSpokePool === '0x0000000000000000000000000000000000000000') {
    return { passed: false, error: 'BLOCKED_MISSING_BRIDGE: Bridge SpokePool contract is not configured' };
  }
  if (ctx.nativeBalance < ctx.requiredNative) {
    return { passed: false, error: `BLOCKED_INSUFFICIENT_NATIVE_GAS: Balance ${ctx.nativeBalance} < required ${ctx.requiredNative}` };
  }
  if (ctx.tokenBalance < ctx.requiredToken) {
    return { passed: false, error: `BLOCKED_INSUFFICIENT_TOKEN_BALANCE: Token balance ${ctx.tokenBalance} < required ${ctx.requiredToken}` };
  }
  return { passed: true };
}

test('ZENITH Protocol — Testnet Preflight Safety Gate Suite', async (t) => {
  const baseValidCtx: PreflightContext = {
    chainId: 11155111,
    expectedChainId: 11155111,
    routerAddress: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
    tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    bridgeSpokePool: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
    nativeBalance: 100000000000000000n, // 0.1 ETH
    requiredNative: 50000000000000000n, // 0.05 ETH
    tokenBalance: 100000000n, // 100 USDC (6 dec)
    requiredToken: 10000000n, // 10 USDC
  };

  await t.test('1. Valid Preflight Context Passes All Gates', () => {
    const res = evaluatePreflightSafetyGate(baseValidCtx);
    assert.equal(res.passed, true);
    assert.equal(res.error, undefined);
  });

  await t.test('2. Missing Router Address is Formally Rejected', () => {
    const res = evaluatePreflightSafetyGate({ ...baseValidCtx, routerAddress: null });
    assert.equal(res.passed, false);
    assert.ok(res.error?.includes('BLOCKED_MISSING_ROUTER'));
  });

  await t.test('3. Missing Token Address is Formally Rejected', () => {
    const res = evaluatePreflightSafetyGate({ ...baseValidCtx, tokenAddress: null });
    assert.equal(res.passed, false);
    assert.ok(res.error?.includes('BLOCKED_MISSING_TOKEN'));
  });

  await t.test('4. Missing Bridge Contract is Formally Rejected', () => {
    const res = evaluatePreflightSafetyGate({ ...baseValidCtx, bridgeSpokePool: null });
    assert.equal(res.passed, false);
    assert.ok(res.error?.includes('BLOCKED_MISSING_BRIDGE'));
  });

  await t.test('5. Insufficient Native Gas Balance Fails Closed', () => {
    const res = evaluatePreflightSafetyGate({
      ...baseValidCtx,
      nativeBalance: 10000000000000000n, // 0.01 ETH < 0.05 ETH required
    });
    assert.equal(res.passed, false);
    assert.ok(res.error?.includes('BLOCKED_INSUFFICIENT_NATIVE_GAS'));
  });

  await t.test('6. Insufficient Token Balance Fails Closed', () => {
    const res = evaluatePreflightSafetyGate({
      ...baseValidCtx,
      tokenBalance: 5000000n, // 5 USDC < 10 USDC required
    });
    assert.equal(res.passed, false);
    assert.ok(res.error?.includes('BLOCKED_INSUFFICIENT_TOKEN_BALANCE'));
  });

  await t.test('7. RPC Chain ID Mismatch Fails Closed Immediately', () => {
    const res = evaluatePreflightSafetyGate({
      ...baseValidCtx,
      chainId: 421614, // Arbitrum Sepolia RPC provided for Sepolia config
    });
    assert.equal(res.passed, false);
    assert.ok(res.error?.includes('BLOCKED_WRONG_CHAIN_ID'));
  });

  await t.test('8. Safe Testnet Diagnostic Reports Blocked State Deterministically', async () => {
    const diag = await runTestnetDiagnostic('sepolia');
    assert.equal(diag.network, 'Sepolia');
    assert.equal(diag.chainId, 11155111);
    assert.equal(diag.preflightStatus, 'BLOCKED');
    assert.ok(diag.blockerReason?.includes('BLOCKED_NO_FUNDED_KEY'));
  });
});
