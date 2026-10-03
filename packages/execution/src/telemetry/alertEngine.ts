import { CanonicalAlert, CanonicalAlertType, CanonicalTelemetryEvent, TelemetrySeverity } from '@zenith/types';
import { scrubTelemetrySecrets } from './canonicalTelemetryEvent';

export class AlertEngine {
    private alertSequence: number = 1000;
    private alerts: Map<string, CanonicalAlert> = new Map<string, CanonicalAlert>();
    private alertHistory: CanonicalAlert[] = [];
    private readonly maxHistory: number = 2000;

    public raiseAlert(params: {
        alertType: CanonicalAlertType;
        severity: TelemetrySeverity;
        source: string;
        message: string;
        network?: string | null;
        intentId?: string | null;
        metadata?: Record<string, any>;
        timestamp?: number;
    }): CanonicalAlert {
        const timestamp = params.timestamp ?? Date.now();
        const alertKey = `${params.alertType}:${params.network || 'global'}:${params.intentId || 'none'}`;
        const alertId = `alert-${params.alertType.toLowerCase()}-${timestamp}-${this.alertSequence++}`;

        const existing = this.alerts.get(alertKey);
        if (existing && existing.state === 'ACTIVE') {
            // Deduplicate active alerts for same key, return existing
            return existing;
        }

        const alert: CanonicalAlert = {
            alertId: scrubTelemetrySecrets(alertId),
            alertType: params.alertType,
            severity: params.severity,
            source: scrubTelemetrySecrets(params.source),
            timestamp,
            network: params.network ? scrubTelemetrySecrets(params.network) : null,
            intentId: params.intentId ? scrubTelemetrySecrets(params.intentId) : null,
            message: scrubTelemetrySecrets(params.message),
            state: 'ACTIVE',
            resolvedAt: null,
            metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined
        };

        this.alerts.set(alertKey, alert);
        this.alertHistory.push(alert);

        if (this.alertHistory.length > this.maxHistory) {
            this.alertHistory.shift();
        }

        return Object.freeze(alert);
    }

    public resolveAlert(alertType: CanonicalAlertType, network?: string | null, intentId?: string | null): boolean {
        const alertKey = `${alertType}:${network || 'global'}:${intentId || 'none'}`;
        const existing = this.alerts.get(alertKey);
        if (existing && existing.state === 'ACTIVE') {
            const updated: CanonicalAlert = {
                ...existing,
                state: 'RESOLVED',
                resolvedAt: Date.now()
            };
            this.alerts.set(alertKey, updated);
            return true;
        }
        return false;
    }

    public processTelemetryEvent(event: CanonicalTelemetryEvent): CanonicalAlert | null {
        switch (event.eventType) {
            case 'RPC_CIRCUIT_OPENED':
                return this.raiseAlert({
                    alertType: 'RPC_CIRCUIT_OPEN',
                    severity: 'ERROR',
                    source: event.source,
                    message: `RPC circuit breaker OPEN for provider ${event.provider || 'unknown'} on ${event.network || 'network'}`,
                    network: event.network,
                    intentId: event.intentId
                });

            case 'RPC_CIRCUIT_RECOVERED':
                this.resolveAlert('RPC_CIRCUIT_OPEN', event.network, event.intentId);
                return null;

            case 'RPC_DISAGREEMENT_DETECTED':
                return this.raiseAlert({
                    alertType: 'RPC_DISAGREEMENT',
                    severity: 'ERROR',
                    source: event.source,
                    message: `Consensus disagreement detected on ${event.network || 'network'}`,
                    network: event.network,
                    intentId: event.intentId
                });

            case 'REORG_DETECTED':
                return this.raiseAlert({
                    alertType: 'REORG_DETECTED',
                    severity: 'CRITICAL',
                    source: event.source,
                    message: `Blockchain reorganization detected on ${event.network || 'network'} for tx ${event.txHash || 'unknown'}`,
                    network: event.network,
                    intentId: event.intentId
                });

            case 'QUOTE_EXPIRED':
                return this.raiseAlert({
                    alertType: 'QUOTE_STALE',
                    severity: 'WARNING',
                    source: event.source,
                    message: `Execution quote expired for route ${event.routeId || 'unknown'}`,
                    network: event.network,
                    intentId: event.intentId
                });

            case 'SETTLEMENT_BLOCKED':
                return this.raiseAlert({
                    alertType: 'SETTLEMENT_BLOCKED',
                    severity: 'ERROR',
                    source: event.source,
                    message: `Settlement blocked: ${event.errorCode || 'unknown error'}`,
                    network: event.network,
                    intentId: event.intentId
                });

            case 'BRIDGE_FAILED':
                return this.raiseAlert({
                    alertType: 'BRIDGE_PROVIDER_DOWN',
                    severity: 'ERROR',
                    source: event.source,
                    message: `Bridge relay failure on provider ${event.provider || 'unknown'}: ${event.errorCode || 'failed'}`,
                    network: event.network,
                    intentId: event.intentId
                });

            default:
                return null;
        }
    }

    public getActiveAlerts(): readonly CanonicalAlert[] {
        const active: CanonicalAlert[] = [];
        for (const alert of this.alerts.values()) {
            if (alert.state === 'ACTIVE') {
                active.push(alert);
            }
        }
        return active.sort((a, b) => b.timestamp - a.timestamp);
    }

    public getAllAlerts(): readonly CanonicalAlert[] {
        return [...this.alertHistory];
    }

    public clear(): void {
        this.alerts.clear();
        this.alertHistory = [];
    }
}

export const defaultAlertEngine = new AlertEngine();
