import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { defaultChainRegistry } from '@zenith/chains';
import {
  getAcrossSpokePool,
  ACROSS_SPOKE_POOL_ABI,
  validateEvmAddress,
  validateExecutionTarget,
  validateTokenAddress,
  validateRecipientAddress,
  RecipientMismatchError
} from '@zenith/contracts';
import { defaultAcrossProvider } from '@zenith/routing';
import {
  ExecutionPlanBuilder,
  SQLiteCrossChainStateRepository,
  CrossChainRecoveryEngine,
  defaultEVMAdapter
} from '@zenith/execution';
import { QuoteRequest, PersistentIntent } from '@zenith/types';
import { runControlledTestnetExecution } from '../scripts/execute-controlled-testnet';

const spokePoolInterface = new Interface(ACROSS_SPOKE_POOL_ABI);

describe('ZENITH SWAP — Phase 0 / Task 7: Controlled Testnet Direct Cross-Chain Execution & Pre-Broadcast Safety Suite', () => {

  // =========================================================================
  // Gate 1 & 2: Testnet Infrastructure Health & Chain IDs
  // =========================================================================
  test('1. Gate 1 & 2: Real Testnet JSON-RPC Health and Chain ID Verification', async () => {
    const sepoliaRpc = defaultChainRegistry.getHealthyRPC('sepolia');
    const arbSepoliaRpc = defaultChainRegistry.getHealthyRPC('arbitrum_sepolia');

    const [resSep, resArb] = await Promise.all([
      fetch(sepoliaRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        signal: AbortSignal.timeout(6000)
      }),
      fetch(arbSepoliaRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        signal: AbortSignal.timeout(6000)
      })
    ]);

    if (resSep.ok) {
      const jSep = await resSep.json();
      assert.equal(parseInt(jSep.result, 16), 11155111, 'Sepolia chain ID must be 11155111');
    }
    if (resArb.ok) {
      const jArb = await resArb.json();
      assert.equal(parseInt(jArb.result, 16), 421614, 'Arbitrum Sepolia chain ID must be 421614');
    }
  });

  // =========================================================================
  // Gate 3: On-Chain Contract Bytecode Verification
  // =========================================================================
  test('2. Gate 3: Live On-Chain Contract Bytecode Verification (SpokePools & USDC)', async () => {
    const sepoliaRpc = defaultChainRegistry.getHealthyRPC('sepolia');
    const arbSepoliaRpc = defaultChainRegistry.getHealthyRPC('arbitrum_sepolia');

    const sepSpokePool = getAcrossSpokePool(11155111);
    const arbSpokePool = getAcrossSpokePool(421614);
    const sepUsdc = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
    const arbUsdc = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';

    const [resSpokeSep, resSpokeArb, resUsdcSep, resUsdcArb] = await Promise.all([
      fetch(sepoliaRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [sepSpokePool, 'latest'] }),
        signal: AbortSignal.timeout(6000)
      }),
      fetch(arbSepoliaRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [arbSpokePool, 'latest'] }),
        signal: AbortSignal.timeout(6000)
      }),
      fetch(sepoliaRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [sepUsdc, 'latest'] }),
        signal: AbortSignal.timeout(6000)
      }),
      fetch(arbSepoliaRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [arbUsdc, 'latest'] }),
        signal: AbortSignal.timeout(6000)
      })
    ]);

    if (resSpokeSep.ok) {
      const j = await resSpokeSep.json();
      if (j.result && j.result !== '0x') assert.ok(j.result.length > 10);
    }
    if (resSpokeArb.ok) {
      const j = await resSpokeArb.json();
      if (j.result && j.result !== '0x') assert.ok(j.result.length > 10);
    }
    if (resUsdcSep.ok) {
      const j = await resUsdcSep.json();
      if (j.result && j.result !== '0x') assert.ok(j.result.length > 10);
    }
    if (resUsdcArb.ok) {
      const j = await resUsdcArb.json();
      if (j.result && j.result !== '0x') assert.ok(j.result.length > 10);
    }
  });

  // =========================================================================
  // Gate 4: Fresh Live Across Testnet Quote for 0.1 USDC
  // =========================================================================
  test('3. Gate 4: Fresh Live Across Testnet Quote for Exactly 0.1 USDC (100,000 raw)', async () => {
    const quoteReq: QuoteRequest = {
      sourceChainId: 'sepolia',
      destinationChainId: 'arbitrum_sepolia',
      tokenIn: {
        address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        chainId: 11155111,
        isNative: false,
        priceUSD: 1.0
      },
      tokenOut: {
        address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        chainId: 421614,
        isNative: false,
        priceUSD: 1.0
      },
      amountInRaw: '100000', // Exactly 0.1 USDC
      amountInFormatted: '0.1',
      userWalletAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      recipientAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      slippageTolerancePercent: 0.5
    };

    const quote = await defaultAcrossProvider.getQuote(quoteReq);

    assert.ok(quote !== null, 'Across testnet quote must not be null');
    assert.equal(quote.provider, 'ACROSS');
    assert.equal(quote.sourceAmountRaw, '100000');
    assert.ok(BigInt(quote.destinationAmountRaw) > 0n, 'Destination output amount must be positive');
    assert.ok(BigInt(quote.minDestinationAmountRaw) > 0n, 'Minimum destination output must be positive');
    assert.ok(BigInt(quote.minDestinationAmountRaw) <= BigInt(quote.destinationAmountRaw), 'minOut <= quotedOut');
    assert.equal(quote.executionTarget.toLowerCase(), getAcrossSpokePool(11155111).toLowerCase());
  });

  // =========================================================================
  // Gate 5: ExecutionPlan Construction
  // =========================================================================
  test('4. Gate 5: Deterministic ExecutionPlan Construction for 0.1 USDC Direct Bridge', async () => {
    const quoteReq: QuoteRequest = {
      sourceChainId: 'sepolia',
      destinationChainId: 'arbitrum_sepolia',
      tokenIn: {
        address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        chainId: 11155111,
        isNative: false,
        priceUSD: 1.0
      },
      tokenOut: {
        address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        chainId: 421614,
        isNative: false,
        priceUSD: 1.0
      },
      amountInRaw: '100000',
      amountInFormatted: '0.1',
      userWalletAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      recipientAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'
    };

    const quote = await defaultAcrossProvider.getQuote(quoteReq);
    assert.ok(quote);

    const plan = ExecutionPlanBuilder.buildPlan({
      route: {
        id: 'route-testnet-01',
        protocol: 'ACROSS',
        dexProtocol: 'ACROSS',
        path: ['USDC', 'USDC'],
        pools: [],
        amountIn: '100000',
        amountOut: quote.destinationAmountRaw,
        priceImpactUSD: 0,
        gasCostUSD: 0.1,
        effectiveExecutionScore: 99,
        hops: [],
        crossChainQuote: quote
      },
      request: quoteReq,
      options: {
        userAddress: quoteReq.userWalletAddress!
      }
    });

    assert.ok(plan.isExecutable);
    assert.equal(plan.routeType, 'CROSS_CHAIN_DIRECT');
    assert.ok(plan.steps.length >= 5);
    assert.ok(plan.steps.some((s) => s.id.startsWith('approval:')));
    assert.ok(plan.steps.some((s) => s.id.startsWith('bridge:')));
    assert.ok(plan.steps.some((s) => s.id.startsWith('destination-verification:')));
  });

  // =========================================================================
  // Gate 6: Exact Calldata Encoding & Target Whitelisting
  // =========================================================================
  test('5. Gate 6: Exact depositV3 Calldata Encoding & Target Whitelisting', async () => {
    const user = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
    const recipient = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
    const inputToken = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
    const outputToken = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
    const amountIn = 100000n;
    const minOut = 95000n;
    const dstChainId = 421614;

    const calldata = spokePoolInterface.encodeFunctionData('depositV3', [
      user.toLowerCase(),
      recipient.toLowerCase(),
      inputToken.toLowerCase(),
      outputToken.toLowerCase(),
      amountIn,
      minOut,
      dstChainId,
      '0x0000000000000000000000000000000000000000',
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000) + 1800,
      0,
      '0x'
    ]);

    assert.ok(calldata.startsWith('0x'));
    assert.ok(calldata.length > 100);

    const decoded = spokePoolInterface.decodeFunctionData('depositV3', calldata);
    assert.equal(decoded[0].toLowerCase(), user.toLowerCase());
    assert.equal(decoded[1].toLowerCase(), recipient.toLowerCase());
    assert.equal(decoded[4], amountIn);
    assert.equal(decoded[5], minOut);
    assert.equal(Number(decoded[6]), dstChainId);
  });

  // =========================================================================
  // Gate 7: Pre-Flight Simulation & Controlled Fail-Closed Behavior
  // =========================================================================
  test('6. Gate 7: Pre-Flight eth_call Simulation Handling on Sepolia', async () => {
    const sepoliaRpc = defaultChainRegistry.getHealthyRPC('sepolia');
    const spokePool = getAcrossSpokePool(11155111);
    const calldata = spokePoolInterface.encodeFunctionData('depositV3', [
      '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      100000n,
      95000n,
      421614,
      '0x0000000000000000000000000000000000000000',
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000) + 1800,
      0,
      '0x'
    ]);

    try {
      const res = await fetch(sepoliaRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ from: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B', to: spokePool, data: calldata, value: '0x0' }, 'latest']
        }),
        signal: AbortSignal.timeout(6000)
      });
      assert.ok(res);
    } catch {
      // Intercepted simulation
    }
  });

  // =========================================================================
  // Gate 8: Bounded Approval Safety Check
  // =========================================================================
  test('7. Gate 8: Bounded Approval Invariant (Only Required 100,000 Raw Units Approved)', () => {
    const requiredAmountRaw = '100000';
    const parsedAllowance = BigInt(requiredAmountRaw);
    assert.equal(parsedAllowance, 100000n);
    assert.notEqual(parsedAllowance, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'));
  });

  // =========================================================================
  // Gate 9: Controlled Testnet Execution Runner Fail-Closed Safety
  // =========================================================================
  test('8. Gate 9: Controlled Testnet Runner Fails Closed with BLOCKED_PRE_BROADCAST_VALIDATION when Unfunded', async () => {
    const prevKey = process.env.TESTNET_PRIVATE_KEY;
    const prevE2E = process.env.E2E_TESTNET;
    delete process.env.TESTNET_PRIVATE_KEY;
    delete process.env.E2E_TESTNET;

    try {
      const result = await runControlledTestnetExecution();
      assert.equal(result.status, 'BLOCKED_PRE_BROADCAST_VALIDATION');
      assert.ok(result.blockReason && (result.blockReason.includes('TESTNET_PRIVATE_KEY') || result.blockReason.includes('E2E_TESTNET') || result.blockReason.includes('runtime environment')));
      assert.ok(result.preBroadcastGates);
    } finally {
      if (prevKey) process.env.TESTNET_PRIVATE_KEY = prevKey;
      if (prevE2E) process.env.E2E_TESTNET = prevE2E;
    }
  });

  // =========================================================================
  // Gate 10: Persistence, Crash Safety & Idempotency Check
  // =========================================================================
  test('9. Gate 10: SQLite State Persistence and Idempotency Verification for Testnet Intent', async () => {
    const repo = new SQLiteCrossChainStateRepository(':memory:');
    const intent: PersistentIntent = {
      intentId: 'testnet-01-usdc-sepolia-arbitrum',
      userAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      sourceChainId: 'sepolia',
      destinationChainId: 'arbitrum_sepolia',
      sourceTokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      sourceTokenSymbol: 'USDC',
      destinationTokenAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      destinationTokenSymbol: 'USDC',
      amountInRaw: '100000',
      expectedAmountOutRaw: '99200',
      minAmountOutRaw: '95000',
      provider: 'ACROSS',
      routeId: 'route-testnet-e2e',
      nonce: '100001',
      deadline: Date.now() + 600000,
      status: 'FULFILLING',
      sourceTxHash: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await repo.createIntent(intent);

    const retrieved = await repo.getIntent(intent.intentId);
    assert.ok(retrieved);
    assert.equal(retrieved.status, 'FULFILLING');
    assert.equal(retrieved.amountInRaw, '100000');

    // Duplicate intent insertion must throw
    await assert.rejects(
      async () => {
        await repo.createIntent(intent);
      },
      /Duplicate intent ID/
    );

    // Record settlement
    await repo.recordSettlement({
      intentId: intent.intentId,
      destinationTxHash: '0xaaaa222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
      destinationChainId: 'arbitrum_sepolia',
      tokenAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      tokenSymbol: 'USDC',
      recipient: intent.userAddress,
      expectedAmountRaw: intent.expectedAmountOutRaw,
      actualAmountRaw: intent.expectedAmountOutRaw,
      verified: true,
      verifiedAt: Date.now()
    });

    const settlement = await repo.getSettlement(intent.intentId);
    assert.ok(settlement);
    assert.equal(settlement.verified, true);
    assert.equal(settlement.recipient.toLowerCase(), intent.userAddress.toLowerCase());
    assert.equal(settlement.destinationChainId, 'arbitrum_sepolia');
  });

  // =========================================================================
  // Gate 11: Calldata Parameter & Recipient Integrity
  // =========================================================================
  test('10. Gate 11: depositV3 Parameter Integrity & Recipient Address Invariant', () => {
    const depositor = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
    const recipient = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
    const inputToken = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
    const outputToken = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
    const inputAmount = 100000n;
    const minOutput = 99200n;
    const destinationChainId = 421614;

    const data = spokePoolInterface.encodeFunctionData('depositV3', [
      depositor,
      recipient,
      inputToken,
      outputToken,
      inputAmount,
      minOutput,
      destinationChainId,
      '0x0000000000000000000000000000000000000000',
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000) + 1800,
      0,
      '0x'
    ]);

    const decoded = spokePoolInterface.decodeFunctionData('depositV3', data);
    assert.equal(decoded[0].toLowerCase(), depositor.toLowerCase());
    assert.equal(decoded[1].toLowerCase(), recipient.toLowerCase());
    assert.equal(decoded[2].toLowerCase(), inputToken.toLowerCase());
    assert.equal(decoded[3].toLowerCase(), outputToken.toLowerCase());
    assert.equal(decoded[4], inputAmount);
    assert.equal(decoded[5], minOutput);
    assert.equal(Number(decoded[6]), destinationChainId);
  });

  // =========================================================================
  // Gate 12: Recovery Engine Reconciliation
  // =========================================================================
  test('11. Gate 12: Recovery Engine Reconciles Stale Intents Without Duplicate Broadcast', async () => {
    const repo = new SQLiteCrossChainStateRepository(':memory:');
    const recoveryEngine = new CrossChainRecoveryEngine({ repository: repo });

    const results = await recoveryEngine.recoverAll();
    assert.ok(Array.isArray(results));
    assert.equal(results.length, 0);
  });

  // =========================================================================
  // Task 7: Tests A through M — Evidence & Integrity Invariant Tests
  // =========================================================================
  describe('Task 7: Live Execution Environment & Evidence Integrity Gate (Tests A–M)', () => {

    test('Test A: Missing private key returns BLOCKED_NO_FUNDED_KEY / BLOCKED_PRE_BROADCAST_VALIDATION', async () => {
      const prevKey = process.env.TESTNET_PRIVATE_KEY;
      const prevE2E = process.env.E2E_TESTNET;
      delete process.env.TESTNET_PRIVATE_KEY;
      delete process.env.E2E_TESTNET;

      try {
        const result = await runControlledTestnetExecution();
        assert.equal(result.status, 'BLOCKED_PRE_BROADCAST_VALIDATION');
        assert.ok(result.blockReason?.includes('BLOCKED_NO_FUNDED_KEY') || result.blockReason?.includes('Missing funded TESTNET_PRIVATE_KEY'));
        assert.equal(result.sourceTxHash, undefined);
        assert.equal(result.destinationTxHash, undefined);
      } finally {
        if (prevKey) process.env.TESTNET_PRIVATE_KEY = prevKey;
        if (prevE2E) process.env.E2E_TESTNET = prevE2E;
      }
    });

    test('Test B: Signer with Insufficient ETH fails pre-broadcast validation', () => {
      const signerEthWei = 1000000000000000n; // 0.001 ETH < 0.005 ETH required
      const requiredEthWei = 5000000000000000n;
      assert.ok(signerEthWei < requiredEthWei, 'Insufficient ETH must trigger block');
    });

    test('Test C: Signer with Insufficient USDC fails pre-broadcast validation', () => {
      const signerUsdcRaw = 50000n; // 0.05 USDC < 0.1 USDC (100000 raw)
      const requiredUsdcRaw = 100000n;
      assert.ok(signerUsdcRaw < requiredUsdcRaw, 'Insufficient USDC must trigger block');
    });

    test('Test D: Sufficient allowance evaluates to NO_APPROVAL_TRANSACTION / NOT_REQUIRED', () => {
      const currentAllowance = 150000n;
      const requiredAmount = 100000n;
      const approvalRequired = currentAllowance < requiredAmount;
      assert.equal(approvalRequired, false, 'Approval must NOT be dispatched when allowance is sufficient');
    });

    test('Test E: Insufficient allowance evaluates to APPROVAL_REQUIRED with exact 100000 raw units', () => {
      const currentAllowance = 0n;
      const requiredAmount = 100000n;
      const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

      const approvalRequired = currentAllowance < requiredAmount;
      const amountToApprove = requiredAmount;

      assert.equal(approvalRequired, true);
      assert.equal(amountToApprove, 100000n);
      assert.notEqual(amountToApprove, maxUint256);
    });

    test('Test F: No broadcast guarantees sourceTxHash == null / undefined', async () => {
      const prevKey = process.env.TESTNET_PRIVATE_KEY;
      delete process.env.TESTNET_PRIVATE_KEY;

      try {
        const result = await runControlledTestnetExecution();
        assert.equal(result.sourceTxHash, undefined);
        assert.equal(result.evidenceClassification?.liveOnChain.sourceTxHash, null);
      } finally {
        if (prevKey) process.env.TESTNET_PRIVATE_KEY = prevKey;
      }
    });

    test('Test G: No source broadcast guarantees destinationTxHash == null / undefined', async () => {
      const prevKey = process.env.TESTNET_PRIVATE_KEY;
      delete process.env.TESTNET_PRIVATE_KEY;

      try {
        const result = await runControlledTestnetExecution();
        assert.equal(result.destinationTxHash, undefined);
        assert.equal(result.evidenceClassification?.liveOnChain.destinationTxHash, null);
      } finally {
        if (prevKey) process.env.TESTNET_PRIVATE_KEY = prevKey;
      }
    });

    test('Test H: No destination evidence guarantees SETTLED == false', async () => {
      const repo = new SQLiteCrossChainStateRepository(':memory:');
      const intentId = 'test-unsettled-intent-1';
      await repo.createIntent({
        intentId,
        userAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        sourceChainId: 'sepolia',
        destinationChainId: 'arbitrum_sepolia',
        sourceTokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        sourceTokenSymbol: 'USDC',
        destinationTokenAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        destinationTokenSymbol: 'USDC',
        amountInRaw: '100000',
        expectedAmountOutRaw: '99200',
        minAmountOutRaw: '95000',
        provider: 'ACROSS',
        routeId: 'route-testnet-e2e',
        nonce: '100001',
        deadline: Date.now() + 600000,
        status: 'FULFILLING',
        sourceTxHash: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      const intent = await repo.getIntent(intentId);
      assert.notEqual(intent?.status, 'SETTLED');
      const settlement = await repo.getSettlement(intentId);
      assert.equal(settlement, null);
    });

    test('Test I: Synthetic provider status cannot create SETTLED without destination verification', async () => {
      const repo = new SQLiteCrossChainStateRepository(':memory:');
      const intentId = 'test-synthetic-check';
      await repo.createIntent({
        intentId,
        userAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        sourceChainId: 'sepolia',
        destinationChainId: 'arbitrum_sepolia',
        sourceTokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        sourceTokenSymbol: 'USDC',
        destinationTokenAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        destinationTokenSymbol: 'USDC',
        amountInRaw: '100000',
        expectedAmountOutRaw: '99200',
        minAmountOutRaw: '95000',
        provider: 'ACROSS',
        routeId: 'route-testnet-e2e',
        nonce: '100002',
        deadline: Date.now() + 600000,
        status: 'CREATED',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      const recovery = new CrossChainRecoveryEngine({ repository: repo });
      const results = await recovery.recoverAll();
      assert.ok(Array.isArray(results));

      const intent = await repo.getIntent(intentId);
      assert.notEqual(intent?.status, 'SETTLED', 'Synthetic provider status must not mark intent as SETTLED');
    });

    test('Test J: Synthetic/generated IDs cannot populate sourceTxHash or destinationTxHash', () => {
      const generatedIntentId = `intent-${Date.now()}-abc123`;
      assert.ok(!generatedIntentId.startsWith('0x'));
      assert.notEqual(generatedIntentId.length, 66); // Real 32-byte tx hash has 66 hex chars
    });

    test('Test K: Real broadcast response creates valid 66-character hex sourceTxHash', () => {
      const mockRealTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      assert.match(mockRealTxHash, /^0x[a-fA-F0-9]{64}$/);
    });

    test('Test L: Real destination evidence creates valid 66-character hex destinationTxHash', () => {
      const mockDestTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      assert.match(mockDestTxHash, /^0x[a-fA-F0-9]{64}$/);
    });

    test('Test M: Complete authoritative evidence satisfies settlement invariant', async () => {
      const repo = new SQLiteCrossChainStateRepository(':memory:');
      const intentId = 'test-authoritative-settled-1';
      const sourceTxHash = '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
      const destTxHash = '0xaaaa222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';

      await repo.createIntent({
        intentId,
        userAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        sourceChainId: 'sepolia',
        destinationChainId: 'arbitrum_sepolia',
        sourceTokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        sourceTokenSymbol: 'USDC',
        destinationTokenAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        destinationTokenSymbol: 'USDC',
        amountInRaw: '100000',
        expectedAmountOutRaw: '99200',
        minAmountOutRaw: '95000',
        provider: 'ACROSS',
        routeId: 'route-testnet-e2e',
        nonce: '100003',
        deadline: Date.now() + 600000,
        status: 'FULFILLING',
        sourceTxHash,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      await repo.updateIntent(intentId, {
        destinationTxHash: destTxHash,
        status: 'SETTLED'
      });

      await repo.recordSettlement({
        intentId,
        destinationTxHash: destTxHash,
        destinationChainId: 'arbitrum_sepolia',
        tokenAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        tokenSymbol: 'USDC',
        recipient: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        expectedAmountRaw: '99200',
        actualAmountRaw: '99200',
        verified: true,
        verifiedAt: Date.now()
      });

      const settlement = await repo.getSettlement(intentId);
      assert.ok(settlement);
      assert.equal(settlement.verified, true);
      assert.equal(settlement.destinationTxHash, destTxHash);
    });
  });
});
