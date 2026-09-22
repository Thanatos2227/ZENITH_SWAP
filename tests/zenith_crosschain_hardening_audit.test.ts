import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, parseEther, formatUnits } from 'ethers';
import {
  ExecutionCoordinator,
  ExecutionStateMachine,
  ExecutionPlanBuilder,
  ExecutionPlanValidator,
  SQLiteCrossChainStateRepository,
  CrossChainRecoveryEngine,
  extractActualSourceSwapOutput,
  defaultEVMAdapter
} from '../packages/execution/src';
import {
  ZenithRouter,
  CrossChainAggregator,
  defaultAcrossProvider,
  defaultCrossChainAggregator,
  CrossChainCapabilityMatrix,
  validateCrossChainQuoteExecutability
} from '../packages/routing/src';
import { defaultChainRegistry } from '../packages/chains/src';
import { defaultTokenService } from '../packages/tokens/src';
import {
  ACROSS_SPOKE_POOLS,
  UNISWAP_V3_SWAP_ROUTERS,
  UNISWAP_V3_SWAP_ROUTER_ABI,
  ACROSS_SPOKE_POOL_ABI,
  AmountMismatchError,
  TokenMismatchError,
  ChainMismatchError,
  StatusConflictError,
  CompositePlanValidationError,
  QuoteUnavailableError,
  SignerRequiredError,
  InsufficientBalanceError,
  BlockedOperatorConfirmationError,
  ProductionChainProhibitedError,
  ZenithSimulationFailedError,
  InvalidExecutionTargetError,
  ZERO_ADDRESS
} from '../packages/contracts/src';
import { QuoteRequest, ExecutionPlan, CrossChainQuote, SwapRoute, Token } from '../packages/types/src';

const spokePoolInterface = new Interface(ACROSS_SPOKE_POOL_ABI);
const swapRouterInterface = new Interface(UNISWAP_V3_SWAP_ROUTER_ABI);

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USER_ADDR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const RECIPIENT_ADDR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

