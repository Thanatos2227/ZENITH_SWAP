import { MetricType } from '@zenith/types';

export interface MetricDefinition {
    name: string;
    help: string;
    type: MetricType;
    labelNames?: string[];
    buckets?: number[]; // for HISTOGRAM
}

export type MetricLabels = Record<string, string | number>;

interface HistogramValue {
    sum: number;
    count: number;
    bucketCounts: Map<number, number>;
}

const DEFAULT_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const SENSITIVE_KEY_SUBSTRINGS = ['privatekey', 'secret', 'password', 'token', 'auth', 'bearer', 'seed', 'mnemonic', 'calldata'];

/**
 * Validates and sanitizes metric label values to guarantee bounded cardinality
 * and eliminate secret leakage in Prometheus exposition.
 */
export function sanitizeMetricLabel(key: string, value: string | number): string {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEY_SUBSTRINGS.some((s) => lowerKey.includes(s))) {
        return '[REDACTED]';
    }

    const str = String(value);

    // Filter out raw transaction hashes (0x + 64 hex chars) or Ethereum addresses (0x + 40 hex chars)
    if (/^0x[a-fA-F0-9]{40,64}$/.test(str)) {
        return '[REDACTED_ADDRESS_OR_HASH]';
    }

    // Replace invalid Prometheus label value characters (newlines, quotes, backslashes)
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function serializeLabels(labels?: MetricLabels): string {
    if (!labels || Object.keys(labels).length === 0) {
        return '';
    }
    const parts = Object.entries(labels)
        .filter(([k]) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k))
        .map(([k, v]) => `${k}="${sanitizeMetricLabel(k, v)}"`);
    return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

export class PrometheusRegistry {
    private counters: Map<string, { def: MetricDefinition; values: Map<string, number> }> = new Map();
    private gauges: Map<string, { def: MetricDefinition; values: Map<string, number> }> = new Map();
    private histograms: Map<string, { def: MetricDefinition; values: Map<string, HistogramValue> }> = new Map();

    public registerCounter(name: string, help: string, labelNames: string[] = []): void {
        try {
            if (!this.counters.has(name)) {
                this.counters.set(name, {
                    def: { name, help, type: 'COUNTER', labelNames },
                    values: new Map()
                });
            }
        } catch {
            // Fail-safe: Registry registration must never throw
        }
    }

    public registerGauge(name: string, help: string, labelNames: string[] = []): void {
        try {
            if (!this.gauges.has(name)) {
                this.gauges.set(name, {
                    def: { name, help, type: 'GAUGE', labelNames },
                    values: new Map()
                });
            }
        } catch {
            // Fail-safe
        }
    }

    public registerHistogram(name: string, help: string, labelNames: string[] = [], buckets: number[] = DEFAULT_HISTOGRAM_BUCKETS): void {
        try {
            if (!this.histograms.has(name)) {
                const sortedBuckets = [...buckets].sort((a, b) => a - b);
                this.histograms.set(name, {
                    def: { name, help, type: 'HISTOGRAM', labelNames, buckets: sortedBuckets },
                    values: new Map()
                });
            }
        } catch {
            // Fail-safe
        }
    }

    public incrementCounter(name: string, labels: MetricLabels = {}, amount: number = 1): void {
        try {
            if (amount < 0) return;
            let counter = this.counters.get(name);
            if (!counter) {
                this.registerCounter(name, `${name} total count`, Object.keys(labels));
                counter = this.counters.get(name)!;
            }
            const labelKey = serializeLabels(labels);
            const current = counter.values.get(labelKey) || 0;
            counter.values.set(labelKey, current + amount);
        } catch {
            // Fail-safe
        }
    }

    public setGauge(name: string, value: number, labels: MetricLabels = {}): void {
        try {
            let gauge = this.gauges.get(name);
            if (!gauge) {
                this.registerGauge(name, `${name} gauge`, Object.keys(labels));
                gauge = this.gauges.get(name)!;
            }
            const labelKey = serializeLabels(labels);
            gauge.values.set(labelKey, value);
        } catch {
            // Fail-safe
        }
    }

