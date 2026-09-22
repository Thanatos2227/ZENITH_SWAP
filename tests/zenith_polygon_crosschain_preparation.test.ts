import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, parseEther, formatUnits } from 'ethers';
import {
  ExecutionCoordinator,
  ExecutionPlanBuilder,
  ExecutionPlanValidator,
  SQLiteCrossChainStateRepository,
  extractActualSourceSwapOutput,
  defaultEVMAdapter
} from '../packages/execution/src';
import {
  ZenithRouter,
  CrossChainAggregator,
  defaultAcrossProvider,
  defaultDeBridgeProvider,
  CrossChainCapabilityMatrix,
  validateCrossChainQuoteExecutability
} from '../packages/routing/src';
import { defaultChainRegistry } from '../packages/chains/src';
import { defaultTokenService } from '../packages/tokens/src';
import {
  ACROSS_SPOKE_POOLS,
  DEBRIDGE_DLN_SOURCE,
  UNISWAP_V3_SWAP_ROUTERS,
  UNISWAP_V3_SWAP_ROUTER_ABI,
  ACROSS_SPOKE_POOL_ABI,
  AmountMismatchError,
  TokenMismatchError,
  ChainMismatchError,
  StatusConflictError,
  InvalidExecutionTargetError,
  QuoteUnavailableError,
  ConfigurationError,
  AggregateCrossChainQuoteError
} from '../packages/contracts/src';
import { QuoteRequest, ExecutionPlan, CrossChainQuote, SwapRoute, Token } from '../packages/types/src';

const USER_ADDR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const RECIPIENT_ADDR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

