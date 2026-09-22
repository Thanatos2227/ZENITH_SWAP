import {
  NormalizedRoute,
  QuoteRequest,
  RouteArbitrationResult
} from '@zenith/types';
import { RouteCapabilityFilter, RouteFilterOptions } from './routeCapabilityFilter';
import { CrossChainProviderCapabilityMatrix } from '../crosschain/crossChainProviderCapabilityMatrix';
import { defaultProviderHealthRegistry } from './providerHealthRegistry';
import { defaultRouteSelectionTelemetry } from './routeSelectionTelemetry';

export interface RouteArbitrationOptions extends RouteFilterOptions {
  requireExecutableOnly?: boolean;
}

export class RouteArbitrator {
  private static selectionCounter: number = 1000;

  /**
   * Deterministically arbitrates and selects the best executable route among candidates.
   *
   * Security Invariants:
   * 1. Minimum guaranteed output (minimumOutputRaw) is the primary output metric, NOT expected output.
   * 2. Non-executable, stale, expired, or circuit-broken routes are strictly rejected.
   * 3. Zero floating-point arithmetic.
   * 4. 100% reproducible tie-breaking.
   */
  public static arbitrate(
    routes: NormalizedRoute[],
    request: QuoteRequest,
    options?: RouteArbitrationOptions
  ): RouteArbitrationResult {
    const startMs = Date.now();
    const healthRegistry = options?.healthRegistry ?? defaultProviderHealthRegistry;

    const executableCandidates: NormalizedRoute[] = [];
    const rejectedCandidates: Array<{ route: NormalizedRoute; reason: string }> = [];

    // Step 1: Pre-scoring 10-Gate Filter
    for (const route of routes) {
      const evalResult = RouteCapabilityFilter.evaluate(route, request, options);
      if (evalResult.isExecutable) {
        executableCandidates.push(route);
      } else {
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
      } catch {
        // Ignore telemetry errors
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

    // Step 2: 10-Tier Deterministic Comparator
    executableCandidates.sort((a, b) => {
      // 1. Executable Capability Rank (LIVE_VERIFIED > EXECUTION_AVAILABLE > ...)
      const rankA = CrossChainProviderCapabilityMatrix.getCapabilityRank(a.capabilityLevel);
      const rankB = CrossChainProviderCapabilityMatrix.getCapabilityRank(b.capabilityLevel);
      if (rankA !== rankB) {
        return rankB - rankA; // Higher rank wins
      }

      // 2. Quote Freshness (FRESH > EXPIRING_SOON)
      const freshScoreA = a.freshnessState === 'FRESH' ? 2 : a.freshnessState === 'EXPIRING_SOON' ? 1 : 0;
      const freshScoreB = b.freshnessState === 'FRESH' ? 2 : b.freshnessState === 'EXPIRING_SOON' ? 1 : 0;
      if (freshScoreA !== freshScoreB) {
        return freshScoreB - freshScoreA;
      }

      // 3. Minimum Guaranteed Output (primary user-protection quantity)
      const minOutA = BigInt(a.minimumOutputRaw || '0');
      const minOutB = BigInt(b.minimumOutputRaw || '0');
      if (minOutA !== minOutB) {
        return minOutB > minOutA ? 1 : -1; // Higher guaranteed output wins
      }

      // 4. Total User Cost (fees + gas)
      const totalCostA = BigInt(a.totalFeeRaw || '0') + BigInt(a.estimatedGasCostRaw || '0');
      const totalCostB = BigInt(b.totalFeeRaw || '0') + BigInt(b.estimatedGasCostRaw || '0');
      if (totalCostA !== totalCostB) {
        return totalCostA > totalCostB ? 1 : -1; // Lower cost wins
      }

      // 5. Gas Cost
      const gasA = BigInt(a.estimatedGasCostRaw || a.estimatedGasRaw || '0');
      const gasB = BigInt(b.estimatedGasCostRaw || b.estimatedGasRaw || '0');
      if (gasA !== gasB) {
        return gasA > gasB ? 1 : -1; // Lower gas wins
      }

      // 6. Bridge Fee
      const feeA = BigInt(a.totalFeeRaw || '0');
      const feeB = BigInt(b.totalFeeRaw || '0');
      if (feeA !== feeB) {
        return feeA > feeB ? 1 : -1; // Lower bridge fee wins
      }

      // 7. Slippage (spread between expected and guaranteed minimum)
      const spreadA = BigInt(a.expectedOutputRaw || '0') - BigInt(a.minimumOutputRaw || '0');
      const spreadB = BigInt(b.expectedOutputRaw || '0') - BigInt(b.minimumOutputRaw || '0');
      if (spreadA !== spreadB) {
        return spreadA > spreadB ? 1 : -1; // Lower spread/slippage wins
      }

      // 8. Route Complexity (SAME_CHAIN < DIRECT_CROSS_CHAIN < COMPOSITE_CROSS_CHAIN)
      const complexity = (r: NormalizedRoute): number => {
        if (r.routeType === 'SAME_CHAIN') return 1;
        if (r.routeType === 'DIRECT_CROSS_CHAIN') return 2;
        return 3;
      };
      const compA = complexity(a);
      const compB = complexity(b);
      if (compA !== compB) {
        return compA - compB; // Simpler route wins
      }

      // 9. Provider Health Penalty
      const provA = a.bridgeProvider ? String(a.bridgeProvider) : 'DEX';
      const provB = b.bridgeProvider ? String(b.bridgeProvider) : 'DEX';
      const penaltyA = healthRegistry.getArbitrationPenalty(provA);
      const penaltyB = healthRegistry.getArbitrationPenalty(provB);
      if (penaltyA !== penaltyB) {
        return penaltyA > penaltyB ? 1 : -1; // Lower penalty wins
      }

      // 10. Deterministic Provider / Route ID Tie-Breaker
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
    } catch {
      // Telemetry must not fail arbitration
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
