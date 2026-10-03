import { TelemetryEvent, CompositeTelemetryEvent, SystemHealthReport } from '@zenith/types';
import { PrometheusRegistry, defaultPrometheusRegistry } from './prometheusRegistry';
import { AlertManager, defaultAlertManager } from './alertManager';
import { HealthEvaluator, defaultHealthEvaluator } from './healthEvaluator';
import { OpenTelemetryAdapter, defaultOpenTelemetryAdapter } from './openTelemetryAdapter';
import { MultiProviderRpcManager } from '@zenith/chains';
import { CircuitBreakerMonitor } from '@zenith/security';

export class ZenithObservabilityEngine {
    public readonly registry: PrometheusRegistry;
    public readonly alertManager: AlertManager;
    public readonly healthEvaluator: HealthEvaluator;
    public readonly tracer: OpenTelemetryAdapter;

    constructor(options: {
        registry?: PrometheusRegistry;
        alertManager?: AlertManager;
        healthEvaluator?: HealthEvaluator;
        tracer?: OpenTelemetryAdapter;
    } = {}) {
        this.registry = options.registry ?? defaultPrometheusRegistry;
        this.alertManager = options.alertManager ?? defaultAlertManager;
        this.healthEvaluator = options.healthEvaluator ?? defaultHealthEvaluator;
        this.tracer = options.tracer ?? defaultOpenTelemetryAdapter;

        this.initMetrics();
    }

    private initMetrics(): void {
        try {
            // Execution Metrics
            this.registry.registerCounter('zenith_execution_total', 'Total execution attempts', ['stage', 'status', 'route_type']);
            this.registry.registerCounter('zenith_execution_success_total', 'Total successful trade executions', ['route_type', 'source_chain', 'destination_chain']);
            this.registry.registerCounter('zenith_execution_failure_total', 'Total failed trade executions', ['error_code', 'stage', 'source_chain']);
            this.registry.registerHistogram('zenith_execution_duration_seconds', 'Execution duration in seconds', ['route_type', 'status']);
            this.registry.registerGauge('zenith_execution_active', 'Currently active executions', ['route_type']);

            // Route Metrics
            this.registry.registerCounter('zenith_route_selection_total', 'Total route arbitration queries', ['source_chain', 'destination_chain', 'status']);
            this.registry.registerCounter('zenith_route_rejection_total', 'Total route candidate rejections', ['reason_code']);
            this.registry.registerHistogram('zenith_route_selection_duration_seconds', 'Route arbitration latency in seconds', ['source_chain', 'destination_chain']);

            // RPC Metrics
            this.registry.registerCounter('zenith_rpc_requests_total', 'Total RPC requests made', ['chain_id', 'provider_id', 'operation']);
            this.registry.registerCounter('zenith_rpc_errors_total', 'Total RPC errors encountered', ['chain_id', 'provider_id', 'error_category']);
            this.registry.registerCounter('zenith_rpc_failover_total', 'Total RPC provider failovers', ['chain_id']);
            this.registry.registerHistogram('zenith_rpc_latency_seconds', 'RPC call latency in seconds', ['chain_id', 'provider_id']);
            this.registry.registerGauge('zenith_rpc_provider_health', 'RPC provider health status (1=Healthy, 0.5=Degraded, 0=Unhealthy)', ['chain_id', 'provider_id']);

            // Bridge & Settlement Metrics
            this.registry.registerCounter('zenith_bridge_execution_total', 'Total cross-chain bridge deposits', ['bridge', 'source_chain', 'destination_chain']);
            this.registry.registerCounter('zenith_bridge_failure_total', 'Total bridge execution failures', ['bridge', 'error_code']);
            this.registry.registerCounter('zenith_settlement_total', 'Total settlement lifecycle events', ['source_chain', 'destination_chain', 'status']);
            this.registry.registerGauge('zenith_settlement_pending', 'Number of pending destination settlements', ['destination_chain']);
            this.registry.registerHistogram('zenith_settlement_duration_seconds', 'Time to destination finality in seconds', ['destination_chain', 'evidence_tier']);

            // Security & Circuit Breaker Metrics
            this.registry.registerGauge('zenith_circuit_breaker_state', 'Circuit breaker state (0=Closed/Normal, 1=EmergencyPaused, 0.5=ChainPaused)', ['state']);
            this.registry.registerCounter('zenith_risk_rejection_total', 'Total transactions rejected by risk checks', ['rule_code']);
            this.registry.registerCounter('zenith_signer_policy_rejection_total', 'Total signer operations rejected by KMS policy', ['reason_code']);
        } catch {
            // Fail-safe: Metric initialization must never throw
        }
    }

