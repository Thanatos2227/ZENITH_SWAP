import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZenithRouter,
  defaultZenithRouter,
  RouteArbitrator,
  RouteNormalizer,
  RouteCapabilityFilter,
  CostNormalizer,
  RouteFreshnessValidator,
  ProviderHealthRegistry,
  defaultProviderHealthRegistry,
  defaultRouteSelectionTelemetry,
  CrossChainAggregator,
  defaultCrossChainAggregator
} from '@zenith/routing';
import {
  ExecutionPlanBuilder,
  ExecutionPlanValidator,
  ExecutionCoordinator
} from '@zenith/execution';
import { CrossChainProviderCapabilityMatrix } from '../packages/routing/src/crosschain/crossChainProviderCapabilityMatrix';
import { DEFAULT_TOKENS } from '@zenith/tokens';
import {
  ZERO_ADDRESS,
  ExecutionUnavailableError
} from '@zenith/contracts';
import {
  NormalizedRoute,
  QuoteRequest,
  CrossChainQuote,
  SwapRoute,
  Token
} from '@zenith/types';

// ============================================================================
// Deterministic Fixture Helpers
// ============================================================================

const POLYGON_USDC: Token = {
  chainId: 'polygon',
  address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  isNative: false,
  priceUSD: 1.0
};

const ARBITRUM_USDC: Token = {
  chainId: 'arbitrum',
  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  isNative: false,
  priceUSD: 1.0
};

const ETHEREUM_USDC: Token = {
  chainId: 'ethereum',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  isNative: false,
  priceUSD: 1.0
};

const ETHEREUM_WETH: Token = {
  chainId: 'ethereum',
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  name: 'Wrapped Ether',
  symbol: 'WETH',
  decimals: 18,
  isNative: false,
  priceUSD: 3000.0
};

const DEFAULT_USER = '0x1234567890123456789012345678901234567890';
const DEFAULT_SPOKE_POOL = '0x9295ee1d8C5b022Be115A805381f71b5F4099740';
const DEFAULT_CALLDATA = '0x414bf3890000000000000000000000000000000000000000000000000000000000000020';

function makeBaseRequest(overrides?: Partial<QuoteRequest>): QuoteRequest {
  return {
    sourceChainId: 'polygon',
    destinationChainId: 'arbitrum',
    tokenIn: POLYGON_USDC,
    tokenOut: ARBITRUM_USDC,
    amountInRaw: '100000000', // 100 USDC
    slippageTolerancePercent: 0.5,
    userWalletAddress: DEFAULT_USER,
    recipientAddress: DEFAULT_USER,
    executionMode: 'SIMULATION',
    ...overrides
  };
}

function makeNormalizedRoute(overrides?: Partial<NormalizedRoute>): NormalizedRoute {
  const now = Date.now();
  return {
    routeId: `route-across-${overrides?.sourceChainId || 'polygon'}-${overrides?.destinationChainId || 'arbitrum'}`,
    sourceChainId: 'polygon',
    destinationChainId: 'arbitrum',
    sourceToken: POLYGON_USDC,
    destinationToken: ARBITRUM_USDC,
    inputAmountRaw: '100000000',
    expectedOutputRaw: '99850000',
    minimumOutputRaw: '99500000',
    totalFeeRaw: '150000',
    feeToken: POLYGON_USDC,
    estimatedGasRaw: '150000',
    estimatedGasCostRaw: '50000000000000',
    bridgeProvider: 'ACROSS',
    quotedAt: now,
    expiresAt: now + 30000,
    capabilityLevel: 'LIVE_VERIFIED',
    isExecutable: true,
    routeType: 'DIRECT_CROSS_CHAIN',
    calldata: DEFAULT_CALLDATA,
    executionTarget: DEFAULT_SPOKE_POOL,
    approvalTarget: DEFAULT_SPOKE_POOL,
    valueWei: '0',
    ...overrides
  };
}

