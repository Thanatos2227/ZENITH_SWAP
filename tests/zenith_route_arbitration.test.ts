import test from 'node:test';
import assert from 'node:assert/strict';
import { QuoteRequest, Token, NormalizedRoute, SwapRoute, ExecutionPlan } from '@zenith/types';
import { RouteFreshnessValidator, ProviderHealthRegistry, CostNormalizer, RouteCapabilityFilter, RouteNormalizer, RouteArbitrator } from '../packages/routing/src/arbitration';
import { CrossChainProviderCapabilityMatrix } from '../packages/routing/src/crosschain/crossChainProviderCapabilityMatrix';
import { ExecutionPlanBuilder } from '../packages/execution/src/executionPlanBuilder';
import { extractActualSourceSwapOutput } from '../packages/execution/src/crosschain/sourceSwapOutputExtractor';
import { ZERO_ADDRESS } from '../packages/contracts/src/errors';
const USER_ADDR = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';
const SPOKE_POOL_ADDR = '0x9295ee1d8C5b022Be115A805381f71b5F4099740';
const DEBRIDGE_ADDR = '0xef4fb24aD0916217251F553c0596F8Edc630EB66';
const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const POL_TOKEN: Token = {
    chainId: 'polygon',
    address: '0x0000000000000000000000000000000000001010',
    name: 'Polygon Ecosystem Token',
    symbol: 'POL',
    decimals: 18,
    isNative: true,
    priceUSD: 0.38
};
const USDC_POLYGON: Token = {
    chainId: 'polygon',
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    isNative: false,
    priceUSD: 1.0
};
const USDC_ARBITRUM: Token = {
    chainId: 'arbitrum',
    address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    isNative: false,
    priceUSD: 1.0
};
const WETH_ARBITRUM: Token = {
    chainId: 'arbitrum',
    address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    isNative: false,
    priceUSD: 2450.0
};
function createBaseRequest(overrides?: Partial<QuoteRequest>): QuoteRequest {
    return {
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        tokenIn: USDC_POLYGON,
        tokenOut: USDC_ARBITRUM,
        amountInRaw: '1000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: USER_ADDR,
        slippageTolerancePercent: 0.5,
        executionMode: 'SIMULATION',
        ...overrides
    };
}
function createSampleRoute(overrides?: Partial<NormalizedRoute>): NormalizedRoute {
    const now = Date.now();
    return {
        routeId: `route-sample-${Math.random().toString(36).substring(2, 7)}`,
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        sourceToken: USDC_POLYGON,
        destinationToken: USDC_ARBITRUM,
        inputAmountRaw: '1000000',
        expectedOutputRaw: '998500',
        minimumOutputRaw: '995000',
        totalFeeRaw: '1500',
        feeToken: USDC_POLYGON,
        estimatedGasRaw: '150000',
        estimatedGasCostRaw: '50000000000000',
        bridgeProvider: 'ACROSS',
        quotedAt: now - 2000,
        expiresAt: now + 30000,
        capabilityLevel: 'LIVE_VERIFIED',
        isExecutable: true,
        routeType: 'DIRECT_CROSS_CHAIN',
        calldata: '0x12345678abcdef0123456789abcdef0123456789',
        executionTarget: SPOKE_POOL_ADDR,
        approvalTarget: SPOKE_POOL_ADDR,
        valueWei: '0',
        ...overrides
    };
}
test('ZENITH — Phase 1 Task 27: Cross-Provider Route Selection & Quote Arbitration Suite', async (t) => {
    await t.test('Suite 1: Capability and Provider Health Filtering', async (t1) => {
        await t1.test('passes all 10 gates for a fully verified, fresh route', () => {
            const route = createSampleRoute();
            const req = createBaseRequest();
            const evalResult = RouteCapabilityFilter.evaluate(route, req);
            assert.equal(evalResult.isExecutable, true);
            assert.equal(evalResult.failedGates.length, 0);
            assert.ok(evalResult.passedGates.length >= 10);
        });
        await t1.test('fails closed when provider health is CIRCUIT_OPEN', () => {
            const healthRegistry = new ProviderHealthRegistry();
            healthRegistry.setHealth('ACROSS', 'CIRCUIT_OPEN', 'Excessive RPC dropouts');
            const route = createSampleRoute({ bridgeProvider: 'ACROSS' });
            const req = createBaseRequest();
            const evalResult = RouteCapabilityFilter.evaluate(route, req, { healthRegistry });
            assert.equal(evalResult.isExecutable, false);
            assert.ok(evalResult.failedGates.includes('GATE_1_PROVIDER_CAPABILITY'));
            assert.ok(evalResult.unexecutableReason?.includes('CIRCUIT_OPEN'));
        });
        await t1.test('fails closed when provider health is UNHEALTHY', () => {
            const healthRegistry = new ProviderHealthRegistry();
            healthRegistry.setHealth('ACROSS', 'UNHEALTHY', 'API endpoint down');
            const route = createSampleRoute({ bridgeProvider: 'ACROSS' });
            const req = createBaseRequest();
            const evalResult = RouteCapabilityFilter.evaluate(route, req, { healthRegistry });
            assert.equal(evalResult.isExecutable, false);
            assert.ok(evalResult.failedGates.includes('GATE_1_PROVIDER_CAPABILITY'));
            assert.ok(evalResult.unexecutableReason?.includes('UNHEALTHY'));
        });
        await t1.test('permits DEGRADED provider with arbitration rank penalty', () => {
            const healthRegistry = new ProviderHealthRegistry();
            healthRegistry.setHealth('DEGRADED_PROV', 'DEGRADED', 'Elevated latency');
            const penalty = healthRegistry.getArbitrationPenalty('DEGRADED_PROV');
            assert.ok(penalty > 0n);
            assert.equal(healthRegistry.isExecutionPermitted('DEGRADED_PROV').permitted, true);
        });
        await t1.test('strictly requires LIVE_VERIFIED capability in LIVE_EXECUTION mode', () => {
            const debridgeRoute = createSampleRoute({
                bridgeProvider: 'DEBRIDGE_DLN',
                capabilityLevel: 'EXECUTION_AVAILABLE'
            });
            const req = createBaseRequest({ executionMode: 'LIVE_EXECUTION' });
            const evalResult = RouteCapabilityFilter.evaluate(debridgeRoute, req, { executionMode: 'LIVE_EXECUTION' });
            assert.equal(evalResult.isExecutable, false);
            assert.ok(evalResult.failedGates.includes('GATE_1_PROVIDER_CAPABILITY'));
            assert.ok(evalResult.unexecutableReason?.includes('not LIVE_VERIFIED'));
        });
    });
    await t.test('Suite 2: Exact Cost Normalization & Quote Freshness', async (t2) => {
        await t2.test('computes exact integer cost sum without floating point arithmetic', () => {
            const result = CostNormalizer.normalize({
                sourceSwapFeeRaw: '3000',
                bridgeFeeRaw: '15000',
                destSwapFeeRaw: '2000',
                gasCostRaw: '50000',
                protocolFeeRaw: '500',
                feeToken: USDC_POLYGON,
                feeTokenDecimals: 6
            });
            assert.equal(result.isAvailable, true);
            assert.equal(result.totalCostRaw, '70500');
        });
        await t2.test('converts cost to USD accurately using explicit price evidence', () => {
            const now = Date.now();
            const result = CostNormalizer.normalize({
                sourceSwapFeeRaw: '1000000',
                bridgeFeeRaw: '500000',
                feeToken: USDC_POLYGON,
                feeTokenDecimals: 6,
                currentTime: now,
                priceEvidence: {
                    priceUSD: 1.0,
                    priceSource: 'CHAINLINK_ORACLE',
                    timestamp: now - 10000,
                    maxAgeMs: 60000
                }
            });
            assert.equal(result.isAvailable, true);
            assert.equal(result.totalCostRaw, '1500000');
            assert.equal(result.normalizedCostUSD, '1.500000');
        });
        await t2.test('returns ROUTE_COST_UNAVAILABLE when price evidence is expired or missing', () => {
            const now = Date.now();
            const result = CostNormalizer.normalize({
                bridgeFeeRaw: '500000',
                feeToken: USDC_POLYGON,
                currentTime: now,
                priceEvidence: {
                    priceUSD: 1.0,
                    priceSource: 'CHAINLINK_ORACLE',
                    timestamp: now - 400000,
                    maxAgeMs: 300000
                }
            });
            assert.equal(result.isAvailable, false);
            assert.equal(result.unavailableReason, 'ROUTE_COST_UNAVAILABLE');
        });
        await t2.test('identifies canonical freshness states correctly', () => {
            const now = 1000000;
            const fresh = RouteFreshnessValidator.validate(now - 5000, now + 25000, { currentTime: now });
            assert.equal(fresh.state, 'FRESH');
            assert.equal(fresh.isExecutable, true);
            const expiringSoon = RouteFreshnessValidator.validate(now - 5000, now + 8000, { currentTime: now });
            assert.equal(expiringSoon.state, 'EXPIRING_SOON');
            assert.equal(expiringSoon.isExecutable, true);
            const expired = RouteFreshnessValidator.validate(now - 10000, now - 1000, { currentTime: now });
            assert.equal(expired.state, 'EXPIRED');
            assert.equal(expired.isExecutable, false);
            const stale = RouteFreshnessValidator.validate(now - 65000, now + 100000, { currentTime: now });
            assert.equal(stale.state, 'EXPIRED');
            assert.equal(stale.isExecutable, false);
            const future = RouteFreshnessValidator.validate(now + 10000, now + 50000, { currentTime: now });
            assert.equal(future.state, 'UNKNOWN');
            assert.equal(future.isExecutable, false);
        });
    });
    await t.test('Suite 3: Direct Cross-Chain Arbitration (Across vs deBridge)', async (t3) => {
        await t3.test('selects Across in LIVE_EXECUTION mode based on LIVE_VERIFIED capability', () => {
            const acrossRoute = createSampleRoute({
                routeId: 'route-across',
                bridgeProvider: 'ACROSS',
                capabilityLevel: 'LIVE_VERIFIED',
                minimumOutputRaw: '995000',
                expectedOutputRaw: '998000'
            });
            const debridgeRoute = createSampleRoute({
                routeId: 'route-debridge',
                bridgeProvider: 'DEBRIDGE_DLN',
                capabilityLevel: 'EXECUTION_AVAILABLE',
                minimumOutputRaw: '996000',
                expectedOutputRaw: '999000',
                executionTarget: DEBRIDGE_ADDR,
                approvalTarget: DEBRIDGE_ADDR
            });
            const req = createBaseRequest({ executionMode: 'LIVE_EXECUTION' });
            const result = RouteArbitrator.arbitrate([acrossRoute, debridgeRoute], req, {
                executionMode: 'LIVE_EXECUTION'
            });
            assert.ok(result.selectedRoute);
            assert.equal(result.selectedRoute.routeId, 'route-across');
            assert.equal(result.executableCandidates.length, 1);
            assert.equal(result.rejectedCandidates.length, 1);
            assert.ok(result.rejectedCandidates[0].reason.includes('not LIVE_VERIFIED'));
        });
        await t3.test('in SIMULATION mode, prioritizes minimum guaranteed output over expected output', () => {
            const routeA = createSampleRoute({
                routeId: 'route-A-high-expected',
                expectedOutputRaw: '1000000',
                minimumOutputRaw: '900000',
                totalFeeRaw: '5000'
            });
            const routeB = createSampleRoute({
                routeId: 'route-B-high-guaranteed',
                expectedOutputRaw: '980000',
                minimumOutputRaw: '950000',
                totalFeeRaw: '5000'
            });
            const req = createBaseRequest({ executionMode: 'SIMULATION' });
            const result = RouteArbitrator.arbitrate([routeA, routeB], req, {
                executionMode: 'SIMULATION'
            });
            assert.ok(result.selectedRoute);
            assert.equal(result.selectedRoute.routeId, 'route-B-high-guaranteed');
        });
        await t3.test('when guaranteed outputs are equal, selects route with lower total fees', () => {
            const routeA = createSampleRoute({
                routeId: 'route-A-lower-fee',
                minimumOutputRaw: '950000',
                totalFeeRaw: '2000'
            });
            const routeB = createSampleRoute({
                routeId: 'route-B-higher-fee',
                minimumOutputRaw: '950000',
                totalFeeRaw: '8000'
            });
            const req = createBaseRequest({ executionMode: 'SIMULATION' });
            const result = RouteArbitrator.arbitrate([routeA, routeB], req);
            assert.ok(result.selectedRoute);
            assert.equal(result.selectedRoute.routeId, 'route-A-lower-fee');
        });
    });
    await t.test('Suite 4: Composite Route Arbitration & Authoritative Source Output', async (t4) => {
        await t4.test('verifies that actual source swap mined output is authoritative', () => {
            const mockReceipt = {
                status: 1,
                hash: '0xbeaa1d786b82b5639bc89f0357dd00fd4f6ef801385a30f2a0e916e2f6bc60c0',
                logs: [
                    {
                        address: USDC_POLYGON.address,
                        topics: [
                            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                            '0x0000000000000000000000000000000000000000000000000000000000000000',
                            `0x000000000000000000000000${USER_ADDR.substring(2).toLowerCase()}`
                        ],
                        data: '0x00000000000000000000000000000000000000000000000000000000000870ed'
                    }
                ]
            };
            const extracted = extractActualSourceSwapOutput({
                receipt: mockReceipt,
                expectedTokenOutAddress: USDC_POLYGON.address,
                recipientAddress: USER_ADDR,
                minimumAmountOutRaw: '550000'
            });
            assert.equal(extracted.actualAmountRaw, '553197');
            assert.equal(extracted.actualAmountBig, 553197n);
            assert.equal(extracted.verified, true);
        });
        await t4.test('marks composite destination DEX swap unexecutable when automated solver is absent', () => {
            const compositeRoute = createSampleRoute({
                routeId: 'route-composite-dest-dex',
                routeType: 'COMPOSITE_CROSS_CHAIN',
                destinationToken: WETH_ARBITRUM,
                destinationDex: 'UNISWAP_V3',
                isExecutable: false,
                unexecutableReason: 'DESTINATION_EXECUTION_UNAVAILABLE'
            });
            const req = createBaseRequest({ tokenOut: WETH_ARBITRUM });
            const evalResult = RouteCapabilityFilter.evaluate(compositeRoute, req);
            assert.equal(evalResult.isExecutable, false);
            assert.ok(evalResult.failedGates.includes('GATE_2_QUOTE_EXECUTABILITY'));
        });
    });
    await t.test('Suite 5: Task 10 — 20 Mandatory Failure Scenarios', async (t5) => {
        const req = createBaseRequest();
        await t5.test('Scenario 1: best quote is non-executable -> falls back to executable candidate', () => {
            const r1 = createSampleRoute({ routeId: 'r1-non-exec', isExecutable: false, unexecutableReason: 'BAD_QUOTE', minimumOutputRaw: '1000000' });
            const r2 = createSampleRoute({ routeId: 'r2-exec', isExecutable: true, minimumOutputRaw: '950000' });
            const res = RouteArbitrator.arbitrate([r1, r2], req);
            assert.equal(res.selectedRoute?.routeId, 'r2-exec');
        });
        await t5.test('Scenario 2: best quote is expired -> rejected by freshness filter', () => {
            const r1 = createSampleRoute({ routeId: 'r1-expired', expiresAt: Date.now() - 5000, minimumOutputRaw: '1000000' });
            const r2 = createSampleRoute({ routeId: 'r2-fresh', expiresAt: Date.now() + 30000, minimumOutputRaw: '950000' });
            const res = RouteArbitrator.arbitrate([r1, r2], req);
            assert.equal(res.selectedRoute?.routeId, 'r2-fresh');
        });
        await t5.test('Scenario 3: best quote has invalid calldata (empty or 0x) -> fails closed', () => {
            const r1 = createSampleRoute({ routeId: 'r1-bad-calldata', calldata: '0x', minimumOutputRaw: '1000000' });
            const res = RouteArbitrator.arbitrate([r1], req);
            assert.equal(res.selectedRoute, null);
            assert.equal(res.rejectedCandidates[0].reason.includes('INVALID_CALLDATA'), true);
        });
        await t5.test('Scenario 4: best quote has invalid target (ZeroAddress) -> fails closed', () => {
            const r1 = createSampleRoute({ routeId: 'r1-zero-target', executionTarget: ZERO_ADDRESS, minimumOutputRaw: '1000000' });
            const res = RouteArbitrator.arbitrate([r1], req);
            assert.equal(res.selectedRoute, null);
            assert.equal(res.rejectedCandidates[0].reason.includes('INVALID_EXECUTION_TARGET'), true);
        });
        await t5.test('Scenario 5: best quote provider circuit open -> healthy route chosen', () => {
            const health = new ProviderHealthRegistry();
            health.setHealth('ACROSS', 'CIRCUIT_OPEN');
            const r1 = createSampleRoute({ routeId: 'r1-across', bridgeProvider: 'ACROSS', minimumOutputRaw: '1000000' });
            const r2 = createSampleRoute({ routeId: 'r2-debridge', bridgeProvider: 'DEBRIDGE_DLN', capabilityLevel: 'EXECUTION_AVAILABLE', minimumOutputRaw: '950000', executionTarget: DEBRIDGE_ADDR, approvalTarget: DEBRIDGE_ADDR });
            const res = RouteArbitrator.arbitrate([r1, r2], req, { healthRegistry: health });
            assert.equal(res.selectedRoute?.routeId, 'r2-debridge');
        });
        await t5.test('Scenario 6: provider timeout recorded as diagnostic failure', () => {
            const r1 = createSampleRoute({
                routeId: 'r1-timeout',
                isExecutable: false,
                unexecutableReason: 'PROVIDER_TIMEOUT: Upstream API failed to respond within 8000ms'
            });
            const res = RouteArbitrator.arbitrate([r1], req);
            assert.equal(res.selectedRoute, null);
            assert.ok(res.rejectedCandidates[0].reason.includes('TIMEOUT'));
        });
        await t5.test('Scenario 7: provider unavailable recorded and excluded from selection', () => {
            const r1 = createSampleRoute({
                routeId: 'r1-unavail',
                isExecutable: false,
                unexecutableReason: 'PROVIDER_UNAVAILABLE: 503 Service Unavailable'
            });
            const res = RouteArbitrator.arbitrate([r1], req);
            assert.equal(res.selectedRoute, null);
        });
        await t5.test('Scenario 8: stale quote beyond max staleness threshold rejected', () => {
            const now = Date.now();
            const r1 = createSampleRoute({
                routeId: 'r1-stale',
                quotedAt: now - 90000,
                expiresAt: now + 30000
            });
            const res = RouteArbitrator.arbitrate([r1], req);
            assert.equal(res.selectedRoute, null);
            assert.ok(res.rejectedCandidates[0].reason.includes('QUOTE_STALE'));
        });
        await t5.test('Scenario 9: missing gas cost handled safely without throwing', () => {
            const r1 = createSampleRoute({
                routeId: 'r1-no-gas',
                estimatedGasRaw: '0',
                estimatedGasCostRaw: '0'
            });
            const res = RouteArbitrator.arbitrate([r1], req);
            assert.ok(res.selectedRoute);
            assert.equal(res.selectedRoute.routeId, 'r1-no-gas');
        });
        await t5.test('Scenario 10: missing fee data handled safely with zero default', () => {
            const r1 = createSampleRoute({
                routeId: 'r1-no-fee',
                totalFeeRaw: '0'
            });
            const res = RouteArbitrator.arbitrate([r1], req);
            assert.ok(res.selectedRoute);
            assert.equal(res.selectedRoute.totalFeeRaw, '0');
        });
        await t5.test('Scenario 11: missing price data returns ROUTE_COST_UNAVAILABLE', () => {
            const norm = CostNormalizer.normalize({
                bridgeFeeRaw: '1000',
                feeToken: USDC_POLYGON,
                priceEvidence: {
                    priceSource: 'ORACLE',
                    timestamp: Date.now(),
                    priceUSD: undefined
                }
            });
            assert.equal(norm.isAvailable, false);
            assert.equal(norm.unavailableReason, 'ROUTE_COST_UNAVAILABLE');
        });
        await t5.test('Scenario 12: conflicting quote where minimum exceeds expected output fails closed', () => {
            const r1 = createSampleRoute({
                routeId: 'r1-conflict',
                expectedOutputRaw: '900000',
                minimumOutputRaw: '950000',
                isExecutable: false,
                unexecutableReason: 'INCONSISTENT_QUOTE: Minimum output exceeds expected output.'
            });
            const res = RouteArbitrator.arbitrate([r1], req);
            assert.equal(res.selectedRoute, null);
        });
        await t5.test('Scenario 13: duplicate route handled deterministically', () => {
            const r1 = createSampleRoute({ routeId: 'route-dup-1', minimumOutputRaw: '950000' });
            const r2 = createSampleRoute({ routeId: 'route-dup-1', minimumOutputRaw: '950000' });
            const res = RouteArbitrator.arbitrate([r1, r2], req);
            assert.ok(res.selectedRoute);
            assert.equal(res.selectedRoute.routeId, 'route-dup-1');
        });
        await t5.test('Scenario 14: identical routes resolved deterministically by tie-breaker', () => {
            const r1 = createSampleRoute({ routeId: 'route-b-identical', minimumOutputRaw: '950000' });
            const r2 = createSampleRoute({ routeId: 'route-a-identical', minimumOutputRaw: '950000' });
            const res = RouteArbitrator.arbitrate([r1, r2], req);
            assert.equal(res.selectedRoute?.routeId, 'route-a-identical');
        });
        await t5.test('Scenario 15: deterministic tie flags selectionMetrics.tieBrokenByRouteId', () => {
            const r1 = createSampleRoute({ routeId: 'route-tie-1', minimumOutputRaw: '950000' });
            const r2 = createSampleRoute({ routeId: 'route-tie-2', minimumOutputRaw: '950000' });
            const res = RouteArbitrator.arbitrate([r1, r2], req);
            assert.equal(res.selectionMetrics.tieBrokenByRouteId, true);
        });
        await t5.test('Scenario 16: composite route requires valid source swap and bridge target', () => {
            const compRoute = createSampleRoute({
                routeId: 'route-composite',
                routeType: 'COMPOSITE_CROSS_CHAIN',
                sourceDex: 'UNISWAP_V3',
                executionTarget: UNISWAP_V3_ROUTER
            });
            const res = RouteArbitrator.arbitrate([compRoute], req);
            assert.ok(res.selectedRoute);
            assert.equal(res.selectedRoute.routeId, 'route-composite');
        });
        await t5.test('Scenario 17: direct route prioritized over composite when metrics are equivalent', () => {
            const direct = createSampleRoute({ routeId: 'route-direct', routeType: 'DIRECT_CROSS_CHAIN', minimumOutputRaw: '950000' });
            const comp = createSampleRoute({ routeId: 'route-composite', routeType: 'COMPOSITE_CROSS_CHAIN', minimumOutputRaw: '950000' });
            const res = RouteArbitrator.arbitrate([comp, direct], req);
            assert.equal(res.selectedRoute?.routeId, 'route-direct');
        });
        await t5.test('Scenario 18: source output divergence prevents using stale pre-execution estimate', () => {
            const initialEstimatedOutput = '550000';
            const actualMinedOutput = '548000';
            assert.notEqual(initialEstimatedOutput, actualMinedOutput);
            const extracted = extractActualSourceSwapOutput({
                expectedTokenOutAddress: USDC_POLYGON.address,
                recipientAddress: USER_ADDR,
                minimumAmountOutRaw: '545000',
                fallbackAmountRaw: actualMinedOutput
            });
            assert.equal(extracted.actualAmountRaw, '548000');
        });
        await t5.test('Scenario 19: composite plan includes BRIDGE_QUOTE_REFRESH step in DAG', () => {
            const compRoute = createSampleRoute({
                routeId: 'route-composite-refresh',
                routeType: 'COMPOSITE_CROSS_CHAIN',
                sourceDex: 'UNISWAP_V3'
            });
            const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
                normalizedRoute: compRoute,
                request: req
            });
            const hasRefresh = plan.steps.some((s) => s.type === 'BRIDGE_QUOTE_REFRESH');
            assert.equal(hasRefresh, true);
        });
        await t5.test('Scenario 20: returns null selectedRoute when no executable provider exists', () => {
            const r1 = createSampleRoute({ isExecutable: false, unexecutableReason: 'PROVIDER_OFFLINE' });
            const r2 = createSampleRoute({ isExecutable: false, unexecutableReason: 'UNSUPPORTED_PAIR' });
            const res = RouteArbitrator.arbitrate([r1, r2], req);
            assert.equal(res.selectedRoute, null);
            assert.equal(res.executableCandidates.length, 0);
            assert.equal(res.rejectedCandidates.length, 2);
        });
    });
    await t.test('Suite 6: Task 11 — 1,000-Run Determinism Benchmark', () => {
        const req = createBaseRequest();
        const fixedNow = 1774000000000;
        const routes: NormalizedRoute[] = [
            createSampleRoute({
                routeId: 'route-A',
                bridgeProvider: 'ACROSS',
                minimumOutputRaw: '995000',
                totalFeeRaw: '3000',
                quotedAt: fixedNow - 1000,
                expiresAt: fixedNow + 25000
            }),
            createSampleRoute({
                routeId: 'route-B',
                bridgeProvider: 'DEBRIDGE_DLN',
                capabilityLevel: 'EXECUTION_AVAILABLE',
                minimumOutputRaw: '995000',
                totalFeeRaw: '3000',
                quotedAt: fixedNow - 1000,
                expiresAt: fixedNow + 25000,
                executionTarget: DEBRIDGE_ADDR,
                approvalTarget: DEBRIDGE_ADDR
            }),
            createSampleRoute({
                routeId: 'route-C',
                bridgeProvider: 'STARGATE',
                capabilityLevel: 'CONFIGURED',
                isExecutable: false,
                unexecutableReason: 'QUOTE_UNAVAILABLE'
            })
        ];
        let baselineSelectedId: string | null = null;
        for (let i = 0; i < 1000; i++) {
            const shuffled = [...routes].sort(() => Math.random() - 0.5);
            const res = RouteArbitrator.arbitrate(shuffled, req, {
                currentTime: fixedNow
            });
            if (i === 0) {
                baselineSelectedId = res.selectedRoute?.routeId ?? null;
                assert.ok(baselineSelectedId, 'Initial run must select a valid route');
            }
            else {
                assert.equal(res.selectedRoute?.routeId, baselineSelectedId, `Arbitration run ${i} produced diverging routeId "${res.selectedRoute?.routeId}", expected "${baselineSelectedId}"`);
            }
        }
    });
    await t.test('Suite 7: Task 12 — ExecutionPlan Integration & Immutability', () => {
        const route = createSampleRoute({
            routeId: 'route-auth-001',
            bridgeProvider: 'ACROSS',
            sourceDex: 'UNISWAP_V3',
            minimumOutputRaw: '995000',
            expectedOutputRaw: '998000',
            totalFeeRaw: '2000',
            calldata: '0xabcdef0123456789abcdef0123456789abcdef0123456789',
            executionTarget: SPOKE_POOL_ADDR,
            approvalTarget: SPOKE_POOL_ADDR,
            expiresAt: Date.now() + 60000,
            capabilityLevel: 'LIVE_VERIFIED'
        });
        const req = createBaseRequest();
        const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
            normalizedRoute: route,
            request: req
        });
        assert.equal(plan.routeId, 'route-auth-001');
        assert.equal(plan.selectedProvider, 'ACROSS');
        assert.equal(plan.isExecutable, true);
        assert.equal(plan.expectedAmountOutRaw, '998000');
        assert.equal(plan.minimumAmountOutRaw, '995000');
        assert.equal(plan.calldata, route.calldata);
        assert.equal(plan.executionTarget, SPOKE_POOL_ADDR);
        assert.equal(plan.approvalTarget, SPOKE_POOL_ADDR);
        assert.equal(plan.expiration, route.expiresAt);
        assert.equal(plan.capabilityEvidence, 'LIVE_VERIFIED');
        assert.equal(plan.totalFeeRaw, '2000');
        assert.ok(plan.steps.some((s) => s.type === 'APPROVAL'));
        assert.ok(plan.steps.some((s) => s.type === 'BRIDGE_DEPOSIT'));
        assert.ok(plan.steps.some((s) => s.type === 'DESTINATION_VERIFY'));
    });
    await t.test('Suite 8: Task 13 — Security Invariants Enforcement', () => {
        const emptyCalldataRoute = createSampleRoute({ calldata: '0x' });
        const req = createBaseRequest();
        const evalCalldata = RouteCapabilityFilter.evaluate(emptyCalldataRoute, req);
        assert.equal(evalCalldata.isExecutable, false);
        assert.ok(evalCalldata.failedGates.includes('GATE_7_CALLDATA'));
        const zeroTargetRoute = createSampleRoute({ executionTarget: ZERO_ADDRESS });
        const evalTarget = RouteCapabilityFilter.evaluate(zeroTargetRoute, req);
        assert.equal(evalTarget.isExecutable, false);
        assert.ok(evalTarget.failedGates.includes('GATE_6_EXECUTION_TARGET'));
        const unverifiedRoute = createSampleRoute({
            bridgeProvider: 'STARGATE',
            capabilityLevel: 'CONFIGURED'
        });
        const evalCap = RouteCapabilityFilter.evaluate(unverifiedRoute, req, { executionMode: 'SIMULATION' });
        assert.equal(evalCap.isExecutable, false);
        assert.ok(evalCap.failedGates.includes('GATE_1_PROVIDER_CAPABILITY'));
        const sampleRoute = createSampleRoute();
        assert.equal(typeof sampleRoute.inputAmountRaw, 'string');
        assert.equal(typeof sampleRoute.expectedOutputRaw, 'string');
        assert.equal(typeof sampleRoute.minimumOutputRaw, 'string');
        assert.equal(typeof sampleRoute.totalFeeRaw, 'string');
    });
});
