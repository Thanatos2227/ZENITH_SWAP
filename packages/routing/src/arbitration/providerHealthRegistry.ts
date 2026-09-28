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
    public setHealth(providerId: string, status: ProviderHealthStatus, reason?: string): void {
        const key = providerId.toUpperCase();
        const existing = this.healthMap.get(key);
        const consecutiveFailures = status === 'UNHEALTHY' || status === 'CIRCUIT_OPEN'
            ? (existing?.consecutiveFailures ?? 0) + 1
            : 0;
        const consecutiveSuccesses = status === 'HEALTHY' ? (existing?.consecutiveSuccesses ?? 0) + 1 : 0;
        this.healthMap.set(key, {
            providerId: key,
            status,
            lastChangedAt: Date.now(),
            reason,
            consecutiveFailures,
            consecutiveSuccesses
        });
    }
    public getHealth(providerId: string): ProviderHealthStatus {
        const key = providerId.toUpperCase();
        const rec = this.healthMap.get(key);
        return rec?.status ?? 'HEALTHY';
    }
    public getRecord(providerId: string): ProviderHealthRecord | undefined {
        return this.healthMap.get(providerId.toUpperCase());
    }
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
            reason: status === 'DEGRADED'
                ? `PROVIDER_DEGRADED: Provider ${providerId} is DEGRADED. Permitted with reduced priority.`
                : status === 'RECOVERING'
                    ? `PROVIDER_RECOVERING: Provider ${providerId} is RECOVERING. Permitted with caution.`
                    : undefined
        };
    }
    public getArbitrationPenalty(providerId: string): bigint {
        const status = this.getHealth(providerId);
        switch (status) {
            case 'HEALTHY':
                return 0n;
            case 'RECOVERING':
                return 500n;
            case 'DEGRADED':
                return 1000n;
            case 'UNHEALTHY':
            case 'CIRCUIT_OPEN':
                return 999999999n;
            default:
                return 0n;
        }
    }
    public reset(): void {
        this.healthMap.clear();
    }
}
export const defaultProviderHealthRegistry = new ProviderHealthRegistry();