    public recordRpcEvent(event: TelemetryEvent): void {
        try {
            const chainId = String(event.chainId || 'unknown');
            const providerId = String(event.providerId || 'unknown');
            const operation = String(event.operation || 'eth_call');

            this.registry.incrementCounter('zenith_rpc_requests_total', {
                chain_id: chainId,
                provider_id: providerId,
                operation
            });

            if (!event.success) {
                const errorCategory = String(event.errorCategory || 'RETRYABLE');
                this.registry.incrementCounter('zenith_rpc_errors_total', {
                    chain_id: chainId,
                    provider_id: providerId,
                    error_category: errorCategory
                });
            }

            if (event.latencyMs > 0) {
                this.registry.recordHistogram('zenith_rpc_latency_seconds', event.latencyMs / 1000, {
                    chain_id: chainId,
                    provider_id: providerId
                });
            }

            if (event.failoverCount > 0) {
                this.registry.incrementCounter('zenith_rpc_failover_total', { chain_id: chainId }, event.failoverCount);
            }

            if (event.circuitState === 'OPEN') {
                this.registry.setGauge('zenith_rpc_provider_health', 0, {
                    chain_id: chainId,
                    provider_id: providerId
                });

                this.alertManager.triggerAlert({
                    category: 'RPC',
                    severity: 'WARNING',
                    source: 'MultiProviderRpcManager',
                    code: 'RPC_CIRCUIT_OPEN',
                    message: `RPC Provider ${providerId} tripped circuit breaker on chain ${chainId}`,
                    component: 'MultiProviderRpcManager',
                    chainId,
                    remediationHint: 'Check endpoint rate limits, API quotas, or switch primary provider'
                });
            } else if (event.circuitState === 'HALF_OPEN') {
                this.registry.setGauge('zenith_rpc_provider_health', 0.5, {
                    chain_id: chainId,
                    provider_id: providerId
                });
            } else if (event.success) {
                this.registry.setGauge('zenith_rpc_provider_health', 1, {
                    chain_id: chainId,
                    provider_id: providerId
                });
            }
        } catch {
            // Fail-safe
        }
    }

    public recordSettlementEvent(event: CompositeTelemetryEvent): void {
        try {
            const srcChain = String(event.network || 'unknown');
            const dstChain = String(event.chainId || 'unknown');
            const status = String(event.newState || event.state || 'UNKNOWN');

            this.registry.incrementCounter('zenith_settlement_total', {
                source_chain: srcChain,
                destination_chain: dstChain,
                status
            });

            if (status === 'REORG_DETECTED' || event.errorCode === 'REORG_DETECTED') {
                this.alertManager.triggerAlert({
                    category: 'SETTLEMENT',
                    severity: 'CRITICAL',
                    source: 'CompositeSettlementMonitoringEngine',
                    code: 'DESTINATION_REORG_DETECTED',
                    message: `Deep reorg detected on destination chain ${dstChain} during intent settlement`,
                    component: 'CompositeSettlementMonitoringEngine',
                    chainId: dstChain,
                    remediationHint: 'Inspect chain finality depth and wait for canonical block stabilization'
                });
            } else if (event.errorCode) {
                this.alertManager.triggerAlert({
                    category: 'SETTLEMENT',
                    severity: 'WARNING',
                    source: 'CompositeSettlementMonitoringEngine',
                    code: String(event.errorCode),
                    message: `Settlement error observed on destination chain ${dstChain}: ${event.errorCode}`,
                    component: 'CompositeSettlementMonitoringEngine',
                    chainId: dstChain
                });
            }
        } catch {
            // Fail-safe
        }
    }