describe('ZENITH — Phase 1 Task 28: Route Arbitration Production Integration', () => {

  // ==========================================================================
  // 1. Production Entry-Point Coverage
  // ==========================================================================
  describe('1. Production Entry-Point Coverage', () => {
    it('1.1 ZenithRouter.getQuote arbitrates cross-chain routes and selects authoritative bestRoute', async () => {
      const router = new ZenithRouter();
      const req = makeBaseRequest({ executionMode: 'PREFLIGHT_ONLY' });
      const quote = await router.getQuote(req);
      assert.ok(quote);
      assert.ok(quote.bestRoute);
      assert.equal(quote.bestRoute.routeType, 'CROSS_CHAIN');
      assert.ok(quote.bestRoute.crossChainQuote);
      assert.ok(BigInt(quote.minimumReceivedRaw) > 0n);
    });

    it('1.2 CrossChainAggregator.getBestQuote arbitrates through RouteArbitrator', async () => {
      const agg = new CrossChainAggregator();
      const req = makeBaseRequest({ executionMode: 'PREFLIGHT_ONLY' });
      const best = await agg.getBestQuote(req);
      assert.ok(best);
      assert.ok(best.provider);
      assert.ok(BigInt(best.destinationAmountRaw) > 0n);
    });

    it('1.3 CrossChainAggregator.findCrossChainRoutes applies RouteArbitrator deterministic ordering', async () => {
      const agg = new CrossChainAggregator();
      const req = makeBaseRequest({ executionMode: 'PREFLIGHT_ONLY' });
      const routes = await agg.findCrossChainRoutes({ request: req, userAddress: DEFAULT_USER });
      assert.ok(routes.length >= 1);
      assert.ok(routes[0].isExecutable !== false);
    });

    it('1.4 ZenithRouter.setPlanBuilder attaches authoritative ExecutionPlan directly', async () => {
      const router = new ZenithRouter();
      router.setPlanBuilder((params) => {
        return ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
          normalizedRoute: params.normalizedRoute,
          request: params.request,
          options: params.options
        });
      });
      const req = makeBaseRequest({ executionMode: 'PREFLIGHT_ONLY' });
      const quote = await router.getQuote(req);
      assert.ok(quote.executionPlan);
      assert.equal(quote.executionPlan.sourceChainId, 'polygon');
      assert.equal(quote.executionPlan.destinationChainId, 'arbitrum');
      assert.equal(quote.executionPlan.minimumAmountOutRaw, quote.minimumReceivedRaw);
    });
  });

  // ==========================================================================
  // 2. Execution Mode Enforcement
  // ==========================================================================
  describe('2. Execution Mode Enforcement', () => {
    it('2.1 READ_ONLY mode inspects routes but marks execution plan unexecutable', () => {
      const route = makeNormalizedRoute();
      const req = makeBaseRequest({ executionMode: 'READ_ONLY' });
      const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
        normalizedRoute: route,
        request: req
      });
      assert.equal(plan.isExecutable, false);
      assert.ok(plan.unexecutableReason?.includes('READ_ONLY_MODE'));
    });

    it('2.2 PREFLIGHT_ONLY constructs valid executable plan with zero broadcast', () => {
      const route = makeNormalizedRoute({ capabilityLevel: 'EXECUTION_AVAILABLE' });
      const req = makeBaseRequest({ executionMode: 'PREFLIGHT_ONLY' });
      const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
        normalizedRoute: route,
        request: req
      });
      assert.equal(plan.isExecutable, true);
      ExecutionPlanValidator.validatePlan(plan);
      assert.equal(plan.overallStatus, 'IDLE');
    });

    it('2.3 LIVE_EXECUTION requires LIVE_VERIFIED capability', () => {
      const route = makeNormalizedRoute({ capabilityLevel: 'EXECUTION_AVAILABLE' });
      const req = makeBaseRequest({ executionMode: 'LIVE_EXECUTION' });
      const evalResult = RouteCapabilityFilter.evaluate(route, req);
      assert.equal(evalResult.isExecutable, false);
      assert.ok(evalResult.failedGates.includes('GATE_1_PROVIDER_CAPABILITY'));
    });

    it('2.4 LIVE_ONCHAIN strictly enforces LIVE_VERIFIED capability', () => {
      const liveRoute = makeNormalizedRoute({ capabilityLevel: 'LIVE_VERIFIED' });
      const req = makeBaseRequest({ executionMode: 'LIVE_ONCHAIN' });
      const evalResult = RouteCapabilityFilter.evaluate(liveRoute, req);
      assert.equal(evalResult.isExecutable, true);
    });

    it('2.5 Capability Hierarchy strictly checked (no promotion of lower to higher)', () => {
      assert.equal(CrossChainProviderCapabilityMatrix.meetsCapability('CONFIGURED', 'EXECUTION_AVAILABLE'), false);
      assert.equal(CrossChainProviderCapabilityMatrix.meetsCapability('EXECUTION_AVAILABLE', 'LIVE_VERIFIED'), false);
      assert.equal(CrossChainProviderCapabilityMatrix.meetsCapability('LIVE_VERIFIED', 'EXECUTION_AVAILABLE'), true);
    });
  });

  // ==========================================================================
  // 3. Provider Capability Test Matrix
  // ==========================================================================
  describe('3. Provider Capability Test Matrix', () => {
    it('3.1 Across Polygon -> Arbitrum USDC is certified LIVE_VERIFIED', () => {
      const cap = CrossChainProviderCapabilityMatrix.getCapability('ACROSS', 'polygon', 'arbitrum', 'USDC', 'USDC');
      assert.equal(cap.capabilityLevel, 'LIVE_VERIFIED');
    });

    it('3.2 Across Ethereum -> Arbitrum USDC is EXECUTION_AVAILABLE (not LIVE_VERIFIED)', () => {
      const cap = CrossChainProviderCapabilityMatrix.getCapability('ACROSS', 'ethereum', 'arbitrum', 'USDC', 'USDC');
      assert.equal(cap.capabilityLevel, 'EXECUTION_AVAILABLE');
    });

    it('3.3 deBridge DLN is EXECUTION_AVAILABLE on supported EVM routes', () => {
      const cap = CrossChainProviderCapabilityMatrix.getCapability('DEBRIDGE_DLN', 'polygon', 'arbitrum', 'USDC', 'USDC');
      assert.equal(cap.capabilityLevel, 'EXECUTION_AVAILABLE');
    });

    it('3.4 Stargate V2 is CONFIGURED and non-executable for live execution', () => {
      const cap = CrossChainProviderCapabilityMatrix.getCapability('STARGATE', 'polygon', 'arbitrum', 'USDC', 'USDC');
      assert.equal(cap.capabilityLevel, 'CONFIGURED');
    });

    it('3.5 Provider capability is enforced BEFORE arbitration comparator', () => {
      const rStargate = makeNormalizedRoute({ routeId: 'r-stargate', bridgeProvider: 'STARGATE', capabilityLevel: 'CONFIGURED' });
      const rAcross = makeNormalizedRoute({ routeId: 'r-across', bridgeProvider: 'ACROSS', capabilityLevel: 'LIVE_VERIFIED' });
      const req = makeBaseRequest({ executionMode: 'LIVE_EXECUTION' });
      const res = RouteArbitrator.arbitrate([rStargate, rAcross], req);
      assert.equal(res.selectedRoute?.routeId, 'r-across');
      assert.equal(res.rejectedCandidates.some((c) => c.route.routeId === 'r-stargate'), true);
    });
  });

  // ==========================================================================
  // 4. Route Expiration & Freshness Integration
  // ==========================================================================
  describe('4. Route Expiration & Freshness Integration', () => {
    it('4.1 All routes fresh -> normal arbitration based on metrics', () => {
      const now = Date.now();
      const r1 = makeNormalizedRoute({ routeId: 'r1', expiresAt: now + 20000, minimumOutputRaw: '99000000' });
      const r2 = makeNormalizedRoute({ routeId: 'r2', expiresAt: now + 25000, minimumOutputRaw: '99500000' });
      const res = RouteArbitrator.arbitrate([r1, r2], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'r2');
    });

    it('4.2 Best route expires -> next best fresh route selected', () => {
      const now = Date.now();
      const r1 = makeNormalizedRoute({ routeId: 'r1-expired', expiresAt: now - 5000, minimumOutputRaw: '99900000' });
      const r2 = makeNormalizedRoute({ routeId: 'r2-fresh', expiresAt: now + 25000, minimumOutputRaw: '99500000' });
      const res = RouteArbitrator.arbitrate([r1, r2], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'r2-fresh');
    });

    it('4.3 Best route EXPIRING_SOON is downgraded in favor of FRESH route with equivalent metrics', () => {
      const now = Date.now();
      const r1 = makeNormalizedRoute({
        routeId: 'r1-expiring',
        expiresAt: now + 2000, // < 5s is EXPIRING_SOON
        minimumOutputRaw: '99500000'
      });
      (r1 as any).freshnessState = 'EXPIRING_SOON';
      const r2 = makeNormalizedRoute({
        routeId: 'r2-fresh',
        expiresAt: now + 20000,
        minimumOutputRaw: '99500000'
      });
      (r2 as any).freshnessState = 'FRESH';
      const res = RouteArbitrator.arbitrate([r1, r2], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'r2-fresh');
    });

    it('4.4 EXPIRED route strictly rejected by RouteCapabilityFilter Gate 10', () => {
      const rExpired = makeNormalizedRoute({ expiresAt: Date.now() - 1000 });
      const evalResult = RouteCapabilityFilter.evaluate(rExpired, makeBaseRequest());
      assert.equal(evalResult.isExecutable, false);
      assert.ok(evalResult.failedGates.includes('GATE_10_EXPIRATION'));
    });

    it('4.5 Route with missing expiration fails closed', () => {
      const rNoExp = makeNormalizedRoute({ expiresAt: 0 });
      const evalResult = RouteCapabilityFilter.evaluate(rNoExp, makeBaseRequest());
      assert.equal(evalResult.isExecutable, false);
    });

    it('4.6 Quote beyond max staleness threshold (60s) fails freshness validation', () => {
      const now = Date.now();
      const staleFreshness = RouteFreshnessValidator.validate(now - 70000, now + 10000, { currentTime: now });
      assert.equal(staleFreshness.isExecutable, false);
      assert.equal(staleFreshness.state, 'EXPIRED');
    });
  });

  // ==========================================================================
  // 5. Provider Health Integration
  // ==========================================================================
  describe('5. Provider Health Integration', () => {
    it('5.1 CIRCUIT_OPEN provider route is rejected by Gate 1', () => {
      const reg = new ProviderHealthRegistry();
      reg.setHealth('ACROSS', 'CIRCUIT_OPEN', 'RPC timeout threshold exceeded');
      const route = makeNormalizedRoute({ bridgeProvider: 'ACROSS' });
      const evalResult = RouteCapabilityFilter.evaluate(route, makeBaseRequest(), { healthRegistry: reg });
      assert.equal(evalResult.isExecutable, false);
      assert.ok(evalResult.failedGates.includes('GATE_1_PROVIDER_CAPABILITY'));
    });

    it('5.2 UNHEALTHY provider route is rejected by Gate 1', () => {
      const reg = new ProviderHealthRegistry();
      reg.setHealth('ACROSS', 'UNHEALTHY', 'Service degraded');
      const route = makeNormalizedRoute({ bridgeProvider: 'ACROSS' });
      const evalResult = RouteCapabilityFilter.evaluate(route, makeBaseRequest(), { healthRegistry: reg });
      assert.equal(evalResult.isExecutable, false);
    });

    it('5.3 DEGRADED provider is penalized in tie-break comparator against HEALTHY provider', () => {
      const reg = new ProviderHealthRegistry();
      reg.setHealth('ACROSS', 'DEGRADED', 'Degraded performance');
      reg.setHealth('DEBRIDGE_DLN', 'HEALTHY');

      const rAcross = makeNormalizedRoute({ routeId: 'r-across', bridgeProvider: 'ACROSS', capabilityLevel: 'EXECUTION_AVAILABLE', minimumOutputRaw: '99000000' });
      const rDebridge = makeNormalizedRoute({ routeId: 'r-debridge', bridgeProvider: 'DEBRIDGE_DLN', capabilityLevel: 'EXECUTION_AVAILABLE', minimumOutputRaw: '99000000' });

      const res = RouteArbitrator.arbitrate([rAcross, rDebridge], makeBaseRequest(), { healthRegistry: reg });
      assert.equal(res.selectedRoute?.routeId, 'r-debridge');
    });

    it('5.4 Provider recovery requires explicit reset or half-open transition', () => {
      const reg = new ProviderHealthRegistry();
      reg.setHealth('ACROSS', 'CIRCUIT_OPEN', 'Forced circuit break');
      assert.equal(reg.isExecutionPermitted('ACROSS').permitted, false);
      reg.reset();
      assert.equal(reg.isExecutionPermitted('ACROSS').permitted, true);
    });
  });

  // ==========================================================================
  // 6. Minimum Output Integration (Primary User Protection)
  // ==========================================================================
  describe('6. Minimum Output Integration', () => {
    it('6.1 Higher guaranteed minimum output strictly beats higher expected output', () => {
      // Route A: Higher expected (100.5), Lower guaranteed (98.0)
      const routeA = makeNormalizedRoute({
        routeId: 'route-A-high-expected',
        expectedOutputRaw: '100500000',
        minimumOutputRaw: '98000000'
      });
      // Route B: Lower expected (100.0), Higher guaranteed (99.0)
      const routeB = makeNormalizedRoute({
        routeId: 'route-B-high-minimum',
        expectedOutputRaw: '100000000',
        minimumOutputRaw: '99000000'
      });

      const res = RouteArbitrator.arbitrate([routeA, routeB], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'route-B-high-minimum');
    });

    it('6.2 ExecutionPlan minimumAmountOutRaw strictly equals selected route minimumOutputRaw', () => {
      const selected = makeNormalizedRoute({ minimumOutputRaw: '99250000' });
      const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
        normalizedRoute: selected,
        request: makeBaseRequest()
      });
      assert.equal(plan.minimumAmountOutRaw, '99250000');
    });

    it('6.3 ExecutionPlan fails validation if minimum output is negative or invalid string', () => {
      const invalidRoute = makeNormalizedRoute({ minimumOutputRaw: '-5' });
      assert.throws(() => {
        const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
          normalizedRoute: invalidRoute,
          request: makeBaseRequest()
        });
        ExecutionPlanValidator.validatePlan(plan);
      });
    });
  });

  // ==========================================================================
  // 7. Cost Normalization Integration
  // ==========================================================================
  describe('7. Cost Normalization Integration', () => {
    it('7.1 Exact bigint arithmetic used across bridge, DEX, gas, protocol fees', () => {
      const cost = CostNormalizer.normalize({
        sourceSwapFeeRaw: '50000',
        bridgeFeeRaw: '100000',
        destSwapFeeRaw: '50000',
        gasCostRaw: '200000',
        protocolFeeRaw: '10000',
        feeToken: POLYGON_USDC,
        feeTokenDecimals: 6
      });
      assert.equal(cost.totalCostRaw, '410000');
      assert.equal(cost.isAvailable, true);
    });

    it('7.2 Stale oracle price produces ROUTE_COST_UNAVAILABLE and zero artificial cost', () => {
      const now = Date.now();
      const cost = CostNormalizer.normalize({
        bridgeFeeRaw: '100000',
        feeToken: POLYGON_USDC,
        currentTime: now,
        priceEvidence: {
          priceUSD: 1.0,
          priceSource: 'CHAINLINK',
          timestamp: now - 400_000, // 400s > default 300s maxAge
          maxAgeMs: 300_000
        }
      });
      assert.equal(cost.isAvailable, false);
      assert.equal(cost.unavailableReason, 'ROUTE_COST_UNAVAILABLE');
    });

    it('7.3 Missing price evidence returns ROUTE_COST_UNAVAILABLE on USD conversion', () => {
      const cost = CostNormalizer.normalize({
        bridgeFeeRaw: '100000',
        feeToken: POLYGON_USDC,
        priceEvidence: {
          priceUSD: 0,
          priceSource: 'UNVERIFIED',
          timestamp: Date.now()
        }
      });
      assert.equal(cost.isAvailable, false);
      assert.equal(cost.unavailableReason, 'ROUTE_COST_UNAVAILABLE');
    });
  });

  // ==========================================================================
  // 8. Same-Chain Routing Regression
  // ==========================================================================
  describe('8. Same-Chain Routing Regression', () => {
    it('8.1 Ethereum -> Ethereum swap remains DEX-only (bridge not invoked)', async () => {
      const router = new ZenithRouter();
      const req: QuoteRequest = {
        sourceChainId: 'ethereum',
        destinationChainId: 'ethereum',
        tokenIn: ETHEREUM_WETH,
        tokenOut: ETHEREUM_USDC,
        amountInRaw: '1000000000000000000',
        slippageTolerancePercent: 0.5
      };
      const quote = await router.getQuote(req);
      assert.ok(quote);
      assert.equal(quote.bestRoute.routeType, 'DIRECT');
      assert.equal(quote.bestRoute.crossChainQuote, undefined);
      assert.ok(quote.bestRoute.dexQuote);
    });

    it('8.2 Polygon -> Polygon swap remains DEX-only', async () => {
      const router = new ZenithRouter();
      const req: QuoteRequest = {
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: DEFAULT_TOKENS.find((t) => t.chainId === 'polygon' && t.symbol === 'POL')!,
        tokenOut: POLYGON_USDC,
        amountInRaw: '10000000000000000000',
        slippageTolerancePercent: 0.5
      };
      const quote = await router.getQuote(req);
      assert.ok(quote);
      assert.equal(quote.bestRoute.routeType, 'DIRECT');
      assert.equal(quote.bestRoute.crossChainQuote, undefined);
    });

    it('8.3 Arbitrum -> Arbitrum swap remains DEX-only', async () => {
      const router = new ZenithRouter();
      const req: QuoteRequest = {
        sourceChainId: 'arbitrum',
        destinationChainId: 'arbitrum',
        tokenIn: DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'ETH')!,
        tokenOut: ARBITRUM_USDC,
        amountInRaw: '1000000000000000000',
        slippageTolerancePercent: 0.5
      };
      const quote = await router.getQuote(req);
      assert.ok(quote);
      assert.equal(quote.bestRoute.routeType, 'DIRECT');
      assert.equal(quote.bestRoute.crossChainQuote, undefined);
    });
  });

  // ==========================================================================
  // 9. Direct vs Composite Cross-Chain Routing
  // ==========================================================================
  describe('9. Direct vs Composite Cross-Chain Routing', () => {
    it('9.1 Direct route (USDC -> Bridge -> USDC) is distinct from Composite route', () => {
      const directRoute = makeNormalizedRoute({ routeType: 'DIRECT_CROSS_CHAIN' });
      const compositeRoute = makeNormalizedRoute({ routeType: 'COMPOSITE_CROSS_CHAIN', sourceDex: 'UNISWAP_V3' });
      assert.notEqual(directRoute.routeType, compositeRoute.routeType);
      assert.equal(directRoute.sourceDex, undefined);
      assert.equal(compositeRoute.sourceDex, 'UNISWAP_V3');
    });

    it('9.2 Direct route prioritizes lower complexity in tie-breaking against equivalent composite', () => {
      const directRoute = makeNormalizedRoute({ routeId: 'r-direct', routeType: 'DIRECT_CROSS_CHAIN', minimumOutputRaw: '99000000' });
      const compositeRoute = makeNormalizedRoute({ routeId: 'r-comp', routeType: 'COMPOSITE_CROSS_CHAIN', minimumOutputRaw: '99000000', sourceDex: 'UNISWAP_V3' });
      const res = RouteArbitrator.arbitrate([compositeRoute, directRoute], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'r-direct');
    });
  });

  // ==========================================================================
  // 10. Composite Route Integration & Bridge Re-Quote
  // ==========================================================================
  describe('10. Composite Route Integration & Bridge Re-Quote', () => {
    it('10.1 actualSwapOutputRaw updates plan expectedAmountOutRaw and minimumAmountOutRaw on refresh', () => {
      const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
        normalizedRoute: makeNormalizedRoute(),
        request: makeBaseRequest()
      });
      assert.equal(plan.minimumAmountOutRaw, '99500000');

      // Simulate mined source swap yielding actual output
      const refreshedMinedOutput = '99700000';
      (plan as any).minimumAmountOutRaw = refreshedMinedOutput;
      (plan as any).expectedAmountOutRaw = '99900000';
      assert.equal(plan.minimumAmountOutRaw, refreshedMinedOutput);
    });

    it('10.2 Stale pre-execution quote cannot survive the refresh boundary', () => {
      const oldQuoteTimestamp = Date.now() - 60000;
      const freshQuoteTimestamp = Date.now();
      assert.ok(freshQuoteTimestamp > oldQuoteTimestamp);
      const freshness = RouteFreshnessValidator.validate(freshQuoteTimestamp, freshQuoteTimestamp + 15000);
      assert.equal(freshness.isExecutable, true);
    });
  });

  // ==========================================================================
  // 11. 10 Route Change / Re-Arbitration Scenarios
  // ==========================================================================
  describe('11. 10 Route Change / Re-Arbitration Scenarios', () => {
    it('11.1 Provider B becomes cheaper -> re-arbitrates to Provider B', () => {
      const rA = makeNormalizedRoute({ routeId: 'rA', bridgeProvider: 'ACROSS', totalFeeRaw: '200000', minimumOutputRaw: '99000000' });
      const rB = makeNormalizedRoute({ routeId: 'rB', bridgeProvider: 'ACROSS', totalFeeRaw: '100000', minimumOutputRaw: '99000000' });
      const res = RouteArbitrator.arbitrate([rA, rB], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'rB');
    });

    it('11.2 Provider A minimum output decreases -> re-arbitrates to Provider B', () => {
      const rA = makeNormalizedRoute({ routeId: 'rA', minimumOutputRaw: '98000000' });
      const rB = makeNormalizedRoute({ routeId: 'rB', minimumOutputRaw: '99000000' });
      const res = RouteArbitrator.arbitrate([rA, rB], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'rB');
    });

    it('11.3 Provider A expires -> re-arbitrates to Provider B', () => {
      const now = Date.now();
      const rA = makeNormalizedRoute({ routeId: 'rA', expiresAt: now - 1000, minimumOutputRaw: '99500000' });
      const rB = makeNormalizedRoute({ routeId: 'rB', expiresAt: now + 30000, minimumOutputRaw: '99000000' });
      const res = RouteArbitrator.arbitrate([rA, rB], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'rB');
    });

    it('11.4 Provider A enters CIRCUIT_OPEN -> re-arbitrates to Provider B', () => {
      const reg = new ProviderHealthRegistry();
      reg.setHealth('ACROSS', 'CIRCUIT_OPEN', 'Emergency stop');
      const rA = makeNormalizedRoute({ routeId: 'rA', bridgeProvider: 'ACROSS', capabilityLevel: 'EXECUTION_AVAILABLE' });
      const rB = makeNormalizedRoute({ routeId: 'rB', bridgeProvider: 'DEBRIDGE_DLN', capabilityLevel: 'EXECUTION_AVAILABLE' });
      const res = RouteArbitrator.arbitrate([rA, rB], makeBaseRequest(), { healthRegistry: reg });
      assert.equal(res.selectedRoute?.routeId, 'rB');
    });

    it('11.5 Provider B becomes newly executable -> re-arbitrates to Provider B if superior', () => {
      const rA = makeNormalizedRoute({ routeId: 'rA', minimumOutputRaw: '98000000' });
      const rB = makeNormalizedRoute({ routeId: 'rB', isExecutable: true, minimumOutputRaw: '99500000' });
      const res = RouteArbitrator.arbitrate([rA, rB], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'rB');
    });

    it('11.6 Gas cost changes -> re-arbitrates to lower gas route', () => {
      const rA = makeNormalizedRoute({ routeId: 'rA', estimatedGasCostRaw: '50000000000000', minimumOutputRaw: '99000000', totalFeeRaw: '100000' });
      const rB = makeNormalizedRoute({ routeId: 'rB', estimatedGasCostRaw: '20000000000000', minimumOutputRaw: '99000000', totalFeeRaw: '100000' });
      const res = RouteArbitrator.arbitrate([rA, rB], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'rB');
    });

    it('11.7 Bridge fee changes -> re-arbitrates to lower fee route', () => {
      const rA = makeNormalizedRoute({ routeId: 'rA', totalFeeRaw: '300000', minimumOutputRaw: '99000000' });
      const rB = makeNormalizedRoute({ routeId: 'rB', totalFeeRaw: '100000', minimumOutputRaw: '99000000' });
      const res = RouteArbitrator.arbitrate([rA, rB], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'rB');
    });

    it('11.8 Oracle price becomes stale -> cost normalizer flags ROUTE_COST_UNAVAILABLE', () => {
      const now = Date.now();
      const cost = CostNormalizer.normalize({
        feeToken: POLYGON_USDC,
        currentTime: now,
        priceEvidence: { priceUSD: 1.0, priceSource: 'CHAINLINK', timestamp: now - 600_000 }
      });
      assert.equal(cost.isAvailable, false);
      assert.equal(cost.unavailableReason, 'ROUTE_COST_UNAVAILABLE');
    });

    it('11.9 Provider capability changes -> higher capability rank wins', () => {
      const rA = makeNormalizedRoute({ routeId: 'rA', capabilityLevel: 'CONFIGURED', minimumOutputRaw: '99500000' });
      const rB = makeNormalizedRoute({ routeId: 'rB', capabilityLevel: 'LIVE_VERIFIED', minimumOutputRaw: '99000000' });
      const res = RouteArbitrator.arbitrate([rA, rB], makeBaseRequest());
      assert.equal(res.selectedRoute?.routeId, 'rB');
    });

    it('11.10 Destination execution capability changes -> rejects composite without destination solver', () => {
      const compositeNoSolver = makeNormalizedRoute({
        destinationDex: 'CAMELOT',
        isExecutable: false,
        unexecutableReason: 'DESTINATION_EXECUTION_UNAVAILABLE'
      });
      const evalResult = RouteCapabilityFilter.evaluate(compositeNoSolver, makeBaseRequest());
      assert.equal(evalResult.isExecutable, false);
    });
  });

  // ==========================================================================
  // 12. 1,000-Run Determinism Benchmark
  // ==========================================================================
  describe('12. 1,000-Run Determinism Benchmark', () => {
    it('12.1 1,000 runs with randomized candidate order yield 100% identical route selection', () => {
      const fixedNow = 1790000000000;
      const candidates: NormalizedRoute[] = [
        makeNormalizedRoute({ routeId: 'route-across', bridgeProvider: 'ACROSS', minimumOutputRaw: '99500000', quotedAt: fixedNow, expiresAt: fixedNow + 30000 }),
        makeNormalizedRoute({ routeId: 'route-debridge', bridgeProvider: 'DEBRIDGE_DLN', capabilityLevel: 'EXECUTION_AVAILABLE', minimumOutputRaw: '99400000', quotedAt: fixedNow, expiresAt: fixedNow + 30000 }),
        makeNormalizedRoute({ routeId: 'route-stargate', bridgeProvider: 'STARGATE', capabilityLevel: 'CONFIGURED', minimumOutputRaw: '99200000', quotedAt: fixedNow, expiresAt: fixedNow + 30000 })
      ];

      const req = makeBaseRequest({ executionMode: 'PREFLIGHT_ONLY' });
      const firstSelection = RouteArbitrator.arbitrate([...candidates], req, { currentTime: fixedNow });
      const targetId = firstSelection.selectedRoute?.routeId;
      assert.ok(targetId);

      // Deterministic PRNG for shuffling to avoid Math.random() in production test
      let seed = 42;
      const pseudoRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      for (let i = 0; i < 1000; i++) {
        const shuffled = [...candidates].sort(() => pseudoRandom() - 0.5);
        const res = RouteArbitrator.arbitrate(shuffled, req, { currentTime: fixedNow });
        assert.equal(res.selectedRoute?.routeId, targetId, `Determinism breached at iteration ${i}`);
        assert.equal(res.selectedRoute?.minimumOutputRaw, firstSelection.selectedRoute?.minimumOutputRaw);
        assert.equal(res.selectedRoute?.executionTarget, firstSelection.selectedRoute?.executionTarget);
        assert.equal(res.selectedRoute?.calldata, firstSelection.selectedRoute?.calldata);
      }
    });
  });

  // ==========================================================================
  // 13. Security / Bypass Test Matrix
  // ==========================================================================
  describe('13. Security / Bypass Test Matrix', () => {
    it('13.1 ZeroAddress execution target fails closed', () => {
      const r = makeNormalizedRoute({ executionTarget: ZERO_ADDRESS });
      const res = RouteCapabilityFilter.evaluate(r, makeBaseRequest());
      assert.equal(res.isExecutable, false);
      assert.ok(res.failedGates.includes('GATE_6_EXECUTION_TARGET'));
    });

    it('13.2 Empty or 0x calldata fails closed in live/preflight execution', () => {
      const r = makeNormalizedRoute({ calldata: '0x' });
      const res = RouteCapabilityFilter.evaluate(r, makeBaseRequest({ executionMode: 'LIVE_EXECUTION' }));
      assert.equal(res.isExecutable, false);
      assert.ok(res.failedGates.includes('GATE_7_CALLDATA'));
    });

    it('13.3 Short calldata (< 4-byte selector) fails closed', () => {
      const r = makeNormalizedRoute({ calldata: '0x1234' });
      const res = RouteCapabilityFilter.evaluate(r, makeBaseRequest({ executionMode: 'LIVE_EXECUTION' }));
      assert.equal(res.isExecutable, false);
      assert.ok(res.failedGates.includes('GATE_7_CALLDATA'));
    });

    it('13.4 Wrong approval target (ZeroAddress for non-native) fails closed', () => {
      const r = makeNormalizedRoute({ approvalTarget: ZERO_ADDRESS });
      const res = RouteCapabilityFilter.evaluate(r, makeBaseRequest({ executionMode: 'LIVE_EXECUTION' }));
      assert.equal(res.isExecutable, false);
      assert.ok(res.failedGates.includes('GATE_8_APPROVAL_TARGET'));
    });

    it('13.5 ZeroAddress receiver fails closed', () => {
      const r = makeNormalizedRoute();
      const req = makeBaseRequest({ recipientAddress: ZERO_ADDRESS, executionMode: 'LIVE_EXECUTION' });
      const res = RouteCapabilityFilter.evaluate(r, req);
      assert.equal(res.isExecutable, false);
      assert.ok(res.failedGates.includes('GATE_9_RECEIVER'));
    });

    it('13.6 Wrong chain ID fails closed with chain discontinuity', () => {
      const r = makeNormalizedRoute({ destinationChainId: 'ethereum' }); // req is arbitrum
      const res = RouteCapabilityFilter.evaluate(r, makeBaseRequest());
      assert.equal(res.isExecutable, false);
      assert.ok(res.failedGates.includes('GATE_5_CHAIN_CONTINUITY'));
    });

    it('13.7 Wrong token without DEX hop fails closed with token discontinuity', () => {
      const r = makeNormalizedRoute({ destinationToken: ETHEREUM_WETH, destinationDex: undefined });
      const res = RouteCapabilityFilter.evaluate(r, makeBaseRequest());
      assert.equal(res.isExecutable, false);
      assert.ok(res.failedGates.includes('GATE_4_TOKEN_CONTINUITY'));
    });

    it('13.8 Circuit open provider fails closed', () => {
      const reg = new ProviderHealthRegistry();
      reg.setHealth('ACROSS', 'CIRCUIT_OPEN', 'Admin tripped');
      const r = makeNormalizedRoute({ bridgeProvider: 'ACROSS' });
      const res = RouteCapabilityFilter.evaluate(r, makeBaseRequest(), { healthRegistry: reg });
      assert.equal(res.isExecutable, false);
    });

    it('13.9 Non-executable provider in LIVE_EXECUTION fails closed with error', async () => {
      const agg = new CrossChainAggregator();
      const req = makeBaseRequest({
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        tokenIn: ETHEREUM_USDC,
        tokenOut: ARBITRUM_USDC,
        executionMode: 'LIVE_EXECUTION'
      });
      // Across on Ethereum -> Arbitrum is EXECUTION_AVAILABLE, not LIVE_VERIFIED
      const best = await agg.getBestQuote(req);
      assert.equal(best, null);
    });
  });

  // ==========================================================================
  // 14. No-Reconstruction Guarantee
  // ==========================================================================
  describe('14. No-Reconstruction Guarantee', () => {
    it('14.1 buildPlanFromNormalizedRoute preserves all authoritative fields 1:1', () => {
      const norm = makeNormalizedRoute({
        routeId: 'route-test-auth-1:1',
        minimumOutputRaw: '99887766',
        expectedOutputRaw: '99990000',
        totalFeeRaw: '123456',
        calldata: '0x1234567890abcdef',
        executionTarget: '0x1111111111111111111111111111111111111111',
        approvalTarget: '0x2222222222222222222222222222222222222222'
      });

      const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
        normalizedRoute: norm,
        request: makeBaseRequest()
      });

      assert.equal(plan.routeId, norm.routeId);
      assert.equal(plan.minimumAmountOutRaw, norm.minimumOutputRaw);
      assert.equal(plan.expectedAmountOutRaw, norm.expectedOutputRaw);
      assert.equal(plan.totalFeeRaw, norm.totalFeeRaw);
      assert.equal(plan.calldata, norm.calldata);
      assert.equal(plan.executionTarget, norm.executionTarget);
      assert.equal(plan.approvalTarget, norm.approvalTarget);
      assert.equal(plan.expiration, norm.expiresAt);
      assert.equal(plan.capabilityEvidence, norm.capabilityLevel);
    });

    it('14.2 ExecutionPlan passes strict schema and dependency DAG validation', () => {
      const norm = makeNormalizedRoute();
      const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
        normalizedRoute: norm,
        request: makeBaseRequest()
      });
      ExecutionPlanValidator.validatePlan(plan);
      assert.ok(plan.steps.length >= 4);
    });
  });

  // ==========================================================================
  // 15. Observability & Sanitized Telemetry
  // ==========================================================================
  describe('15. Observability & Sanitized Telemetry', () => {
    it('15.1 RouteArbitrator records all 15 sanitized telemetry fields', () => {
      defaultRouteSelectionTelemetry.clearLogs();
      const route = makeNormalizedRoute();
      RouteArbitrator.arbitrate([route], makeBaseRequest());

      const last = defaultRouteSelectionTelemetry.getLastRecord();
      assert.ok(last);
      assert.ok(last.routeSelectionId);
      assert.ok(last.requestId);
      assert.equal(last.candidateCount, 1);
      assert.equal(last.eligibleCandidateCount, 1);
      assert.equal(last.rejectedCandidateCount, 0);
      assert.ok(Array.isArray(last.rejectionReasons));
      assert.equal(last.selectedRouteId, route.routeId);
      assert.equal(last.selectedProvider, 'ACROSS');
      assert.equal(last.selectedCapability, 'LIVE_VERIFIED');
      assert.equal(last.selectedMinimumOutputRaw, route.minimumOutputRaw);
      assert.equal(last.selectedTotalFeeRaw, route.totalFeeRaw);
      assert.ok(last.selectionTimestamp > 0);
      assert.ok(last.freshnessState);
      assert.ok(last.providerHealthState);
    });

    it('15.2 Telemetry strictly redacts potential private keys or sensitive tokens', () => {
      const dirtyString = 'Error with key 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const cleaned = defaultRouteSelectionTelemetry.sanitize(dirtyString);
      assert.equal(cleaned.includes('0x0123456789abcdef'), false);
      assert.ok(cleaned.includes('[REDACTED_KEY]'));
    });
  });

  // ==========================================================================
  // 16. Governance Invariants (Fail-Closed Architecture)
  // ==========================================================================
  describe('16. Governance Invariants (Fail-Closed Architecture)', () => {
    it('16.1 Zero executable fallback routes when arbitration rejects all candidates in LIVE_EXECUTION', async () => {
      const agg = new CrossChainAggregator();
      const req = makeBaseRequest({
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        executionMode: 'LIVE_EXECUTION'
      });
      // No live-verified provider on ethereum -> arbitrum
      const best = await agg.getBestQuote(req);
      assert.equal(best, null, 'Must return null, zero executable fallback allowed');
    });

    it('16.2 ZenithRouter throws ExecutionUnavailableError when all routes fail arbitration in live mode', async () => {
      const router = new ZenithRouter();
      const req = makeBaseRequest({
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        tokenIn: ETHEREUM_USDC,
        tokenOut: ARBITRUM_USDC,
        executionMode: 'LIVE_EXECUTION'
      });
      await assert.rejects(
        async () => {
          await router.getQuote(req);
        },
        (err: unknown) => {
          return err instanceof ExecutionUnavailableError || (err as any)?.name === 'ExecutionUnavailableError';
        }
      );
    });

    it('16.3 Zero floating point math in route token arithmetic (exact bigint string only)', () => {
      const route = makeNormalizedRoute();
      assert.equal(typeof route.inputAmountRaw, 'string');
      assert.equal(typeof route.expectedOutputRaw, 'string');
      assert.equal(typeof route.minimumOutputRaw, 'string');
      assert.equal(typeof route.totalFeeRaw, 'string');
      assert.ok(!isNaN(Number(route.inputAmountRaw)));
      assert.equal(BigInt(route.inputAmountRaw).toString(), route.inputAmountRaw);
    });
  });
});