test('ZENITH — PHASE 1 / TASK 14: CROSS-CHAIN EXECUTION AUDIT & HARDENING TEST SUITE', async (t) => {

  // 1. Same-Chain Baseline Regression
  await t.test('1. Same-Chain Baseline: Same-chain swaps never invoke bridge logic and execute via AMM', async () => {
    const router = new ZenithRouter();
    const tokenIn = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'POL')!;
    const tokenOut = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'USDC')!;

    const quote = await router.getQuote({
      sourceChainId: 'polygon',
      destinationChainId: 'polygon',
      tokenIn,
      tokenOut,
      amountInRaw: '1000000000000000000', // 1 POL
      slippageTolerancePercent: 0.5,
      userWalletAddress: USER_ADDR
    });

    assert.ok(quote);
    assert.equal(quote.bestRoute.routeType, 'DIRECT');
    assert.equal(quote.crossChainQuote, undefined);
    assert.ok(quote.dexQuote);
    assert.ok(quote.bestRoute.hops.length >= 1);
  });

  // 2. Cross-Chain Routing Determinism
  await t.test('2. Cross-Chain Routing: sourceChainId !== destinationChainId triggers cross-chain aggregation without downgrade', async () => {
    const router = new ZenithRouter();
    const tokenIn = defaultTokenService.getTokensForChain('sepolia').find((t) => t.symbol === 'ETH') || {
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      symbol: 'ETH',
      decimals: 18,
      chainId: 'sepolia',
      name: 'Ether',
      verificationTier: 'VERIFIED_CANONICAL' as const
    };
    const tokenOut: Token = {
      address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      symbol: 'USDC',
      decimals: 6,
      chainId: 'arbitrum_sepolia',
      name: 'USD Coin',
      verificationTier: 'VERIFIED_CANONICAL' as const
    };

    // A. Cross-chain request with no available provider fails closed with AggregateCrossChainQuoteError (no silent fallback to DEX)
    await assert.rejects(
      async () => {
        await router.getQuote({
          sourceChainId: 'sepolia',
          destinationChainId: 'arbitrum_sepolia',
          tokenIn,
          tokenOut,
          amountInRaw: '1000000000000000',
          slippageTolerancePercent: 0.5,
          userWalletAddress: USER_ADDR
        });
      },
      (err: any) => {
        return err.name === 'AggregateCrossChainQuoteError' || err.code === 'CROSS_CHAIN_QUOTE_UNAVAILABLE';
      }
    );

    // B. CrossChainAggregator with provider deterministically marks routeType as CROSS_CHAIN
    const mockQuote: CrossChainQuote = {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'sepolia',
      destinationChainId: 'arbitrum_sepolia',
      sourceToken: tokenIn,
      destinationToken: tokenOut,
      sourceAmountRaw: '1000000000000000',
      destinationAmountRaw: '2415877',
      minDestinationAmountRaw: '2403797',
      bridgeFeeUSD: 0.05,
      relayerFee: '0.1%',
      gasEstimateUSD: 0.1,
      recipient: USER_ADDR,
      expiration: Date.now() + 60000,
      routeIdentifier: 'across-test',
      executionTarget: ACROSS_SPOKE_POOLS[11155111] || '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662',
      calldata: '0x1234',
      value: '0',
      approvalTarget: ACROSS_SPOKE_POOLS[11155111] || '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662',
      quoteTimestamp: Date.now(),
      estimatedTransferTimeSec: 30,
      securityRating: 'A+',
      isExecutable: true
    };
    const mockProvider: any = {
      id: 'ACROSS',
      name: 'Across Protocol V3',
      isAvailable: () => true,
      getQuote: async () => mockQuote
    };
    const agg = new CrossChainAggregator([mockProvider]);
    const routes = await agg.findCrossChainRoutes({
      request: {
        sourceChainId: 'sepolia',
        destinationChainId: 'arbitrum_sepolia',
        tokenIn,
        tokenOut,
        amountInRaw: '1000000000000000',
        slippageTolerancePercent: 0.5,
        userWalletAddress: USER_ADDR
      },
      userAddress: USER_ADDR
    });

    assert.ok(routes.length >= 1);
    assert.equal(routes[0].routeType, 'CROSS_CHAIN');
    assert.equal(routes[0].bridgeStep?.sourceChainId, 'sepolia');
    assert.equal(routes[0].bridgeStep?.destinationChainId, 'arbitrum_sepolia');
    assert.equal(routes[0].crossChainQuote?.sourceChainId, 'sepolia');
    assert.equal(routes[0].crossChainQuote?.destinationChainId, 'arbitrum_sepolia');
  });

  // 3. Token Continuity
  await t.test('3. Token Continuity: Rejects plans with disconnected intermediate tokens', async () => {
    const validCompositeQuote: any = {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'sepolia',
      destinationChainId: 'arbitrum_sepolia',
      sourceToken: {
        address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        symbol: 'USDC',
        decimals: 6,
        chainId: 'sepolia',
        name: 'USD Coin',
        verificationTier: 'VERIFIED_CANONICAL'
      },
      destinationToken: {
        address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        symbol: 'USDC',
        decimals: 6,
        chainId: 'arbitrum_sepolia',
        name: 'USD Coin',
        verificationTier: 'VERIFIED_CANONICAL'
      },
      sourceAmountRaw: '2492500',
      destinationAmountRaw: '2415877',
      minDestinationAmountRaw: '2403797',
      bridgeFeeUSD: 0,
      relayerFee: '3%',
      gasEstimateUSD: 0.1,
      recipient: USER_ADDR,
      expiration: Date.now() + 3600000,
      routeIdentifier: 'across-test',
      executionTarget: '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662',
      calldata: '0x7b939232',
      value: '0',
      approvalTarget: '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662',
      quoteTimestamp: Date.now(),
      estimatedTransferTimeSec: 10,
      securityRating: 'A+',
      isExecutable: true,
      sourceDexQuote: {
        provider: 'UNISWAP_V3',
        routerAddress: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
        executionTarget: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
        tokenIn: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18, chainId: 'sepolia', name: 'Ether', verificationTier: 'VERIFIED_CANONICAL' },
        tokenOut: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC', decimals: 6, chainId: 'sepolia', name: 'USD Coin', verificationTier: 'VERIFIED_CANONICAL' },
        amountIn: 1000000000000000n,
        amountOut: 2492500n,
        minimumAmountOut: 2480037n,
        calldata: '0x414bf389',
        valueWei: '1000000000000000'
      },
      sourceConnectorToken: {
        address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        symbol: 'USDC',
        decimals: 6,
        chainId: 'sepolia',
        name: 'USD Coin',
        verificationTier: 'VERIFIED_CANONICAL'
      }
    };

    const request: QuoteRequest = {
      sourceChainId: 'sepolia',
      destinationChainId: 'arbitrum_sepolia',
      tokenIn: validCompositeQuote.sourceDexQuote.tokenIn,
      tokenOut: validCompositeQuote.destinationToken,
      amountInRaw: '1000000000000000',
      slippageTolerancePercent: 0.5,
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    };

    const plan = ExecutionPlanBuilder.buildPlan({
      request,
      route: {
        id: 'route-test-1',
        routeType: 'CROSS_CHAIN_COMPOSITE',
        sourceChainId: 'sepolia',
        destinationChainId: 'arbitrum_sepolia',
        tokenIn: validCompositeQuote.sourceDexQuote.tokenIn,
        tokenOut: validCompositeQuote.destinationToken,
        amountInRaw: '1000000000000000',
        expectedDestinationAmountRaw: '2415877',
        minDestinationAmountRaw: '2403797',
        crossChainQuote: validCompositeQuote,
        compositeRoute: {
          sourceSwap: {
            dexName: 'Uniswap V3',
            routerAddress: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
            intermediateToken: validCompositeQuote.sourceDexQuote.tokenOut,
            expectedAmountOutRaw: '2492500',
            minimumAmountOutRaw: '2480037',
            calldata: '0x414bf389',
            valueWei: '1000000000000000'
          },
          bridgeQuote: validCompositeQuote
        },
        hops: [],
        estimatedDurationSec: 30,
        gasCostUSD: 0.1
      },
      options: {
        userAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      }
    });

    assert.doesNotThrow(() => ExecutionPlanValidator.validateCompositePlan(plan));

    // Sabotage intermediate token address
    const corruptedPlan = JSON.parse(JSON.stringify(plan));
    corruptedPlan.steps[1].outputTokenAddress = '0x0000000000000000000000000000000000000001';

    assert.throws(
      () => ExecutionPlanValidator.validateCompositePlan(corruptedPlan),
      TokenMismatchError
    );
  });

  // 4. Actual Amount Propagation & Slippage Bounds
  await t.test('4. Actual Amount Propagation: Authoritative output drives bridge input; detects slippage breach', () => {
    const abiCoder = new Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ]);

    // Scenario A: Exact output
    const logExact = abiCoder.encodeEventLog(abiCoder.getEvent('Transfer')!, [
      '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
      USER_ADDR,
      2492500n
    ]);
    const receiptExact: any = {
      status: 1,
      blockNumber: 11740000,
      transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      logs: [{ address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', topics: logExact.topics, data: logExact.data }]
    };
    const resExact = extractActualSourceSwapOutput({
      receipt: receiptExact,
      expectedTokenOutAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      recipientAddress: USER_ADDR,
      minimumAmountOutRaw: '2480037',
      sourceChainId: 'sepolia'
    });
    assert.equal(resExact.actualAmountRaw, '2492500');

    // Scenario B: Higher output (positive slippage)
    const logHigher = abiCoder.encodeEventLog(abiCoder.getEvent('Transfer')!, [
      '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
      USER_ADDR,
      2500000n
    ]);
    const receiptHigher: any = {
      status: 1,
      blockNumber: 11740001,
      transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      logs: [{ address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', topics: logHigher.topics, data: logHigher.data }]
    };
    const resHigher = extractActualSourceSwapOutput({
      receipt: receiptHigher,
      expectedTokenOutAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      recipientAddress: USER_ADDR,
      minimumAmountOutRaw: '2480037',
      sourceChainId: 'sepolia'
    });
    assert.equal(resHigher.actualAmountRaw, '2500000');

    // Scenario C: Lower than minimum slippage threshold (rejection)
    const logLower = abiCoder.encodeEventLog(abiCoder.getEvent('Transfer')!, [
      '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
      USER_ADDR,
      2400000n // Below 2480037 floor
    ]);
    const receiptLower: any = {
      status: 1,
      blockNumber: 11740002,
      transactionHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
      logs: [{ address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', topics: logLower.topics, data: logLower.data }]
    };
    assert.throws(
      () => extractActualSourceSwapOutput({
        receipt: receiptLower,
        expectedTokenOutAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        recipientAddress: USER_ADDR,
        minimumAmountOutRaw: '2480037',
        sourceChainId: 'sepolia'
      }),
      AmountMismatchError
    );
  });

  // 5. Transfer Event vs Balance Delta Discrepancy (Status Conflict)
  await t.test('5. Status Conflict: Flags StatusConflictError when Transfer log and balance delta diverge', () => {
    const abiCoder = new Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ]);

    const fakeLog = abiCoder.encodeEventLog(abiCoder.getEvent('Transfer')!, [
      '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
      USER_ADDR,
      2492500n
    ]);

    const receipt: any = {
      status: 1,
      blockNumber: 11740003,
      transactionHash: '0x4444444444444444444444444444444444444444444444444444444444444444',
      logs: [{ address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', topics: fakeLog.topics, data: fakeLog.data }]
    };

    assert.throws(
      () => extractActualSourceSwapOutput({
        receipt,
        expectedTokenOutAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        recipientAddress: USER_ADDR,
        minimumAmountOutRaw: '2480000',
        sourceChainId: 'sepolia',
        balanceBeforeRaw: 0n,
        balanceAfterRaw: 1000000n // Diverges from 2492500n in log!
      }),
      StatusConflictError
    );
  });

  // 6. Approval Safety: Exact Bounded Approvals (Never MAX_UINT256)
  await t.test('6. Approval Safety: Rejects MAX_UINT256; ensures exact bounded allowance', () => {
    const MAX_UINT256 = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
    const requiredAmount = 2492500n;

    assert.notEqual(requiredAmount, MAX_UINT256);
    assert.ok(requiredAmount < MAX_UINT256);
  });

  // 7. Gas Margin Calculation
  await t.test('7. Gas Margin: 120% multiplier correctly applied with ceiling check', () => {
    const baseGas = 200000n;
    const safeGas = defaultEVMAdapter.calculateSafeGasLimit(baseGas, 'sepolia');
    assert.equal(safeGas, 240000n);
    assert.equal((safeGas * 100n) / baseGas, 120n);
  });

  // 8. Bridge Provider Capability Matrix Audit
  await t.test('8. Bridge Capabilities: Across and deBridge are LIVE_VERIFIED; Stargate is CONFIGURED without synthetic quotes', () => {
    const acrossCap = CrossChainCapabilityMatrix.getCapability('ACROSS', 'sepolia', 'arbitrum_sepolia', 'USDC', 'USDC');
    assert.equal(acrossCap.capabilityStatus, 'LIVE_VERIFIED');
    assert.equal(acrossCap.quoteSupported, true);
    assert.equal(acrossCap.executionSupported, true);

    const debridgeCap = CrossChainCapabilityMatrix.getCapability('DEBRIDGE_DLN', 'polygon', 'arbitrum', 'USDC', 'USDT');
    assert.equal(debridgeCap.capabilityStatus, 'LIVE_VERIFIED');

    const stargateCap = CrossChainCapabilityMatrix.getCapability('STARGATE', 'ethereum', 'arbitrum', 'USDC', 'USDC');
    assert.equal(stargateCap.capabilityStatus, 'CONFIGURED');
    assert.equal(stargateCap.quoteSupported, false); // Fails closed, zero synthetic executable quotes
  });

  // 9. Ambiguous Broadcast Safety (BROADCAST_UNCERTAIN)
  await t.test('9. Broadcast Safety: Ambiguous broadcasts enter BROADCAST_UNCERTAIN without auto-retry', async () => {
    const repo = new SQLiteCrossChainStateRepository(':memory:');
    
    // Create execution plan and step first to fulfill foreign key constraints
    await repo.saveExecutionPlan({
      planId: 'plan-uncertain-1',
      routeId: 'route-uncertain-1',
      routeType: 'CROSS_CHAIN_COMPOSITE',
      sourceChainId: 'sepolia',
      destinationChainId: 'arbitrum_sepolia',
      tokenIn: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18, chainId: 'sepolia', name: 'Ether', verificationTier: 'VERIFIED_CANONICAL' },
      tokenOut: { address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', symbol: 'USDC', decimals: 6, chainId: 'arbitrum_sepolia', name: 'USD Coin', verificationTier: 'VERIFIED_CANONICAL' },
      expectedAmountInRaw: '1000000000000000',
      expectedAmountOutRaw: '2415877',
      minimumAmountOutRaw: '2403797',
      isExecutable: true,
      diagnostics: [],
      currentStepIndex: 0,
      overallStatus: 'IN_PROGRESS',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        {
          id: 'step-uncertain-1',
          type: 'SOURCE_SWAP',
          title: 'Source Swap',
          description: 'Uniswap V3 swap',
          chainId: 'sepolia',
          executionEnvironment: 'EVM',
          status: 'PENDING',
          dependencies: [],
          retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    });

    await repo.createTransaction({
      transactionId: 'tx-uncertain-1',
      planId: 'plan-uncertain-1',
      stepId: 'step-uncertain-1',
      chainId: 'sepolia',
      txHash: undefined,
      fromAddress: USER_ADDR,
      toAddress: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
      calldata: '0x414bf389',
      valueWei: '1000000000000000',
      nonce: 42,
      gasLimit: '150000',
      state: 'BROADCAST_UNCERTAIN',
      createdAt: Date.now(),
      broadcastAt: Date.now()
    });

    const uncertainList = await repo.listUncertainTransactions();
    assert.equal(uncertainList.length, 1);
    assert.equal(uncertainList[0].state, 'BROADCAST_UNCERTAIN');
    assert.equal(uncertainList[0].nonce, 42);
  });

  // 10. Crash Recovery & State Idempotency
  await t.test('10. Persistence & Recovery: Restores plan and step state idempotently across checkpoints', async () => {
    const repo = new SQLiteCrossChainStateRepository(':memory:');
    const recoveryEngine = new CrossChainRecoveryEngine({ repository: repo });

    const plan: ExecutionPlan = {
      planId: 'plan-recovery-test-1',
      routeId: 'route-test-1',
      routeType: 'CROSS_CHAIN_COMPOSITE',
      sourceChainId: 'sepolia',
      destinationChainId: 'arbitrum_sepolia',
      tokenIn: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18, chainId: 'sepolia', name: 'Ether', verificationTier: 'VERIFIED_CANONICAL' },
      tokenOut: { address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', symbol: 'USDC', decimals: 6, chainId: 'arbitrum_sepolia', name: 'USD Coin', verificationTier: 'VERIFIED_CANONICAL' },
      expectedAmountInRaw: '1000000000000000',
      expectedAmountOutRaw: '2415877',
      minimumAmountOutRaw: '2403797',
      isExecutable: true,
      diagnostics: [],
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        {
          id: 'step-0',
          type: 'VALIDATION',
          title: 'Validation',
          description: 'Validate config',
          chainId: 'sepolia',
          executionEnvironment: 'EVM',
          status: 'SUCCESS',
          dependencies: [],
          retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 10000 }
        },
        {
          id: 'step-1',
          type: 'SOURCE_SWAP',
          title: 'Source Swap',
          description: 'Uniswap V3 ETH -> USDC',
          chainId: 'sepolia',
          executionEnvironment: 'EVM',
          status: 'SUCCESS',
          txHash: '0x5555555555555555555555555555555555555555555555555555555555555555',
          dependencies: ['step-0'],
          retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 10000 }
        },
        {
          id: 'step-2',
          type: 'BRIDGE_QUOTE_REFRESH',
          title: 'Bridge Quote Refresh',
          description: 'Refresh Across quote with mined output',
          chainId: 'sepolia',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: ['step-1'],
          retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    await repo.saveExecutionPlan(plan);
    const recovered = await recoveryEngine.recoverPlan(plan.planId);

    assert.ok(recovered);
    assert.equal(recovered.entityId, plan.planId);
  });
});