    public recordCircuitBreakerEvent(event: {
        isEmergencyPaused: boolean;
        pausedChains?: string[];
        reason?: string;
        signer?: string;
    }): void {
        try {
            if (event.isEmergencyPaused) {
                this.registry.setGauge('zenith_circuit_breaker_state', 1, { state: 'EMERGENCY_PAUSED' });
                this.alertManager.triggerAlert({
                    category: 'CIRCUIT_BREAKER',
                    severity: 'CRITICAL',
                    source: 'CircuitBreakerMonitor',
                    code: 'GLOBAL_EMERGENCY_PAUSE',
                    message: `Global circuit breaker emergency pause activated: ${event.reason || 'Manual trigger'}`,
                    component: 'CircuitBreakerMonitor',
                    remediationHint: 'Review anomalous market volatility, oracle deviations, or protocol invariants before resuming'
                });
            } else if (event.pausedChains && event.pausedChains.length > 0) {
                this.registry.setGauge('zenith_circuit_breaker_state', 0.5, { state: 'CHAIN_PAUSED' });
                for (const c of event.pausedChains) {
                    this.alertManager.triggerAlert({
                        category: 'CIRCUIT_BREAKER',
                        severity: 'WARNING',
                        source: 'CircuitBreakerMonitor',
                        code: 'CHAIN_PAUSED',
                        message: `Circuit breaker pause activated on chain ${c}: ${event.reason || 'Manual trigger'}`,
                        component: 'CircuitBreakerMonitor',
                        chainId: c
                    });
                }
            } else {
                this.registry.setGauge('zenith_circuit_breaker_state', 0, { state: 'CLOSED' });
            }
        } catch {
            // Fail-safe
        }
    }

    public recordExecutionEvent(params: {
        stage: string;
        status: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS';
        routeType?: string;
        sourceChain?: string;
        destinationChain?: string;
        errorCode?: string;
        durationMs?: number;
    }): void {
        try {
            const routeType = params.routeType || 'DIRECT';
            const stage = params.stage || 'EXECUTION';
            const status = params.status;

            this.registry.incrementCounter('zenith_execution_total', {
                stage,
                status,
                route_type: routeType
            });

            if (status === 'SUCCESS') {
                this.registry.incrementCounter('zenith_execution_success_total', {
                    route_type: routeType,
                    source_chain: params.sourceChain || 'unknown',
                    destination_chain: params.destinationChain || 'unknown'
                });
            } else if (status === 'FAILED') {
                const errorCode = params.errorCode || 'UNKNOWN_ERROR';
                this.registry.incrementCounter('zenith_execution_failure_total', {
                    error_code: errorCode,
                    stage,
                    source_chain: params.sourceChain || 'unknown'
                });

                this.alertManager.triggerAlert({
                    category: 'EXECUTION',
                    severity: 'WARNING',
                    source: 'ExecutionCoordinator',
                    code: errorCode,
                    message: `Execution failed at stage ${stage} with error ${errorCode}`,
                    component: 'ExecutionCoordinator',
                    chainId: params.sourceChain
                });
            }

            if (params.durationMs !== undefined && params.durationMs >= 0) {
                this.registry.recordHistogram('zenith_execution_duration_seconds', params.durationMs / 1000, {
                    route_type: routeType,
                    status
                });
            }
        } catch {
            // Fail-safe
        }
    }

    public getMetrics(): string {
        return this.registry.formatExposition();
    }

    public getHealth(): { status: 'HEALTHY'; uptimeSeconds: number; timestamp: number } {
        return this.healthEvaluator.getLiveness();
    }

    public async getReadiness(deps?: {
        rpcManager?: MultiProviderRpcManager;
        circuitBreaker?: CircuitBreakerMonitor;
        persistenceCheck?: () => Promise<boolean> | boolean;
    }): Promise<SystemHealthReport> {
        return this.healthEvaluator.getReadiness(deps);
    }
}

export const defaultObservabilityEngine = new ZenithObservabilityEngine();
