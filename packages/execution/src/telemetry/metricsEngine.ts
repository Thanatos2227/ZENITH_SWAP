import {
    CanonicalTelemetryEvent,
    LatencyMetricSummary,
    TelemetryEvidenceLabel,
    UnifiedMetricsSnapshot
} from '@zenith/types';

interface MetricSample {
    value: number;
    success: boolean;
    label: TelemetryEvidenceLabel;
    timestamp: number;
}

class MetricHistogram {
    private samples: MetricSample[] = [];
    private readonly maxSamples: number = 10000;
    private defaultLabel: TelemetryEvidenceLabel;

    constructor(defaultLabel: TelemetryEvidenceLabel = 'LIVE') {
        this.defaultLabel = defaultLabel;
    }

    public record(value: number, success: boolean = true, label?: TelemetryEvidenceLabel): void {
        if (value < 0 || isNaN(value)) return;
        this.samples.push({
            value,
            success,
            label: label ?? this.defaultLabel,
            timestamp: Date.now()
        });

        if (this.samples.length > this.maxSamples) {
            this.samples.shift();
        }
    }

    public summarize(targetLabel?: TelemetryEvidenceLabel): LatencyMetricSummary {
        const filtered = targetLabel
            ? this.samples.filter(s => s.label === targetLabel)
            : this.samples;

        if (filtered.length === 0) {
            return {
                count: 0,
                success: 0,
                failure: 0,
                p50: 0,
                p95: 0,
                p99: 0,
                maximum: 0,
                average: 0,
                label: targetLabel ?? this.defaultLabel
            };
        }

        let successCount = 0;
        let sum = 0;
        let max = 0;
        const sortedValues: number[] = [];

        for (const s of filtered) {
            if (s.success) successCount++;
            sum += s.value;
            if (s.value > max) max = s.value;
            sortedValues.push(s.value);
        }

        sortedValues.sort((a, b) => a - b);
        const count = sortedValues.length;
        const failureCount = count - successCount;
        const average = Number((sum / count).toFixed(2));

        const getPercentile = (p: number) => {
            const index = Math.min(Math.floor((p / 100) * count), count - 1);
            return sortedValues[index];
        };

        const dominantLabel = targetLabel ?? (filtered.length > 0 ? filtered[filtered.length - 1].label : this.defaultLabel);

        return {
            count,
            success: successCount,
            failure: failureCount,
            p50: getPercentile(50),
            p95: getPercentile(95),
            p99: getPercentile(99),
            maximum: max,
            average,
            label: dominantLabel
        };
    }

    public clear(): void {
        this.samples = [];
    }
}

export class MetricsEngine {
    private routeResolution = new MetricHistogram('READ_ONLY');
    private quote = new MetricHistogram('READ_ONLY');
    private arbitration = new MetricHistogram('READ_ONLY');
    private rpc = new MetricHistogram('READ_ONLY');
    private bridgeQuote = new MetricHistogram('READ_ONLY');
    private sourceExecution = new MetricHistogram('LIVE');
    private bridgeDuration = new MetricHistogram('LIVE');
    private destinationDuration = new MetricHistogram('LIVE');
    private finalityDuration = new MetricHistogram('LIVE');
    private settlementDuration = new MetricHistogram('LIVE');

    public recordLatency(
        metric:
            | 'routeResolutionLatency'
            | 'quoteLatency'
            | 'arbitrationLatency'
            | 'rpcLatency'
            | 'bridgeQuoteLatency'
            | 'sourceExecutionDuration'
            | 'bridgeDuration'
            | 'destinationDuration'
            | 'finalityDuration'
            | 'settlementDuration',
        latencyMs: number,
        success: boolean = true,
        label?: TelemetryEvidenceLabel
    ): void {
        switch (metric) {
            case 'routeResolutionLatency':
                this.routeResolution.record(latencyMs, success, label);
                break;
            case 'quoteLatency':
                this.quote.record(latencyMs, success, label);
                break;
            case 'arbitrationLatency':
                this.arbitration.record(latencyMs, success, label);
                break;
            case 'rpcLatency':
                this.rpc.record(latencyMs, success, label);
                break;
            case 'bridgeQuoteLatency':
                this.bridgeQuote.record(latencyMs, success, label);
                break;
            case 'sourceExecutionDuration':
                this.sourceExecution.record(latencyMs, success, label);
                break;
            case 'bridgeDuration':
                this.bridgeDuration.record(latencyMs, success, label);
                break;
            case 'destinationDuration':
                this.destinationDuration.record(latencyMs, success, label);
                break;
            case 'finalityDuration':
                this.finalityDuration.record(latencyMs, success, label);
                break;
            case 'settlementDuration':
                this.settlementDuration.record(latencyMs, success, label);
                break;
        }
    }

