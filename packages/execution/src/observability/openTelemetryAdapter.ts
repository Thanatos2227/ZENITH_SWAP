import { OpenTelemetrySpanRecord } from '@zenith/types';
import { sha256, toUtf8Bytes } from 'ethers';
import { sanitizeMetricLabel } from './prometheusRegistry';

export interface IOpenTelemetryExporter {
    export(spans: OpenTelemetrySpanRecord[]): Promise<boolean>;
}

export class InMemoryTraceExporter implements IOpenTelemetryExporter {
    private spans: OpenTelemetrySpanRecord[] = [];
    private maxBufferSize = 1000;

    public async export(newSpans: OpenTelemetrySpanRecord[]): Promise<boolean> {
        try {
            for (const span of newSpans) {
                if (this.spans.length >= this.maxBufferSize) {
                    this.spans.shift();
                }
                this.spans.push(span);
            }
            return true;
        } catch {
            return false;
        }
    }

    public getSpans(): readonly OpenTelemetrySpanRecord[] {
        return [...this.spans];
    }

    public clear(): void {
        this.spans = [];
    }
}

export class OpenTelemetryAdapter {
    private exporter: IOpenTelemetryExporter;
    private traceSequence: number = 1000;
    private spanSequence: number = 1000;

    constructor(exporter: IOpenTelemetryExporter = new InMemoryTraceExporter()) {
        this.exporter = exporter;
    }

    public generateTraceId(): string {
        const seq = this.traceSequence++;
        const rawHash = sha256(toUtf8Bytes(`zenith-trace-${Date.now()}-${seq}`));
        return rawHash.slice(2, 34); // 32 hex characters
    }

    public generateSpanId(): string {
        const seq = this.spanSequence++;
        const rawHash = sha256(toUtf8Bytes(`zenith-span-${Date.now()}-${seq}`));
        return rawHash.slice(2, 18); // 16 hex characters
    }

    public startSpan(name: string, options: {
        traceId?: string;
        parentSpanId?: string;
        kind?: 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
        attributes?: Record<string, string | number | boolean>;
    } = {}): {
        traceId: string;
        spanId: string;
        end: (status?: 'OK' | 'ERROR', error?: { code?: string; message: string }) => Promise<OpenTelemetrySpanRecord>;
        setAttribute: (key: string, value: string | number | boolean) => void;
    } {
        const traceId = options.traceId || this.generateTraceId();
        const spanId = this.generateSpanId();
        const startTimeMs = Date.now();
        const attributes: Record<string, string | number | boolean> = {};

        if (options.attributes) {
            for (const [k, v] of Object.entries(options.attributes)) {
                attributes[k] = typeof v === 'string' ? sanitizeMetricLabel(k, v) : v;
            }
        }

        return {
            traceId,
            spanId,
            setAttribute: (key: string, value: string | number | boolean) => {
                try {
                    attributes[key] = typeof value === 'string' ? sanitizeMetricLabel(key, value) : value;
                } catch {
                    // Fail-safe
                }
            },
            end: async (status = 'OK', error) => {
                const endTimeMs = Date.now();
                const record: OpenTelemetrySpanRecord = {
                    traceId,
                    spanId,
                    parentSpanId: options.parentSpanId,
                    name,
                    kind: options.kind || 'INTERNAL',
                    startTimeMs,
                    endTimeMs,
                    durationMs: Math.max(0, endTimeMs - startTimeMs),
                    status,
                    attributes,
                    error
                };

                try {
                    await this.exporter.export([record]);
                } catch {
                    // Fail-safe
                }

                return record;
            }
        };
    }
}

export const defaultOpenTelemetryAdapter = new OpenTelemetryAdapter();
