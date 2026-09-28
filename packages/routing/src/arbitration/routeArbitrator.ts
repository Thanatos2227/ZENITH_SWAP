import { NormalizedRoute, QuoteRequest, RouteArbitrationResult } from '@zenith/types';
import { RouteCapabilityFilter, RouteFilterOptions } from './routeCapabilityFilter';
import { CrossChainProviderCapabilityMatrix } from '../crosschain/crossChainProviderCapabilityMatrix';
import { defaultProviderHealthRegistry } from './providerHealthRegistry';
import { defaultRouteSelectionTelemetry } from './routeSelectionTelemetry';
export interface RouteArbitrationOptions extends RouteFilterOptions {
    requireExecutableOnly?: boolean;
}
export class RouteArbitrator {
    private static selectionCounter: number = 1000;
    public static arbitrate(routes: NormalizedRoute[], request: QuoteRequest, options?: RouteArbitrationOptions): RouteArbitrationResult {
        const startMs = Date.now();
        const healthRegistry = options?.healthRegistry ?? defaultProviderHealthRegistry;
        const executableCandidates: NormalizedRoute[] = [];
        const rejectedCandidates: Array<{
            route: NormalizedRoute;
            reason: string;
        }> = [];
        for (const route of routes) {
            const evalResult = RouteCapabilityFilter.evaluate(route, request, options);
            if (evalResult.isExecutable) {
                executableCandidates.push(route);
            }
            else {
                rejectedCandidates.push({
                    route,
                    reason: evalResult.unexecutableReason || 'REJECTED_BY_CAPABILITY_FILTER'
                });
            }
        }
        if (executableCandidates.length === 0) {
            try {
                const seq = RouteArbitrator.selectionCounter++;
                defaultRouteSelectionTelemetry.record({
                    routeSelectionId: `sel-${request.sourceChainId}-${request.destinationChainId}-${Date.now()}-${seq}`,
                    requestId: (request as any).requestId || `req-${Date.now()}`,
                    candidateCount: routes.length,
                    eligibleCandidateCount: 0,
                    rejectedCandidateCount: rejectedCandidates.length,
                    rejectionReasons: rejectedCandidates.map((c) => c.reason),
                    selectedRouteId: null,
                    selectedProvider: null,
                    selectedDex: null,
                    selectedCapability: null,
                    selectedMinimumOutputRaw: null,
                    selectedTotalFeeRaw: null,
                    selectionTimestamp: Date.now(),
                    freshnessState: 'REJECTED',
                    providerHealthState: 'UNKNOWN'
                });
            }
            catch {
            }
            return {
                selectedRoute: null,
                executableCandidates: [],
                rejectedCandidates,
                selectionMetrics: {
                    totalEvaluated: routes.length,
                    totalExecutable: 0,
                    arbitrationDurationMs: Date.now() - startMs,
                    tieBrokenByRouteId: false
                }
            };
        }
        let tieBrokenByRouteId = false;
        executableCandidates.sort((a, b) => {
            const rankA = CrossChainProviderCapabilityMatrix.getCapabilityRank(a.capabilityLevel);
            const rankB = CrossChainProviderCapabilityMatrix.getCapabilityRank(b.capabilityLevel);
            if (rankA !== rankB) {
                return rankB - rankA;
            }
            const freshScoreA = a.freshnessState === 'FRESH' ? 2 : a.freshnessState === 'EXPIRING_SOON' ? 1 : 0;
            const freshScoreB = b.freshnessState === 'FRESH' ? 2 : b.freshnessState === 'EXPIRING_SOON' ? 1 : 0;
            if (freshScoreA !== freshScoreB) {
                return freshScoreB - freshScoreA;
            }
            const minOutA = BigInt(a.minimumOutputRaw || '0');
            const minOutB = BigInt(b.minimumOutputRaw || '0');
            if (minOutA !== minOutB) {
                return minOutB > minOutA ? 1 : -1;
            }
            const totalCostA = BigInt(a.totalFeeRaw || '0') + BigInt(a.estimatedGasCostRaw || '0');
            const totalCostB = BigInt(b.totalFeeRaw || '0') + BigInt(b.estimatedGasCostRaw || '0');
            if (totalCostA !== totalCostB) {
                return totalCostA > totalCostB ? 1 : -1;
            }
            const gasA = BigInt(a.estimatedGasCostRaw || a.estimatedGasRaw || '0');
            const gasB = BigInt(b.estimatedGasCostRaw || b.estimatedGasRaw || '0');
            if (gasA !== gasB) {
                return gasA > gasB ? 1 : -1;
            }
            const feeA = BigInt(a.totalFeeRaw || '0');
            const feeB = BigInt(b.totalFeeRaw || '0');
            if (feeA !== feeB) {
                return feeA > feeB ? 1 : -1;
            }
            const spreadA = BigInt(a.expectedOutputRaw || '0') - BigInt(a.minimumOutputRaw || '0');
            const spreadB = BigInt(b.expectedOutputRaw || '0') - BigInt(b.minimumOutputRaw || '0');
            if (spreadA !== spreadB) {
                return spreadA > spreadB ? 1 : -1;
            }
            const complexity = (r: NormalizedRoute): number => {
                if (r.routeType === 'SAME_CHAIN')
                    return 1;
                if (r.routeType === 'DIRECT_CROSS_CHAIN')
                    return 2;
                return 3;
            };
            const compA = complexity(a);
            const compB = complexity(b);
            if (compA !== compB) {
                return compA - compB;
            }
            const provA = a.bridgeProvider ? String(a.bridgeProvider) : 'DEX';
            const provB = b.bridgeProvider ? String(b.bridgeProvider) : 'DEX';
            const penaltyA = healthRegistry.getArbitrationPenalty(provA);
            const penaltyB = healthRegistry.getArbitrationPenalty(provB);
            if (penaltyA !== penaltyB) {
                return penaltyA > penaltyB ? 1 : -1;
            }
            tieBrokenByRouteId = true;
            return a.routeId.localeCompare(b.routeId);
        });
        const selectedRoute = executableCandidates[0] || null;
        try {
            const selectedProv = selectedRoute?.bridgeProvider ? String(selectedRoute.bridgeProvider) : selectedRoute?.sourceDex || null;
            const provHealth = selectedProv ? healthRegistry.getHealth(selectedProv) : 'HEALTHY';
            const seq = RouteArbitrator.selectionCounter++;
            defaultRouteSelectionTelemetry.record({
                routeSelectionId: `sel-${request.sourceChainId}-${request.destinationChainId}-${Date.now()}-${seq}`,
                requestId: (request as any).requestId || `req-${Date.now()}`,
                candidateCount: routes.length,
                eligibleCandidateCount: executableCandidates.length,
                rejectedCandidateCount: rejectedCandidates.length,
                rejectionReasons: rejectedCandidates.map((c) => c.reason),
                selectedRouteId: selectedRoute?.routeId || null,
                selectedProvider: selectedRoute?.bridgeProvider ? String(selectedRoute.bridgeProvider) : null,
                selectedDex: selectedRoute?.sourceDex || selectedRoute?.destinationDex || null,
                selectedCapability: selectedRoute?.capabilityLevel || null,
                selectedMinimumOutputRaw: selectedRoute?.minimumOutputRaw || null,
                selectedTotalFeeRaw: selectedRoute?.totalFeeRaw || null,
                selectionTimestamp: Date.now(),
                freshnessState: selectedRoute?.freshnessState || 'FRESH',
                providerHealthState: provHealth
            });
        }
        catch {
        }
        return {
            selectedRoute,
            executableCandidates,
            rejectedCandidates,
            selectionMetrics: {
                totalEvaluated: routes.length,
                totalExecutable: executableCandidates.length,
                arbitrationDurationMs: Date.now() - startMs,
                tieBrokenByRouteId
            }
        };
    }
}