    public processTelemetryEvent(event: CanonicalTelemetryEvent): void {
        const latency = event.latency;
        if (latency === null || latency === undefined || latency < 0) return;

        const isSuccess = event.severity !== 'ERROR' && event.severity !== 'CRITICAL';
        let label: TelemetryEvidenceLabel = 'LIVE';
        if (event.evidenceTier === 'READ_ONLY_LIVE') label = 'READ_ONLY';
        else if (event.evidenceTier === 'PREFLIGHT') label = 'PREFLIGHT';
        else if (event.evidenceTier === 'SIMULATION') label = 'SIMULATION';
        else if (event.evidenceTier === 'FIXTURE') label = 'FIXTURE';
        else if (event.evidenceTier === 'ON_CHAIN_LIVE') label = 'LIVE';

        switch (event.eventType) {
            case 'ROUTE_DISCOVERY_COMPLETED':
                this.recordLatency('routeResolutionLatency', latency, isSuccess, label);
                break;
            case 'QUOTE_RECEIVED':
                this.recordLatency('quoteLatency', latency, isSuccess, label);
                break;
            case 'ROUTE_ARBITRATION_COMPLETED':
                this.recordLatency('arbitrationLatency', latency, isSuccess, label);
                break;
            case 'RPC_HEALTH_CHANGED':
                this.recordLatency('rpcLatency', latency, isSuccess, label);
                break;
            case 'BRIDGE_QUOTE_RECEIVED':
            case 'BRIDGE_QUOTE_REFRESHED':
                this.recordLatency('bridgeQuoteLatency', latency, isSuccess, label);
                break;
            case 'SOURCE_CONFIRMED':
                this.recordLatency('sourceExecutionDuration', latency, isSuccess, label);
                break;
            case 'BRIDGE_FILLED':
                this.recordLatency('bridgeDuration', latency, isSuccess, label);
                break;
            case 'DESTINATION_TRANSFER_VERIFIED':
                this.recordLatency('destinationDuration', latency, isSuccess, label);
                break;
            case 'FINALITY_REACHED':
                this.recordLatency('finalityDuration', latency, isSuccess, label);
                break;
            case 'SETTLED':
            case 'SETTLEMENT_VERIFIED':
                this.recordLatency('settlementDuration', latency, isSuccess, label);
                break;
        }
    }

    public getSnapshot(): UnifiedMetricsSnapshot {
        return {
            routeResolutionLatency: this.routeResolution.summarize(),
            quoteLatency: this.quote.summarize(),
            arbitrationLatency: this.arbitration.summarize(),
            rpcLatency: this.rpc.summarize(),
            bridgeQuoteLatency: this.bridgeQuote.summarize(),
            sourceExecutionDuration: this.sourceExecution.summarize(),
            bridgeDuration: this.bridgeDuration.summarize(),
            destinationDuration: this.destinationDuration.summarize(),
            finalityDuration: this.finalityDuration.summarize(),
            settlementDuration: this.settlementDuration.summarize()
        };
    }

    public clear(): void {
        this.routeResolution.clear();
        this.quote.clear();
        this.arbitration.clear();
        this.rpc.clear();
        this.bridgeQuote.clear();
        this.sourceExecution.clear();
        this.bridgeDuration.clear();
        this.destinationDuration.clear();
        this.finalityDuration.clear();
        this.settlementDuration.clear();
    }
}

export const defaultMetricsEngine = new MetricsEngine();
