import { ProviderHealthStatus } from '@zenith/types';

export interface ProviderHealthRecord {
  providerId: string;
  status: ProviderHealthStatus;
  lastChangedAt: number;
  reason?: string;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export class ProviderHealthRegistry {
  private healthMap: Map<string, ProviderHealthRecord> = new Map();

  /**
   * Sets or updates the operational health of a provider.
   */
  public setHealth(
    providerId: string,
    status: ProviderHealthStatus,
    reason?: string
  ): void {
    const key = providerId.toUpperCase();
    const existing = this.healthMap.get(key);
    const consecutiveFailures =
      status === 'UNHEALTHY' || status === 'CIRCUIT_OPEN'
        ? (existing?.consecutiveFailures ?? 0) + 1
        : 0;
    const consecutiveSuccesses =
      status === 'HEALTHY' ? (existing?.consecutiveSuccesses ?? 0) + 1 : 0;

    this.healthMap.set(key, {
      providerId: key,
      status,
      lastChangedAt: Date.now(),
      reason,
      consecutiveFailures,
      consecutiveSuccesses
    });
  }

  /**
   * Retrieves the current health of a provider (defaults to HEALTHY if unrecorded).
   */
  public getHealth(providerId: string): ProviderHealthStatus {
    const key = providerId.toUpperCase();
    const rec = this.healthMap.get(key);
    return rec?.status ?? 'HEALTHY';
  }

  /**
   * Retrieves the detailed health record of a provider.
   */
  public getRecord(providerId: string): ProviderHealthRecord | undefined {
    return this.healthMap.get(providerId.toUpperCase());
  }

  /**
   * Evaluates if provider health permits execution.
   * Fail-closed: CIRCUIT_OPEN and UNHEALTHY are strictly prohibited from execution.
   */
  public isExecutionPermitted(providerId: string): {
    permitted: boolean;
    status: ProviderHealthStatus;
    reason?: string;
  } {
    const status = this.getHealth(providerId);

    if (status === 'CIRCUIT_OPEN') {
      return {
        permitted: false,
        status,
        reason: `PROVIDER_CIRCUIT_OPEN: Provider ${providerId} circuit breaker is OPEN. Execution halted.`
      };
    }

    if (status === 'UNHEALTHY') {
      return {
        permitted: false,
        status,
        reason: `PROVIDER_UNHEALTHY: Provider ${providerId} is reported UNHEALTHY. Execution prohibited.`
      };
    }

    return {
      permitted: true,
      status,
      reason:
        status === 'DEGRADED'
          ? `PROVIDER_DEGRADED: Provider ${providerId} is DEGRADED. Permitted with reduced priority.`
          : status === 'RECOVERING'
          ? `PROVIDER_RECOVERING: Provider ${providerId} is RECOVERING. Permitted with caution.`
          : undefined
    };
  }

  /**
   * Calculates a numeric rank penalty for arbitration.
   * Higher penalty deprioritizes the route.
   */
  public getArbitrationPenalty(providerId: string): bigint {
    const status = this.getHealth(providerId);
    switch (status) {
      case 'HEALTHY':
        return 0n;
      case 'RECOVERING':
        return 500n; // 500 BPS equivalent penalty
      case 'DEGRADED':
        return 1000n; // 1000 BPS equivalent penalty
      case 'UNHEALTHY':
      case 'CIRCUIT_OPEN':
        return 999999999n; // Near-infinite penalty (ineligible for execution)
      default:
        return 0n;
    }
  }

  /**
   * Resets all provider health states to default HEALTHY.
   */
  public reset(): void {
    this.healthMap.clear();
  }
}

export const defaultProviderHealthRegistry = new ProviderHealthRegistry();
