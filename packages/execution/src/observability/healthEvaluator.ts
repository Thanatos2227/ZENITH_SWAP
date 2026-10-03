import { HealthStatus, ComponentHealth, SystemHealthReport } from '@zenith/types';
import { MultiProviderRpcManager, defaultMultiProviderRpcManager } from '@zenith/chains';
import { CircuitBreakerMonitor } from '@zenith/security';

export interface HealthEvaluatorDependencies {
    rpcManager?: MultiProviderRpcManager;
    circuitBreaker?: CircuitBreakerMonitor;
    persistenceCheck?: () => Promise<boolean> | boolean;
    version?: string;
}

export class HealthEvaluator {
    private startTime: number = Date.now();
    private version: string;

    constructor(version: string = '4.0.0') {
        this.version = version;
    }

    public getLiveness(): { status: 'HEALTHY'; uptimeSeconds: number; timestamp: number } {
        return {
            status: 'HEALTHY',
            uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
            timestamp: Date.now()
        };
    }

    private mergeStatus(current: HealthStatus, next: HealthStatus): HealthStatus {
        if (current === 'UNAVAILABLE' || next === 'UNAVAILABLE') return 'UNAVAILABLE';
        if (current === 'DEGRADED' || next === 'DEGRADED') return 'DEGRADED';
        return 'HEALTHY';
    }

    public async getReadiness(deps?: HealthEvaluatorDependencies): Promise<SystemHealthReport> {
        const now = Date.now();
        const rpcManager = deps?.rpcManager ?? defaultMultiProviderRpcManager;
        const version = deps?.version ?? this.version;

        const components: Record<string, ComponentHealth> = {};
        let overallStatus: HealthStatus = 'HEALTHY';

        // 1. Evaluate RPC Infrastructure Health
        try {
            const allEndpoints = rpcManager.getEndpoints('all');
            const endpoints = allEndpoints.length > 0 ? allEndpoints : rpcManager.getEndpoints('polygon');
            
            if (endpoints.length === 0) {
                components['rpc_providers'] = {
                    name: 'rpc_providers',
                    status: 'DEGRADED',
                    message: 'No RPC endpoints currently registered in MultiProviderRpcManager',
                    lastCheckedAt: now
                };
                overallStatus = this.mergeStatus(overallStatus, 'DEGRADED');
            } else {
                const healthyCount = endpoints.filter((e) => e.status === 'HEALTHY' || e.circuitState === 'CLOSED').length;
                const degradedCount = endpoints.filter((e) => e.status === 'DEGRADED' || e.circuitState === 'HALF_OPEN').length;
                const openCount = endpoints.filter((e) => e.circuitState === 'OPEN').length;

                let rpcStatus: HealthStatus = 'HEALTHY';
                if (healthyCount === 0 && degradedCount === 0) {
                    rpcStatus = 'UNAVAILABLE';
                } else if (openCount > 0 || degradedCount > 0) {
                    rpcStatus = 'DEGRADED';
                }

                components['rpc_providers'] = {
                    name: 'rpc_providers',
                    status: rpcStatus,
                    message: `${healthyCount} healthy, ${degradedCount} degraded, ${openCount} circuit open of ${endpoints.length} total endpoints`,
                    lastCheckedAt: now,
                    details: {
                        total: endpoints.length,
                        healthy: healthyCount,
                        degraded: degradedCount,
                        circuitOpen: openCount
                    }
                };

                overallStatus = this.mergeStatus(overallStatus, rpcStatus);
            }
        } catch (err: any) {
            components['rpc_providers'] = {
                name: 'rpc_providers',
                status: 'DEGRADED',
                message: `Failed to inspect RPC endpoints: ${err?.message || 'Unknown error'}`,
                lastCheckedAt: now
            };
            overallStatus = this.mergeStatus(overallStatus, 'DEGRADED');
        }

        // 2. Evaluate Circuit Breaker State
        try {
            if (deps?.circuitBreaker) {
                const cbState = deps.circuitBreaker.getState();
                let cbStatus: HealthStatus = 'HEALTHY';
                let cbMsg = 'Circuit breaker normal (CLOSED)';

                if (cbState.isEmergencyPaused) {
                    cbStatus = 'UNAVAILABLE';
                    cbMsg = `Emergency pause active: ${cbState.pauseReason || 'Manual intervention'}`;
                } else if (cbState.pausedChains.length > 0) {
                    cbStatus = 'DEGRADED';
                    cbMsg = `Paused chains: ${cbState.pausedChains.join(', ')}`;
                }

                components['circuit_breaker'] = {
                    name: 'circuit_breaker',
                    status: cbStatus,
                    message: cbMsg,
                    lastCheckedAt: now,
                    details: cbState
                };

                overallStatus = this.mergeStatus(overallStatus, cbStatus);
            }
        } catch (err: any) {
            components['circuit_breaker'] = {
                name: 'circuit_breaker',
                status: 'DEGRADED',
                message: `Failed to inspect circuit breaker: ${err?.message || 'Unknown error'}`,
                lastCheckedAt: now
            };
            overallStatus = this.mergeStatus(overallStatus, 'DEGRADED');
        }

        // 3. Evaluate Persistence State
        if (deps?.persistenceCheck) {
            try {
                const isPersistenceReady = await Promise.resolve(deps.persistenceCheck());
                components['persistence'] = {
                    name: 'persistence',
                    status: isPersistenceReady ? 'HEALTHY' : 'UNAVAILABLE',
                    message: isPersistenceReady ? 'Persistence layer ready' : 'Persistence layer unavailable or read-only',
                    lastCheckedAt: now
                };
                if (!isPersistenceReady) {
                    overallStatus = 'UNAVAILABLE';
                }
            } catch (err: any) {
                components['persistence'] = {
                    name: 'persistence',
                    status: 'UNAVAILABLE',
                    message: `Persistence check error: ${err?.message || 'Unknown error'}`,
                    lastCheckedAt: now
                };
                overallStatus = 'UNAVAILABLE';
            }
        }

        return {
            status: overallStatus,
            uptimeSeconds: Math.floor((now - this.startTime) / 1000),
            timestamp: now,
            version,
            components
        };
    }
}

export const defaultHealthEvaluator = new HealthEvaluator();