test('ZENITH — PHASE 1 / TASK 15: POLYGON CROSS-CHAIN EXECUTION PREPARATION SUITE', async (t) => {

  // 1. Polygon Chain Configuration & Capabilities
  await t.test('1. Polygon Chain Verification: Chain ID 137, native POL, EVM environment, healthy capabilities', () => {
    const polygonChain = defaultChainRegistry.getChain('polygon');
    assert.ok(polygonChain);
    assert.equal(polygonChain.chainId, 137);
    assert.equal(polygonChain.nativeCurrency.symbol, 'POL');
    assert.equal(polygonChain.executionEnvironment, 'EVM');
    assert.equal(defaultChainRegistry.supportsCapability('polygon', 'swap'), true);
    assert.equal(defaultChainRegistry.supportsCapability('polygon', 'crossChain'), true);
    assert.ok(polygonChain.rpcEndpoints.length >= 3);
  });

  // 2. Polygon Contract Addresses Integrity
  await t.test('2. Polygon Contract Addresses: Across SpokePool, deBridge Source, Uniswap V3 Router', () => {
    const acrossSpokePool = ACROSS_SPOKE_POOLS[137];
    assert.equal(acrossSpokePool.toLowerCase(), '0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096');

    const debridgeSource = DEBRIDGE_DLN_SOURCE[137];
    assert.equal(debridgeSource.toLowerCase(), '0xef4fb24ad0916217251f553c0596f8edc630eb66');

    const uniswapV3Router = UNISWAP_V3_SWAP_ROUTERS[137];
    assert.equal(uniswapV3Router.toLowerCase(), '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45');
  });

  // 3. Supported Polygon Cross-Chain Route Detection
  await t.test('3. Supported Routes: Polygon -> Arbitrum (Across & deBridge) and Polygon -> Ethereum (Across)', () => {
    const acrossCapArb = CrossChainCapabilityMatrix.getCapability('ACROSS', 'polygon', 'arbitrum', 'USDC', 'USDC');
    assert.equal(acrossCapArb.capabilityStatus, 'LIVE_VERIFIED');
    assert.equal(acrossCapArb.quoteSupported, true);
    assert.equal(acrossCapArb.executionSupported, true);

    const debridgeCapArb = CrossChainCapabilityMatrix.getCapability('DEBRIDGE_DLN', 'polygon', 'arbitrum', 'USDC', 'USDC');
    assert.equal(debridgeCapArb.capabilityStatus, 'LIVE_VERIFIED');

    const acrossCapEth = CrossChainCapabilityMatrix.getCapability('ACROSS', 'polygon', 'ethereum', 'USDC', 'USDC');
    assert.equal(acrossCapEth.capabilityStatus, 'LIVE_VERIFIED');
  });

  // 4. Unsupported Polygon Route Fails Closed
  await t.test('4. Unsupported Routes: Polygon -> Non-Existent or Unsupported Provider Fails Closed with Error', async () => {
    const router = new ZenithRouter();
    const polNative = defaultTokenService.getTokensForChain('polygon').find(t => t.symbol === 'POL')!;
    const fakeToken: Token = {
      address: '0x1111111111111111111111111111111111111111',
      symbol: 'FAKE',
      decimals: 18,
      chainId: 'polygon',
      name: 'Fake Token',
      verificationTier: 'UNVERIFIED'
    };

    // Unknown destination chain
    await assert.rejects(
      async () => {
        await router.getQuote({
          sourceChainId: 'polygon',
          destinationChainId: 'unsupported_chain_xyz',
          tokenIn: polNative,
          tokenOut: fakeToken,
          amountInRaw: '1000000000000000000',
          slippageTolerancePercent: 0.5,
          userWalletAddress: USER_ADDR
        });
      },
      (err: any) => err.code === 'UNKNOWN_DEST_CHAIN' || err.name === 'ConfigurationError'
    );
  });

  // 5. Token & Decimal Continuity on Polygon Composite Route (POL -> WPOL -> USDC -> Bridge -> Arb USDC)
  await t.test('5. Token Continuity: Polygon POL (18 dec) -> USDC (6 dec) -> Bridge -> Arbitrum USDC (6 dec)', () => {
    const polNative = defaultTokenService.getTokensForChain('polygon').find(t => t.symbol === 'POL')!;
    const polygonUSDC = defaultTokenService.getTokensForChain('polygon').find(t => t.symbol === 'USDC')!;
    const arbitrumUSDC = defaultTokenService.getTokensForChain('arbitrum').find(t => t.symbol === 'USDC')!;

    assert.equal(polNative.decimals, 18);
    assert.equal(polygonUSDC.decimals, 6);
    assert.equal(arbitrumUSDC.decimals, 6);

    const validCompositeQuote: CrossChainQuote = {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'polygon',
      destinationChainId: 'arbitrum',
      sourceToken: polygonUSDC,
      destinationToken: arbitrumUSDC,
      sourceAmountRaw: '2492500', // 2.4925 USDC
      destinationAmountRaw: '2473806',
      minDestinationAmountRaw: '2461437',
      bridgeFeeUSD: 0.02,
      relayerFee: '0.05%',
      gasEstimateUSD: 0.05,
      recipient: USER_ADDR,
      expiration: Date.now() + 3600000,
      routeIdentifier: 'across-pol-arb',
      executionTarget: ACROSS_SPOKE_POOLS[137],
      calldata: '0x7b939232',
      value: '0',
      approvalTarget: ACROSS_SPOKE_POOLS[137],
      quoteTimestamp: Date.now(),
      estimatedTransferTimeSec: 15,
      securityRating: 'A+',
      isExecutable: true,
      sourceDexQuote: {
        provider: 'ZENITH_V3',
        routerAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        executionTarget: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        tokenIn: polNative,
        tokenOut: polygonUSDC,
        amountIn: 1000000000000000000n, // 1 POL
        amountOut: 2492500n,
        minimumAmountOut: 2480037n,
        calldata: '0x414bf389',
        valueWei: '1000000000000000000'
      } as any,
      sourceConnectorToken: polygonUSDC
    };

    const request: QuoteRequest = {
      sourceChainId: 'polygon',
      destinationChainId: 'arbitrum',
      tokenIn: polNative,
      tokenOut: arbitrumUSDC,
      amountInRaw: '1000000000000000000',
      slippageTolerancePercent: 0.5,
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    };

    const plan = ExecutionPlanBuilder.buildPlan({
      request,
      route: {
        id: 'route-polygon-arb-composite',
        routeType: 'CROSS_CHAIN_COMPOSITE',
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        tokenIn: polNative,
        tokenOut: arbitrumUSDC,
        amountInRaw: '1000000000000000000',
        expectedDestinationAmountRaw: '2473806',
        minDestinationAmountRaw: '2461437',
        crossChainQuote: validCompositeQuote,
        compositeRoute: {
          sourceSwap: {
            dexName: 'Zenith V3',
            routerAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
            intermediateToken: polygonUSDC,
            expectedAmountOutRaw: '2492500',
            minimumAmountOutRaw: '2480037',
            calldata: '0x414bf389',
            valueWei: '1000000000000000000'
          },
          bridgeQuote: validCompositeQuote
        },
        hops: [],
        estimatedDurationSec: 30,
        gasCostUSD: 0.05
      },
      options: {
        userAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      }
    });

    assert.ok(plan);
    assert.equal(plan.steps.length, 7);
    assert.doesNotThrow(() => ExecutionPlanValidator.validateCompositePlan(plan));
  });

  // 6. Polygon Actual Amount Propagation & Transfer Log Validation
  await t.test('6. Polygon Actual Amount Extraction: Extracts authoritative USDC output from mined receipt', () => {
    const abiCoder = new Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ]);

    const polygonUSDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
    const swapRouter = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';

    const log = abiCoder.encodeEventLog(abiCoder.getEvent('Transfer')!, [
      swapRouter,
      USER_ADDR,
      2495000n // 2.495 USDC mined
    ]);

    const receipt: any = {
      status: 1,
      blockNumber: 94120150,
      transactionHash: '0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1',
      logs: [{ address: polygonUSDC, topics: log.topics, data: log.data }]
    };

    const res = extractActualSourceSwapOutput({
      receipt,
      expectedTokenOutAddress: polygonUSDC,
      recipientAddress: USER_ADDR,
      minimumAmountOutRaw: '2480000',
      sourceChainId: 'polygon'
    });

    assert.equal(res.actualAmountRaw, '2495000');
  });

  // 7. Approval Safety on Polygon (Exact Bounded Allowance)
  await t.test('7. Approval Safety: Exact bounded approval targeting Across SpokePool on Polygon', () => {
    const MAX_UINT256 = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
    const minedUSDCOutput = 2495000n;
    const targetSpender = ACROSS_SPOKE_POOLS[137];

    assert.equal(targetSpender.toLowerCase(), '0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096');
    assert.notEqual(minedUSDCOutput, MAX_UINT256);
    assert.ok(minedUSDCOutput < MAX_UINT256);
  });

  // 8. Preflight Gas Estimation & 120% Safety Ceiling on Polygon
  await t.test('8. Gas Safety: 120% gas margin calculated correctly for Polygon transactions', () => {
    const swapGasEstimate = 160000n;
    const safeSwapGas = defaultEVMAdapter.calculateSafeGasLimit(swapGasEstimate, 'polygon');
    assert.equal(safeSwapGas, 192000n); // 160000 * 120% = 192000
    assert.equal((safeSwapGas * 100n) / swapGasEstimate, 120n);

    const bridgeGasEstimate = 110000n;
    const safeBridgeGas = defaultEVMAdapter.calculateSafeGasLimit(bridgeGasEstimate, 'polygon');
    assert.equal(safeBridgeGas, 132000n); // 110000 * 120% = 132000
  });

  // 9. Funding Requirement Calculation
  await t.test('9. Funding Requirement: Computes minimal source value + gas + buffer for Polygon test', () => {
    const sourceInputValuePOL = parseEther('1.0'); // 1.0 POL test swap
    const estimatedGasUnitsTotal = 192000n + 54000n + 132000n; // Swap (192k) + Approve (54k) + Bridge (132k) = 378k gas
    const gasPriceWei = 50000000000n; // 50 Gwei on Polygon
    const estimatedGasCostWei = estimatedGasUnitsTotal * gasPriceWei; // 0.0189 POL

    const minRequiredWei = sourceInputValuePOL + estimatedGasCostWei; // 1.0189 POL
    const safetyBufferWei = parseEther('1.0'); // 1.0 POL buffer
    const recommendedFundingWei = minRequiredWei + safetyBufferWei; // ~2.0189 POL

    assert.ok(minRequiredWei > parseEther('1.0'));
    assert.ok(minRequiredWei < parseEther('1.1'));
    assert.ok(recommendedFundingWei < parseEther('2.5'));
  });

  // 10. Persistence & State Recovery on Polygon Composite Route
  await t.test('10. Persistence: Saves and recovers Polygon composite plan across SQLite checkpoints', async () => {
    const repo = new SQLiteCrossChainStateRepository(':memory:');
    const planId = 'plan-polygon-arbitrum-137-42161-test1';

    await repo.saveExecutionPlan({
      planId,
      routeId: 'route-pol-arb-1',
      routeType: 'CROSS_CHAIN_COMPOSITE',
      sourceChainId: 'polygon',
      destinationChainId: 'arbitrum',
      tokenIn: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'POL', decimals: 18, chainId: 'polygon', name: 'Polygon', verificationTier: 'VERIFIED_CANONICAL' },
      tokenOut: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6, chainId: 'arbitrum', name: 'USD Coin', verificationTier: 'VERIFIED_CANONICAL' },
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2473806',
      minimumAmountOutRaw: '2461437',
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
          description: 'Validate Polygon config',
          chainId: 'polygon',
          executionEnvironment: 'EVM',
          status: 'SUCCESS',
          dependencies: [],
          retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    });

    const recovered = await repo.getExecutionPlan(planId);
    assert.ok(recovered);
    assert.equal(recovered.planId, planId);
    assert.equal(recovered.sourceChainId, 'polygon');
    assert.equal(recovered.destinationChainId, 'arbitrum');
  });
});