    public recordHistogram(name: string, value: number, labels: MetricLabels = {}): void {
        try {
            if (value < 0) return;
            let hist = this.histograms.get(name);
            if (!hist) {
                this.registerHistogram(name, `${name} duration or value`, Object.keys(labels));
                hist = this.histograms.get(name)!;
            }
            const labelKey = serializeLabels(labels);
            let histVal = hist.values.get(labelKey);
            if (!histVal) {
                const bucketCounts = new Map<number, number>();
                for (const b of hist.def.buckets || DEFAULT_HISTOGRAM_BUCKETS) {
                    bucketCounts.set(b, 0);
                }
                histVal = { sum: 0, count: 0, bucketCounts };
                hist.values.set(labelKey, histVal);
            }

            histVal.sum += value;
            histVal.count += 1;
            for (const b of hist.def.buckets || DEFAULT_HISTOGRAM_BUCKETS) {
                if (value <= b) {
                    histVal.bucketCounts.set(b, (histVal.bucketCounts.get(b) || 0) + 1);
                }
            }
        } catch {
            // Fail-safe
        }
    }

    public getCounterValue(name: string, labels: MetricLabels = {}): number {
        try {
            const counter = this.counters.get(name);
            if (!counter) return 0;
            const labelKey = serializeLabels(labels);
            return counter.values.get(labelKey) || 0;
        } catch {
            return 0;
        }
    }

    public getGaugeValue(name: string, labels: MetricLabels = {}): number | undefined {
        try {
            const gauge = this.gauges.get(name);
            if (!gauge) return undefined;
            const labelKey = serializeLabels(labels);
            return gauge.values.get(labelKey);
        } catch {
            return undefined;
        }
    }

    /**
     * Serializes all registered metrics to official Prometheus text exposition format.
     */
    public formatExposition(): string {
        try {
            const lines: string[] = [];

            // Counters
            for (const [name, entry] of this.counters.entries()) {
                lines.push(`# HELP ${name} ${entry.def.help}`);
                lines.push(`# TYPE ${name} counter`);
                if (entry.values.size === 0) {
                    lines.push(`${name} 0`);
                } else {
                    for (const [labelKey, val] of entry.values.entries()) {
                        lines.push(`${name}${labelKey} ${val}`);
                    }
                }
            }

            // Gauges
            for (const [name, entry] of this.gauges.entries()) {
                lines.push(`# HELP ${name} ${entry.def.help}`);
                lines.push(`# TYPE ${name} gauge`);
                if (entry.values.size === 0) {
                    lines.push(`${name} 0`);
                } else {
                    for (const [labelKey, val] of entry.values.entries()) {
                        lines.push(`${name}${labelKey} ${val}`);
                    }
                }
            }

            // Histograms
            for (const [name, entry] of this.histograms.entries()) {
                lines.push(`# HELP ${name} ${entry.def.help}`);
                lines.push(`# TYPE ${name} histogram`);
                const buckets = entry.def.buckets || DEFAULT_HISTOGRAM_BUCKETS;

                if (entry.values.size === 0) {
                    for (const b of buckets) {
                        lines.push(`${name}_bucket{le="${b}"} 0`);
                    }
                    lines.push(`${name}_bucket{le="+Inf"} 0`);
                    lines.push(`${name}_sum 0`);
                    lines.push(`${name}_count 0`);
                } else {
                    for (const [labelKey, val] of entry.values.entries()) {
                        // Extract existing label pairs if any
                        const baseLabels = labelKey.startsWith('{') && labelKey.endsWith('}') 
                            ? labelKey.slice(1, -1) 
                            : '';
                        
                        for (const b of buckets) {
                            const count = val.bucketCounts.get(b) || 0;
                            const leLabel = baseLabels ? `${baseLabels},le="${b}"` : `le="${b}"`;
                            lines.push(`${name}_bucket{${leLabel}} ${count}`);
                        }
                        const infLabel = baseLabels ? `${baseLabels},le="+Inf"` : `le="+Inf"`;
                        lines.push(`${name}_bucket{${infLabel}} ${val.count}`);
                        const sumLabel = baseLabels ? `{${baseLabels}}` : '';
                        lines.push(`${name}_sum${sumLabel} ${val.sum}`);
                        lines.push(`${name}_count${sumLabel} ${val.count}`);
                    }
                }
            }

            return lines.join('\n') + (lines.length > 0 ? '\n' : '');
        } catch {
            return '# Prometheus metrics serialization failed\n';
        }
    }

    public clear(): void {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
    }
}

export const defaultPrometheusRegistry = new PrometheusRegistry();
