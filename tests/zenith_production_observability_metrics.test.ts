import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    PrometheusRegistry,
    sanitizeMetricLabel,
    AlertManager,
    InMemoryAlertDispatcher,
    SlackWebhookDispatcher,
    PagerDutyWebhookDispatcher,
    MultiAlertDispatcher,
    HealthEvaluator,
    OpenTelemetryAdapter,
    InMemoryTraceExporter,
    ZenithObservabilityEngine
} from '../packages/execution/src/observability';
import { MultiProviderRpcManager } from '../packages/chains/src/rpc/multiProviderRpcManager';
import { CircuitBreakerMonitor } from '../packages/security/src/circuitBreaker';

describe('ZENITH Phase 3 — Task 56: Production Observability, Metrics & Alerting', () => {

    describe('1. Prometheus Metrics Registry & Exposition', () => {
        let registry: PrometheusRegistry;

        beforeEach(() => {
            registry = new PrometheusRegistry();
        });

        it('records counter increments and formats standard exposition', () => {
            registry.registerCounter('zenith_execution_total', 'Total execution count', ['stage', 'status']);
            registry.incrementCounter('zenith_execution_total', { stage: 'VALIDATION', status: 'SUCCESS' }, 1);
            registry.incrementCounter('zenith_execution_total', { stage: 'VALIDATION', status: 'SUCCESS' }, 2);
            registry.incrementCounter('zenith_execution_total', { stage: 'SETTLEMENT', status: 'FAILED' }, 1);

            assert.equal(registry.getCounterValue('zenith_execution_total', { stage: 'VALIDATION', status: 'SUCCESS' }), 3);
            assert.equal(registry.getCounterValue('zenith_execution_total', { stage: 'SETTLEMENT', status: 'FAILED' }), 1);

            const exposition = registry.formatExposition();
            assert.match(exposition, /# HELP zenith_execution_total Total execution count/);
            assert.match(exposition, /# TYPE zenith_execution_total counter/);
            assert.match(exposition, /zenith_execution_total\{stage="VALIDATION",status="SUCCESS"\} 3/);
            assert.match(exposition, /zenith_execution_total\{stage="SETTLEMENT",status="FAILED"\} 1/);
        });

        it('tracks gauges accurately with state transitions', () => {
            registry.registerGauge('zenith_circuit_breaker_state', 'Circuit breaker state', ['state']);
            registry.setGauge('zenith_circuit_breaker_state', 0, { state: 'CLOSED' });
            assert.equal(registry.getGaugeValue('zenith_circuit_breaker_state', { state: 'CLOSED' }), 0);

            registry.setGauge('zenith_circuit_breaker_state', 1, { state: 'EMERGENCY_PAUSED' });
            assert.equal(registry.getGaugeValue('zenith_circuit_breaker_state', { state: 'EMERGENCY_PAUSED' }), 1);

            const exposition = registry.formatExposition();
            assert.match(exposition, /# TYPE zenith_circuit_breaker_state gauge/);
            assert.match(exposition, /zenith_circuit_breaker_state\{state="EMERGENCY_PAUSED"\} 1/);
        });

        it('records histogram distributions with bucket counts, sum, and count', () => {
            registry.registerHistogram('zenith_rpc_latency_seconds', 'RPC latency in seconds', ['chain_id'], [0.05, 0.1, 0.25, 0.5, 1.0]);
            registry.recordHistogram('zenith_rpc_latency_seconds', 0.04, { chain_id: '137' });
            registry.recordHistogram('zenith_rpc_latency_seconds', 0.08, { chain_id: '137' });
            registry.recordHistogram('zenith_rpc_latency_seconds', 0.35, { chain_id: '137' });

            const exposition = registry.formatExposition();
            assert.match(exposition, /# TYPE zenith_rpc_latency_seconds histogram/);
            assert.match(exposition, /zenith_rpc_latency_seconds_bucket\{chain_id="137",le="0.05"\} 1/);
            assert.match(exposition, /zenith_rpc_latency_seconds_bucket\{chain_id="137",le="0.1"\} 2/);
            assert.match(exposition, /zenith_rpc_latency_seconds_bucket\{chain_id="137",le="0.25"\} 2/);
            assert.match(exposition, /zenith_rpc_latency_seconds_bucket\{chain_id="137",le="0.5"\} 3/);
            assert.match(exposition, /zenith_rpc_latency_seconds_bucket\{chain_id="137",le="\+Inf"\} 3/);
            assert.match(exposition, /zenith_rpc_latency_seconds_count\{chain_id="137"\} 3/);
        });

        it('strictly redacts sensitive values and raw addresses/hashes from metric labels', () => {
            assert.equal(sanitizeMetricLabel('privateKey', '0x1234567890abcdef'), '[REDACTED]');
            assert.equal(sanitizeMetricLabel('secretSeed', 'apple banana cherry'), '[REDACTED]');
            assert.equal(sanitizeMetricLabel('authToken', 'Bearer xyz'), '[REDACTED]');
            assert.equal(sanitizeMetricLabel('txHash', '0x9999999999999999999999999999999999999999999999999999999999999999'), '[REDACTED_ADDRESS_OR_HASH]');
            assert.equal(sanitizeMetricLabel('walletAddress', '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88'), '[REDACTED_ADDRESS_OR_HASH]');
            assert.equal(sanitizeMetricLabel('chain_id', 'polygon'), 'polygon');
        });
    });

    describe('2. Alert Manager & Deduplication Engine', () => {
        let dispatcher: InMemoryAlertDispatcher;
        let alertManager: AlertManager;

        beforeEach(() => {
            dispatcher = new InMemoryAlertDispatcher();
            alertManager = new AlertManager({ cooldownMs: 1000, dispatcher });
        });

        it('dispatches alerts and deduplicates repeated alerts within cooldown window', async () => {
            // First alert
            const first = await alertManager.triggerAlert({
                category: 'RPC',
                severity: 'WARNING',
                source: 'MultiProviderRpcManager',
                code: 'PROVIDER_TIMEOUT',
                message: 'Alchemy RPC timeout after 5000ms',
                component: 'MultiProviderRpcManager',
                chainId: '137'
            });

            assert.equal(first.dispatched, true);
            assert.equal(first.deduplicated, false);
            assert.equal(dispatcher.getDispatchedAlerts().length, 1);

            // Immediate duplicate alert
            const duplicate = await alertManager.triggerAlert({
                category: 'RPC',
                severity: 'WARNING',
                source: 'MultiProviderRpcManager',
                code: 'PROVIDER_TIMEOUT',
                message: 'Alchemy RPC timeout after 5000ms (duplicate)',
                component: 'MultiProviderRpcManager',
                chainId: '137'
            });

            assert.equal(duplicate.dispatched, false);
            assert.equal(duplicate.deduplicated, true);
            // Dispatcher still only received 1
            assert.equal(dispatcher.getDispatchedAlerts().length, 1);
            // History records both
            assert.equal(alertManager.getAlertHistory().length, 2);
        });

        it('permits forced alert dispatch bypassing cooldown', async () => {
            await alertManager.triggerAlert({
                category: 'CIRCUIT_BREAKER',
                severity: 'CRITICAL',
                source: 'CircuitBreakerMonitor',
                code: 'GLOBAL_EMERGENCY_PAUSE',
                message: 'Emergency pause activated',
                component: 'CircuitBreakerMonitor'
            });

            // Forced alert
            const forced = await alertManager.triggerAlert({
                category: 'CIRCUIT_BREAKER',
                severity: 'CRITICAL',
                source: 'CircuitBreakerMonitor',
                code: 'GLOBAL_EMERGENCY_PAUSE',
                message: 'Emergency pause re-asserted',
                component: 'CircuitBreakerMonitor',
                force: true
            });

            assert.equal(forced.dispatched, true);
            assert.equal(forced.deduplicated, false);
            assert.equal(dispatcher.getDispatchedAlerts().length, 2);
        });
    });

    describe('3. Alert Dispatcher Implementations & Failure Isolation', () => {
        it('isolates Slack webhook network failures without throwing', async () => {
            const slack = new SlackWebhookDispatcher({
                webhookUrl: 'http://127.0.0.1:9999/unreachable-slack-hook',
                timeoutMs: 50
            });

            const success = await slack.dispatch({
                alertId: 'test-alert-1',
                category: 'EXECUTION',
                severity: 'CRITICAL',
                source: 'Test',
                code: 'TEST_ERROR',
                message: 'Test failure',
                component: 'TestRunner',
                timestamp: Date.now()
            });

            // Network failure safely caught and returns false
            assert.equal(success, false);
        });

        it('isolates PagerDuty webhook failures without throwing', async () => {
            const pd = new PagerDutyWebhookDispatcher({
                routingKey: 'invalid-pd-key',
                timeoutMs: 50
            });

            const success = await pd.dispatch({
                alertId: 'test-alert-2',
                category: 'SETTLEMENT',
                severity: 'CRITICAL',
                source: 'Test',
                code: 'SETTLEMENT_TIMEOUT',
                message: 'Settlement exceeded timeout',
                component: 'SettlementEngine',
                timestamp: Date.now()
            });

            assert.equal(typeof success, 'boolean');
        });

        it('MultiAlertDispatcher aggregates results safely', async () => {
            const inMemory = new InMemoryAlertDispatcher();
            const multi = new MultiAlertDispatcher([inMemory]);

            const res = await multi.dispatch({
                alertId: 'multi-test-1',
                category: 'SECURITY',
                severity: 'INFO',
                source: 'Audit',
                code: 'KEY_CHECK_PASSED',
                message: 'KMS policy active',
                component: 'KmsSigner',
                timestamp: Date.now()
            });

            assert.equal(res, true);
            assert.equal(inMemory.getDispatchedAlerts().length, 1);
        });
    });

    describe('4. Health & Readiness Evaluator', () => {
        let healthEvaluator: HealthEvaluator;
        let rpcManager: MultiProviderRpcManager;
        let circuitBreaker: CircuitBreakerMonitor;

        beforeEach(() => {
            healthEvaluator = new HealthEvaluator('4.0.0');
            rpcManager = new MultiProviderRpcManager({ seedDefaultEndpoints: false });
            circuitBreaker = new CircuitBreakerMonitor();
        });

        it('reports liveness as HEALTHY with uptime', () => {
            const liveness = healthEvaluator.getLiveness();
            assert.equal(liveness.status, 'HEALTHY');
            assert.equal(typeof liveness.uptimeSeconds, 'number');
            assert.equal(typeof liveness.timestamp, 'number');
        });

        it('evaluates readiness accurately with healthy RPC and closed circuit breaker', async () => {
            rpcManager.registerEndpoint({
                id: 'polygon-rpc-1',
                chainId: 'polygon',
                numericChainId: 137,
                url: 'https://polygon-rpc.com',
                priority: 1
            });

            const report = await healthEvaluator.getReadiness({
                rpcManager,
                circuitBreaker,
                persistenceCheck: () => true
            });

            assert.equal(report.status, 'HEALTHY');
            assert.equal(report.components['rpc_providers'].status, 'HEALTHY');
            assert.equal(report.components['circuit_breaker'].status, 'HEALTHY');
            assert.equal(report.components['persistence'].status, 'HEALTHY');
        });

        it('degrades readiness when RPC endpoints are degraded or circuit open', async () => {
            const ep = rpcManager.registerEndpoint({
                id: 'polygon-rpc-1',
                chainId: 'polygon',
                numericChainId: 137,
                url: 'https://polygon-rpc.com',
                priority: 1
            });
            rpcManager.updateEndpointStatus(ep.id, 'CIRCUIT_OPEN');

            const report = await healthEvaluator.getReadiness({
                rpcManager,
                circuitBreaker
            });

            assert.equal(report.status, 'UNAVAILABLE');
            assert.equal(report.components['rpc_providers'].status, 'UNAVAILABLE');
        });

        it('marks readiness UNAVAILABLE when Circuit Breaker is emergency paused', async () => {
            rpcManager.registerEndpoint({
                id: 'polygon-rpc-1',
                chainId: 'polygon',
                numericChainId: 137,
                url: 'https://polygon-rpc.com',
                priority: 1
            });

            circuitBreaker.emergencyPause('Anomalous price deviation detected', '0xOperator');

            const report = await healthEvaluator.getReadiness({
                rpcManager,
                circuitBreaker
            });

            assert.equal(report.status, 'UNAVAILABLE');
            assert.equal(report.components['circuit_breaker'].status, 'UNAVAILABLE');
        });
    });

    describe('5. OpenTelemetry Semantic Tracing Adapter', () => {
        let exporter: InMemoryTraceExporter;
        let tracer: OpenTelemetryAdapter;

        beforeEach(() => {
            exporter = new InMemoryTraceExporter();
            tracer = new OpenTelemetryAdapter(exporter);
        });

        it('generates compliant traceIds and spanIds and records duration', async () => {
            const span = tracer.startSpan('zenith.execution.route_arbitration', {
                attributes: {
                    source_chain: 'polygon',
                    destination_chain: 'arbitrum_one'
                }
            });

            assert.equal(span.traceId.length, 32);
            assert.equal(span.spanId.length, 16);

            span.setAttribute('candidates_evaluated', 5);
            const record = await span.end('OK');

            assert.equal(record.status, 'OK');
            assert.equal(record.name, 'zenith.execution.route_arbitration');
            assert.equal(record.attributes['source_chain'], 'polygon');
            assert.equal(record.attributes['candidates_evaluated'], 5);
            assert.equal(exporter.getSpans().length, 1);
        });

        it('records error details on failed span', async () => {
            const span = tracer.startSpan('zenith.execution.preflight_simulation');
            const record = await span.end('ERROR', {
                code: 'V3_TOO_LITTLE_RECEIVED',
                message: 'Simulated output was less than amountOutMinimum'
            });

            assert.equal(record.status, 'ERROR');
            assert.equal(record.error?.code, 'V3_TOO_LITTLE_RECEIVED');
            assert.equal(exporter.getSpans().length, 1);
        });
    });

    describe('6. ZenithObservabilityEngine Central Integration', () => {
        let engine: ZenithObservabilityEngine;
        let dispatcher: InMemoryAlertDispatcher;

        beforeEach(() => {
            dispatcher = new InMemoryAlertDispatcher();
            const alertManager = new AlertManager({ dispatcher });
            engine = new ZenithObservabilityEngine({ alertManager });
        });

        it('integrates RPC telemetry events into metrics and alerts', () => {
            engine.recordRpcEvent({
                eventId: 'rpc-ev-1',
                providerId: 'polygon-alchemy-1',
                chainId: '137',
                operation: 'eth_call',
                category: 'SIMULATION',
                latencyMs: 120,
                success: true,
                retryCount: 0,
                failoverCount: 0,
                timestamp: Date.now()
            });

            const metrics = engine.getMetrics();
            assert.match(metrics, /zenith_rpc_requests_total\{chain_id="137",provider_id="polygon-alchemy-1",operation="eth_call"\} 1/);
            assert.match(metrics, /zenith_rpc_latency_seconds_count\{chain_id="137",provider_id="polygon-alchemy-1"\} 1/);
        });

        it('triggers alert on circuit breaker events', () => {
            engine.recordCircuitBreakerEvent({
                isEmergencyPaused: true,
                reason: 'Critical oracle outage'
            });

            assert.equal(dispatcher.getDispatchedAlerts().length, 1);
            const alert = dispatcher.getDispatchedAlerts()[0];
            assert.equal(alert.category, 'CIRCUIT_BREAKER');
            assert.equal(alert.severity, 'CRITICAL');
            assert.equal(alert.code, 'GLOBAL_EMERGENCY_PAUSE');
        });

        it('records execution failure events into metrics and alerts', () => {
            engine.recordExecutionEvent({
                stage: 'SOURCE_SWAP',
                status: 'FAILED',
                routeType: 'CROSS_CHAIN_COMPOSITE',
                sourceChain: '137',
                destinationChain: '42161',
                errorCode: 'SLIPPAGE_EXCEEDED',
                durationMs: 450
            });

            const metrics = engine.getMetrics();
            assert.match(metrics, /zenith_execution_failure_total\{error_code="SLIPPAGE_EXCEEDED",stage="SOURCE_SWAP",source_chain="137"\} 1/);
            assert.equal(dispatcher.getDispatchedAlerts().length, 1);
            assert.equal(dispatcher.getDispatchedAlerts()[0].code, 'SLIPPAGE_EXCEEDED');
        });
    });

    describe('7. Observability Failure Chaos Tests', () => {
        it('ensures execution is never affected if metrics or alerts fail', () => {
            const engine = new ZenithObservabilityEngine();
            // Corrupt internal maps intentionally to simulate extreme in-memory fault
            (engine.registry as any).counters = null;

            // These must never throw or crash execution
            assert.doesNotThrow(() => {
                engine.recordRpcEvent({
                    eventId: 'fault-1',
                    providerId: 'p1',
                    chainId: '137',
                    operation: 'eth_call',
                    category: 'BROADCAST',
                    latencyMs: 50,
                    success: false,
                    retryCount: 1,
                    failoverCount: 0,
                    timestamp: Date.now()
                });
            });

            assert.doesNotThrow(() => {
                engine.recordExecutionEvent({
                    stage: 'SETTLEMENT',
                    status: 'SUCCESS'
                });
            });

            assert.doesNotThrow(() => {
                engine.getMetrics();
            });
        });
    });
});
