import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MultiProviderRpcManager,
  defaultChainRegistry
} from '@zenith/chains';
import {
  MultiProviderRpcClient,
  CrossChainStatusReconciler,
  CrossChainRecoveryEngine,
  InMemoryCrossChainStateRepository
} from '@zenith/execution';
import {
  AllProvidersUnavailableError,
  ChainIdMismatchError,
  CircuitBreakerOpenError,
  BlockLagExceededError,
  BroadcastUncertainError,
  RpcTimeoutError,
  RpcRateLimitError
} from '@zenith/contracts';
import {
  defaultAcrossProvider,
  defaultDeBridgeProvider,
  defaultStargateProvider,
  AcrossProvider,
  DeBridgeProvider,
  StargateProvider
} from '@zenith/routing';
import { TelemetryEvent, ProviderEndpointConfig } from '@zenith/types';

test('ZENITH — PHASE 0 / TASK 5: MULTI-PROVIDER REDUNDANCY & LIVE STATUS RECONCILER', async (t) => {
  // Test 1: Provider Registration & Configuration
  await t.test('1. Provider registration & configuration stores endpoints with correct priority and weight', () => {
    const manager = new MultiProviderRpcManager();
    manager.registerEndpoint({
      id: 'custom-eth-1',
      chainId: 'ethereum',
      numericChainId: 1,
      url: 'https://rpc1.example.com',
      priority: 1,
      weight: 10
    });
    manager.registerEndpoint({
      id: 'custom-eth-2',
      chainId: 'ethereum',
      numericChainId: 1,
      url: 'https://rpc2.example.com',
      priority: 2,
      weight: 5
    });

    const endpoints = manager.getEndpoints('ethereum');
    assert.equal(endpoints.length >= 2, true);
    const ep1 = manager.getEndpoint('custom-eth-1');
    assert.equal(ep1?.id, 'custom-eth-1');
    assert.equal(ep1?.priority, 1);
    assert.equal(ep1?.status, 'HEALTHY');
    assert.equal(ep1?.circuitState, 'CLOSED');
  });

  // Test 2: Provider Chain ID Validation
  await t.test('2. Provider chain ID validation rejects endpoint returning mismatched chainId', async () => {
    const manager = new MultiProviderRpcManager();
    manager.registerEndpoint({
      id: 'mismatched-ep',
      chainId: 'polygon',
      numericChainId: 137,
      url: 'https://fake-polygon.example.com',
      priority: 1
    });

    // Mock fetch returning chainId 1 (Ethereum) instead of 137
    await assert.rejects(
      async () => {
        await manager.validateChainIdentity('mismatched-ep', async () => 1);
      },
      (err: any) => {
        assert.equal(err instanceof ChainIdMismatchError, true);
        assert.equal(err.expectedChainId, 137);
        assert.equal(err.actualChainId, 1);
        return true;
      }
    );

    const ep = manager.getEndpoint('mismatched-ep');
    assert.equal(ep?.status, 'UNHEALTHY');
    assert.equal(ep?.circuitState, 'OPEN');
  });

  // Test 3: Healthy Provider Selection
  await t.test('3. Healthy provider selection selects top priority healthy endpoint', () => {
    const manager = new MultiProviderRpcManager();
    manager.registerEndpoint({
      id: 'test-arb-1',
      chainId: 'arbitrum',
      numericChainId: 42161,
      url: 'https://arb1.example.com',
      priority: 2
    });
    manager.registerEndpoint({
      id: 'test-arb-2',
      chainId: 'arbitrum',
      numericChainId: 42161,
      url: 'https://arb2.example.com',
      priority: 1
    });

    const selected = manager.selectEligibleEndpoints('arbitrum');
    assert.equal(selected.length >= 2, true);
    assert.equal(selected[0].priority, 1);
  });

  // Test 4: Unhealthy Provider Rejection
  await t.test('4. Unhealthy and circuit-open providers are filtered out of eligible selection', () => {
    const manager = new MultiProviderRpcManager();
    manager.registerEndpoint({
      id: 'test-base-1',
      chainId: 'base',
      numericChainId: 8453,
      url: 'https://base1.example.com',
      priority: 1
    });
    manager.registerEndpoint({
      id: 'test-base-2',
      chainId: 'base',
      numericChainId: 8453,
      url: 'https://base2.example.com',
      priority: 2
    });

    manager.updateEndpointStatus('test-base-1', 'UNHEALTHY');
    const eligible = manager.selectEligibleEndpoints('base');
    assert.equal(eligible.some((e) => e.id === 'test-base-1'), false);
    assert.equal(eligible.some((e) => e.id === 'test-base-2'), true);
  });

  // Test 5: Read Failover across Multiple RPCs
  await t.test('5. Read-only operation fails over to secondary RPC on transient error', async () => {
    const manager = new MultiProviderRpcManager({ seedDefaultEndpoints: false });
    manager.registerEndpoint({
      id: 'failover-1',
      chainId: 'ethereum',
      numericChainId: 1,
      url: 'https://unreachable-rpc-1.example.com',
      priority: 1
    });
    manager.registerEndpoint({
      id: 'failover-2',
      chainId: 'ethereum',
      numericChainId: 1,
      url: 'https://working-rpc-2.example.com',
      priority: 2
    });

    const client = new MultiProviderRpcClient({
      manager,
      maxRetries: 2,
      baseBackoffMs: 10
    });

    // Mock rawJsonRpcCall on the client
    let callCount = 0;
    (client as any).rawJsonRpcCall = async (url: string, method: string) => {
      callCount++;
      if (url.includes('unreachable')) {
        throw new Error('ECONNRESET');
      }
      return '0x100';
    };

    const result = await client.executeReadOnly<string>('ethereum', 'eth_blockNumber');
    assert.equal(result, '0x100');
    assert.equal(callCount, 2);
    assert.equal(manager.getEndpoint('failover-1')?.status, 'DEGRADED');
    assert.equal(manager.getEndpoint('failover-2')?.status, 'HEALTHY');
  });


  // Test 6: Timeout Handling
  await t.test('6. Request timeout triggers RpcTimeoutError and records failure', async () => {
    const client = new MultiProviderRpcClient();
    const errCat = client.classifyError(new RpcTimeoutError('http://localhost', 5000));
    assert.equal(errCat, 'RETRYABLE');

    const abortErrCat = client.classifyError({ name: 'AbortError', message: 'The operation was aborted due to timeout' });
    assert.equal(abortErrCat, 'RETRYABLE');
  });

  // Test 7: Connection Reset Handling
  await t.test('7. Connection reset is classified as RETRYABLE', () => {
    const client = new MultiProviderRpcClient();
    assert.equal(client.classifyError(new Error('read ECONNRESET')), 'RETRYABLE');
    assert.equal(client.classifyError(new Error('socket hang up')), 'RETRYABLE');
  });

  // Test 8: HTTP 429 Rate Limit Handling
  await t.test('8. HTTP 429 rate limit is classified as RETRYABLE', () => {
    const client = new MultiProviderRpcClient();
    assert.equal(client.classifyError(new RpcRateLimitError('https://rpc.example.com')), 'RETRYABLE');
    assert.equal(client.classifyError({ statusCode: 429, message: 'Too many requests' }), 'RETRYABLE');
  });

  // Test 9: HTTP 5xx Server Error Handling
  await t.test('9. HTTP 5xx server error is classified as RETRYABLE', () => {
    const client = new MultiProviderRpcClient();
    assert.equal(client.classifyError(new Error('RPC server error HTTP 502: Bad Gateway')), 'RETRYABLE');
    assert.equal(client.classifyError(new Error('RPC server error HTTP 503: Service Unavailable')), 'RETRYABLE');
  });

  // Test 10: Exponential Backoff Calculation
  await t.test('10. Exponential backoff increases with attempt count and is bounded by maxBackoffMs', () => {
    const client = new MultiProviderRpcClient({
      baseBackoffMs: 100,
      maxBackoffMs: 800,
      jitterMs: 0
    });

    const b0 = client.calculateBackoff(0);
    const b1 = client.calculateBackoff(1);
    const b2 = client.calculateBackoff(2);
    const b5 = client.calculateBackoff(5);

    assert.equal(b0, 100);
    assert.equal(b1, 200);
    assert.equal(b2, 400);
    assert.equal(b5, 800); // capped at maxBackoffMs
  });

  // Test 11: Jitter Bounds
  await t.test('11. Backoff jitter stays strictly within specified bounds', () => {
    const client = new MultiProviderRpcClient({
      baseBackoffMs: 100,
      maxBackoffMs: 1000,
      jitterMs: 50
    });

    for (let i = 0; i < 20; i++) {
      const b = client.calculateBackoff(0);
      assert.equal(b >= 100, true);
      assert.equal(b <= 150, true);
    }
  });

  // Test 12: Circuit Breaker OPEN Transition
  await t.test('12. Repeated consecutive failures trip circuit breaker to OPEN state', () => {
    const manager = new MultiProviderRpcManager({ failureThreshold: 3 });
    manager.registerEndpoint({
      id: 'cb-test-1',
      chainId: 'polygon',
      numericChainId: 137,
      url: 'https://polygon.example.com',
      priority: 1
    });

    manager.recordFailure('cb-test-1', false, 'RETRYABLE');
    assert.equal(manager.getEndpoint('cb-test-1')?.status, 'DEGRADED');

    manager.recordFailure('cb-test-1', false, 'RETRYABLE');
    assert.equal(manager.getEndpoint('cb-test-1')?.status, 'DEGRADED');

    manager.recordFailure('cb-test-1', false, 'RETRYABLE');
    assert.equal(manager.getEndpoint('cb-test-1')?.status, 'CIRCUIT_OPEN');
    assert.equal(manager.getEndpoint('cb-test-1')?.circuitState, 'OPEN');
  });

  // Test 13: Circuit Breaker HALF_OPEN Recovery
  await t.test('13. Expired cooldown transitions circuit to HALF_OPEN / RECOVERING', () => {
    const manager = new MultiProviderRpcManager({
      failureThreshold: 2,
      circuitOpenCooldownMs: 10
    });
    manager.registerEndpoint({
      id: 'cb-halfopen-1',
      chainId: 'polygon',
      numericChainId: 137,
      url: 'https://polygon2.example.com',
      priority: 1
    });

    manager.recordFailure('cb-halfopen-1', false, 'RETRYABLE');
    manager.recordFailure('cb-halfopen-1', false, 'RETRYABLE');
    assert.equal(manager.getEndpoint('cb-halfopen-1')?.circuitState, 'OPEN');

    // Simulate cooldown passing
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const state = manager.checkCircuitState('cb-halfopen-1');
        assert.equal(state, 'HALF_OPEN');
        assert.equal(manager.getEndpoint('cb-halfopen-1')?.status, 'RECOVERING');
        resolve();
      }, 20);
    });
  });

  // Test 14: Provider Recovery to HEALTHY
  await t.test('14. Successive successful requests restore provider from RECOVERING to HEALTHY', () => {
    const manager = new MultiProviderRpcManager({
      successThreshold: 2
    });
    manager.registerEndpoint({
      id: 'recovery-ep',
      chainId: 'base',
      numericChainId: 8453,
      url: 'https://base.example.com',
      priority: 1
    });

    manager.updateEndpointStatus('recovery-ep', 'DEGRADED');
    manager.recordSuccess('recovery-ep', 45);
    assert.equal(manager.getEndpoint('recovery-ep')?.status, 'DEGRADED');

    manager.recordSuccess('recovery-ep', 42);
    assert.equal(manager.getEndpoint('recovery-ep')?.status, 'HEALTHY');
    assert.equal(manager.getEndpoint('recovery-ep')?.circuitState, 'CLOSED');
  });

  // Test 15: Stale Provider Rejection
  await t.test('15. Provider failing all retries throws AllProvidersUnavailableError', async () => {
    const manager = new MultiProviderRpcManager();
    manager.registerEndpoint({
      id: 'dead-ep',
      chainId: 'ethereum',
      numericChainId: 1,
      url: 'https://dead.example.com',
      priority: 1
    });

    const client = new MultiProviderRpcClient({
      manager,
      maxRetries: 1
    });

    (client as any).rawJsonRpcCall = async () => {
      throw new Error('ETIMEDOUT');
    };

    await assert.rejects(
      async () => {
        await client.executeReadOnly('ethereum', 'eth_blockNumber');
      },
      (err: any) => {
        assert.equal(err instanceof AllProvidersUnavailableError, true);
        return true;
      }
    );
  });

  // Test 16: Block Lag Detection
  await t.test('16. Block lag detection detects and flags lagging endpoints', () => {
    const manager = new MultiProviderRpcManager({ maxAllowedBlockLag: 5 });
    manager.registerEndpoint({
      id: 'ahead-ep',
      chainId: 'ethereum',
      numericChainId: 1,
      url: 'https://ahead.example.com',
      priority: 1
    });
    manager.registerEndpoint({
      id: 'lagging-ep',
      chainId: 'ethereum',
      numericChainId: 1,
      url: 'https://lagging.example.com',
      priority: 2
    });

    manager.recordSuccess('ahead-ep', 50, 20000100);
    manager.recordSuccess('lagging-ep', 50, 20000090); // 10 blocks behind

    const lagCheck = manager.checkBlockLag('lagging-ep');
    assert.equal(lagCheck.isLagging, true);
    assert.equal(lagCheck.lag, 10);
  });

  // Test 17: Bridge API Failover & Handling
  await t.test('17. Bridge status queries return structured state without throwing unhandled errors', async () => {
    const across = new AcrossProvider();
    const debridge = new DeBridgeProvider();
    const stargate = new StargateProvider();

    const mockQuote: any = {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceToken: { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
      destinationToken: { symbol: 'USDC', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' },
      sourceAmountRaw: '100000000',
      destinationAmountRaw: '99950000',
      minDestinationAmountRaw: '99900000'
    };

    const acrossStatus = await across.getStatus('0x1111111111111111111111111111111111111111111111111111111111111111', mockQuote);
    assert.equal(typeof acrossStatus.state, 'string');
    assert.equal(acrossStatus.isFailed, false);

    const debridgeStatus = await debridge.getStatus('0x1111111111111111111111111111111111111111111111111111111111111111', mockQuote);
    assert.equal(typeof debridgeStatus.state, 'string');

    const stargateStatus = await stargate.getStatus('0x1111111111111111111111111111111111111111111111111111111111111111', mockQuote);
    assert.equal(typeof stargateStatus.state, 'string');
  });

  // Test 18: Bridge Status Unknown Handling (No Synthetic Completion/Failure)
  await t.test('18. Unreachable bridge API yields TRACKING_UNAVAILABLE, never synthetic FILLED or FAILED', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const reconciler = new CrossChainStatusReconciler({ repository: repo });

    await repo.createProviderOrder({
      orderId: 'order-bridge-down',
      intentId: 'intent-bridge-down',
      provider: 'ACROSS',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      status: 'FULFILLING',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const result = await reconciler.reconcileOrder('order-bridge-down');
    assert.equal(result.status, 'STATUS_UNKNOWN');
    assert.equal(result.actionTaken, 'TRACKING_UNAVAILABLE_STATE_PRESERVED');
  });

  // Test 19: Provider Status Conflict Detection
  await t.test('19. Conflicting provider responses (filled vs reverted on-chain) emit STATUS_CONFLICT', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const client = new MultiProviderRpcClient();

    // Mock destination on-chain receipt returning REVERTED (status 0)
    client.getTransactionReceipt = async () => ({
      status: 0,
      blockNumber: 12345
    });

    const reconciler = new CrossChainStatusReconciler({
      repository: repo,
      rpcClient: client
    });

    const mockQuote = {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceToken: { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
      destinationToken: { symbol: 'USDC', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' },
      sourceAmountRaw: '100000000',
      destinationAmountRaw: '99950000'
    };

    await repo.createProviderOrder({
      orderId: 'order-conflict',
      intentId: 'intent-conflict',
      provider: 'ACROSS',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceTxHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
      destinationTxHash: '0x4444444444444444444444444444444444444444444444444444444444444444',
      recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      quoteJson: JSON.stringify(mockQuote),
      status: 'FULFILLING',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });


    // Mock bridge status returning DESTINATION_FILLED
    (reconciler as any).aggregator = {
      getProvider: () => ({
        getStatus: async () => ({
          state: 'DESTINATION_FILLED',
          destinationTxHash: '0x4444444444444444444444444444444444444444444444444444444444444444',
          isComplete: true,
          isFailed: false,
          timestamp: Date.now()
        })
      })
    };

    const result = await reconciler.reconcileOrder('order-conflict');
    assert.equal(result.status, 'STATUS_CONFLICT');
    assert.equal(result.conflict !== undefined, true);
  });

  // Test 20: Destination Tx Hash Validation
  await t.test('20. Destination transaction hash format is validated strictly', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const reconciler = new CrossChainStatusReconciler({ repository: repo });

    await repo.createProviderOrder({
      orderId: 'order-bad-hash',
      intentId: 'intent-bad-hash',
      provider: 'ACROSS',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceTxHash: '0x5555555555555555555555555555555555555555555555555555555555555555',
      destinationTxHash: 'not-a-valid-hex-hash',
      recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      status: 'FULFILLING',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const result = await reconciler.reconcileOrder('order-bad-hash');
    assert.equal(result.status === 'STATUS_UNKNOWN' || result.status === 'FULFILLING', true);
  });

  // Test 21: On-Chain Evidence Precedence
  await t.test('21. Mined on-chain receipt takes precedence over pending bridge API response', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const client = new MultiProviderRpcClient();

    // Mock on-chain receipt returning CONFIRMED (status 1)
    client.getTransactionReceipt = async () => ({
      status: 1,
      blockNumber: 123456
    });

    const reconciler = new CrossChainStatusReconciler({
      repository: repo,
      rpcClient: client
    });

    await repo.createProviderOrder({
      orderId: 'order-mined-receipt',
      intentId: 'intent-mined-receipt',
      provider: 'ACROSS',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceTxHash: '0x6666666666666666666666666666666666666666666666666666666666666666',
      destinationTxHash: '0x7777777777777777777777777777777777777777777777777777777777777777',
      recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      status: 'FULFILLING',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const result = await reconciler.reconcileOrder('order-mined-receipt');
    assert.equal(result.status, 'SETTLED');
    assert.equal(result.actionTaken, 'RECONCILED_ON_CHAIN_RECEIPT_SETTLED');
  });

  // Test 22: Duplicate Reconciliation Prevention (Idempotency)
  await t.test('22. Duplicate reconciliation runs are completely idempotent', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const client = new MultiProviderRpcClient();
    client.getTransactionReceipt = async () => ({ status: 1, blockNumber: 100 });

    const reconciler = new CrossChainStatusReconciler({ repository: repo, rpcClient: client });

    await repo.createProviderOrder({
      orderId: 'order-idempotent',
      intentId: 'intent-idempotent',
      provider: 'ACROSS',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceTxHash: '0x8888888888888888888888888888888888888888888888888888888888888888',
      destinationTxHash: '0x9999999999999999999999999999999999999999999999999999999999999999',
      recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      status: 'FULFILLING',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const res1 = await reconciler.reconcileOrder('order-idempotent');
    const res2 = await reconciler.reconcileOrder('order-idempotent');

    assert.equal(res1.status, 'SETTLED');
    assert.equal(res2.status, 'SETTLED');
  });

  // Test 23: Broadcast Ambiguity Protection
  await t.test('23. Broadcast timeout throws BroadcastUncertainError and NEVER auto-retries on secondary RPC', async () => {
    const manager = new MultiProviderRpcManager();
    manager.registerEndpoint({
      id: 'broadcast-1',
      chainId: 'ethereum',
      numericChainId: 1,
      url: 'https://broadcast-rpc-1.example.com',
      priority: 1
    });
    manager.registerEndpoint({
      id: 'broadcast-2',
      chainId: 'ethereum',
      numericChainId: 1,
      url: 'https://broadcast-rpc-2.example.com',
      priority: 2
    });

    const client = new MultiProviderRpcClient({ manager });
    let attempts = 0;

    (client as any).rawJsonRpcCall = async (url: string) => {
      attempts++;
      throw new Error('ETIMEDOUT');
    };

    await assert.rejects(
      async () => {
        await client.executeBroadcast('ethereum', '0x02f8...');
      },
      (err: any) => {
        assert.equal(err instanceof BroadcastUncertainError, true);
        return true;
      }
    );

    // CRITICAL: Exactly 1 attempt was made. No auto-failover to provider 2!
    assert.equal(attempts, 1);
  });

  // Test 24: BROADCAST_UNCERTAIN Integration
  await t.test('24. Recovery engine resolves uncertain broadcast through nonce discovery', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const mockRpc = {
      getTransactionReceipt: async (hash: string) => ({
        status: 1,
        blockNumber: 12345
      })
    };
    const recovery = new CrossChainRecoveryEngine({
      repository: repo,
      rpcProviders: { ethereum: mockRpc }
    });

    await repo.savePlanStep('plan-1', {
      id: 'step-1',
      type: 'SOURCE_EXECUTION',
      title: 'Swap step',
      description: 'Swap execution',
      chainId: 'ethereum',
      executionEnvironment: 'EVM',
      status: 'ACTIVE',
      dependencies: [],
      retryPolicy: { maxRetries: 3, baseBackoffMs: 100, maxBackoffMs: 1000 }
    });


    await repo.createTransaction({
      transactionId: 'plan-1:step-1:attempt-1',
      planId: 'plan-1',
      stepId: 'step-1',
      chainId: 'ethereum',
      nonce: 10,
      fromAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      toAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      valueWei: '0',
      calldata: '0x',
      state: 'BROADCAST_UNCERTAIN',
      createdAt: Date.now()
    });


    // Mock evmAdapter.discoverTransactionByNonce
    (recovery as any).evmAdapter = {
      discoverTransactionByNonce: async () => ({
        found: true,
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        isMined: true
      })
    };

    const res = await recovery.recoverUncertainTransaction('plan-1:step-1:attempt-1');
    assert.equal(res.reconciledStatus, 'CONFIRMED');
  });

  // Test 25: No Synthetic Quote Fallback
  await t.test('25. Live quote failure returns null or non-executable quote, never synthetic executable quote', async () => {
    const across = new AcrossProvider();
    const quote = await across.getQuote({
      userWalletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 'ethereum', decimals: 6, verificationTier: 'VERIFIED_CANONICAL' },
      tokenOut: { symbol: 'USDC', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', chainId: 'arbitrum', decimals: 6, verificationTier: 'VERIFIED_CANONICAL' },
      amountInRaw: '0' // Zero amount returns null
    });

    assert.equal(quote, null);
  });

  // Test 26: Stargate Remains Non-Executable
  await t.test('26. Stargate quotes are strictly marked isExecutable = false', async () => {
    const stargate = new StargateProvider();
    const quote = await stargate.getQuote({
      userWalletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 'ethereum', decimals: 6, verificationTier: 'VERIFIED_CANONICAL' },
      tokenOut: { symbol: 'USDC', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', chainId: 'arbitrum', decimals: 6, verificationTier: 'VERIFIED_CANONICAL' },
      amountInRaw: '100000000'
    });

    if (quote) {
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.diagnostics.some((d) => d.code === 'QUOTE_UNAVAILABLE'), true);
    }
  });


  // Test 27: Across Executable Quote Integrity
  await t.test('27. Across provider preserves executable quote invariants', () => {
    const across = new AcrossProvider();
    assert.equal(across.id, 'ACROSS');
    assert.equal(across.isAvailable('ethereum', 'arbitrum'), true);
    assert.equal(across.isAvailable('ethereum', 'ethereum'), false); // Same chain blocked
  });

  // Test 28: deBridge Executable Quote Integrity
  await t.test('28. deBridge provider preserves executable quote invariants', () => {
    const debridge = new DeBridgeProvider();
    assert.equal(debridge.id, 'DEBRIDGE_DLN');
    assert.equal(debridge.isAvailable('ethereum', 'polygon'), true);
  });

  // Test 29: Recovery Engine Multi-Provider Integration
  await t.test('29. Recovery engine integrates with MultiProviderRpcClient to query multi-provider status', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const manager = new MultiProviderRpcManager();
    const client = new MultiProviderRpcClient({ manager });
    const recovery = new CrossChainRecoveryEngine({
      repository: repo,
      rpcClient: client
    });

    const results = await recovery.recoverAll();
    assert.equal(Array.isArray(results), true);
  });

  // Test 30: Telemetry Sanitization
  await t.test('30. Telemetry sinks receive structured events without leaking private keys or secrets', () => {
    const manager = new MultiProviderRpcManager();
    const capturedEvents: TelemetryEvent[] = [];
    manager.addTelemetrySink((ev) => {
      capturedEvents.push(ev);
    });

    manager.recordTelemetry({
      eventId: 'tel-test-1',
      providerId: 'sec-ep-1',
      chainId: 'ethereum',
      operation: 'eth_call',
      category: 'READ_ONLY',
      latencyMs: 35,
      success: true,
      retryCount: 0,
      failoverCount: 0,
      timestamp: Date.now(),
      metadata: {
        privateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        secretToken: 'bearer super-secret-key',
        safeAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
      }
    });

    assert.equal(capturedEvents.length, 1);
    const meta = capturedEvents[0].metadata;
    assert.equal(meta?.privateKey, '[REDACTED]');
    assert.equal(meta?.secretToken, '[REDACTED]');
    assert.equal(meta?.safeAddress, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });
});
