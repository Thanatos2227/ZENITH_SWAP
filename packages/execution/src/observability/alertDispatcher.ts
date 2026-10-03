import { AlertEvent, AlertSeverity } from '@zenith/types';

export interface ISecureAlertDispatcher {
    readonly name: string;
    dispatch(alert: AlertEvent): Promise<boolean>;
}

export class NoopAlertDispatcher implements ISecureAlertDispatcher {
    public readonly name = 'NoopAlertDispatcher';
    public async dispatch(_alert: AlertEvent): Promise<boolean> {
        return true;
    }
}

export class InMemoryAlertDispatcher implements ISecureAlertDispatcher {
    public readonly name = 'InMemoryAlertDispatcher';
    private dispatchedAlerts: AlertEvent[] = [];
    private maxBufferSize = 500;

    public async dispatch(alert: AlertEvent): Promise<boolean> {
        try {
            if (this.dispatchedAlerts.length >= this.maxBufferSize) {
                this.dispatchedAlerts.shift();
            }
            this.dispatchedAlerts.push(alert);
            return true;
        } catch {
            return false;
        }
    }

    public getDispatchedAlerts(): readonly AlertEvent[] {
        return [...this.dispatchedAlerts];
    }

    public clear(): void {
        this.dispatchedAlerts = [];
    }
}

export interface SlackDispatcherConfig {
    webhookUrl: string;
    channel?: string;
    timeoutMs?: number;
}

export class SlackWebhookDispatcher implements ISecureAlertDispatcher {
    public readonly name = 'SlackWebhookDispatcher';
    private webhookUrl: string;
    private channel?: string;
    private timeoutMs: number;

    constructor(config: SlackDispatcherConfig) {
        this.webhookUrl = config.webhookUrl;
        this.channel = config.channel;
        this.timeoutMs = config.timeoutMs ?? 3000;
    }

    private getSeverityColor(severity: AlertSeverity): string {
        switch (severity) {
            case 'CRITICAL':
                return '#dc3545'; // Danger Red
            case 'WARNING':
                return '#ffc107'; // Warning Yellow
            case 'INFO':
            default:
                return '#17a2b8'; // Info Cyan
        }
    }

    public async dispatch(alert: AlertEvent): Promise<boolean> {
        try {
            if (!this.webhookUrl || !this.webhookUrl.startsWith('http')) {
                return false;
            }

            const color = this.getSeverityColor(alert.severity);
            const payload = {
                channel: this.channel,
                text: `[ZENITH ALERT - ${alert.severity}] ${alert.code}: ${alert.message}`,
                attachments: [
                    {
                        color,
                        title: `Alert: ${alert.code}`,
                        fields: [
                            { title: 'Severity', value: alert.severity, short: true },
                            { title: 'Category', value: alert.category, short: true },
                            { title: 'Component', value: alert.component, short: true },
                            { title: 'Source', value: alert.source, short: true },
                            { title: 'Chain', value: String(alert.chainId || 'N/A'), short: true },
                            { title: 'Timestamp', value: new Date(alert.timestamp).toISOString(), short: true },
                            ...(alert.remediationHint ? [{ title: 'Remediation', value: alert.remediationHint, short: false }] : [])
                        ],
                        footer: 'ZENITH Production Observability Engine'
                    }
                ]
            };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

            const response = await fetch(this.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            }).finally(() => clearTimeout(timeoutId));

            return response.ok;
        } catch {
            // Fail-safe: Webhook failure must never propagate to execution
            return false;
        }
    }
}

export interface PagerDutyDispatcherConfig {
    routingKey: string;
    timeoutMs?: number;
}

export class PagerDutyWebhookDispatcher implements ISecureAlertDispatcher {
    public readonly name = 'PagerDutyWebhookDispatcher';
    private routingKey: string;
    private timeoutMs: number;
    private readonly eventsEndpoint = 'https://events.pagerduty.com/v2/enqueue';

    constructor(config: PagerDutyDispatcherConfig) {
        this.routingKey = config.routingKey;
        this.timeoutMs = config.timeoutMs ?? 3000;
    }

    private mapSeverity(severity: AlertSeverity): 'critical' | 'warning' | 'info' {
        switch (severity) {
            case 'CRITICAL':
                return 'critical';
            case 'WARNING':
                return 'warning';
            case 'INFO':
            default:
                return 'info';
        }
    }

    public async dispatch(alert: AlertEvent): Promise<boolean> {
        try {
            if (!this.routingKey) {
                return false;
            }

            const payload = {
                routing_key: this.routingKey,
                event_action: 'trigger',
                dedup_key: `${alert.category}:${alert.component}:${alert.code}`,
                payload: {
                    summary: `[${alert.severity}] ${alert.code} in ${alert.component}: ${alert.message}`,
                    severity: this.mapSeverity(alert.severity),
                    source: alert.source || 'zenith-execution-engine',
                    component: alert.component,
                    group: alert.category,
                    custom_details: {
                        chainId: alert.chainId,
                        remediationHint: alert.remediationHint,
                        timestamp: alert.timestamp,
                        metadata: alert.metadata
                    }
                }
            };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

            const response = await fetch(this.eventsEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            }).finally(() => clearTimeout(timeoutId));

            return response.ok;
        } catch {
            // Fail-safe: PagerDuty failure must never throw
            return false;
        }
    }
}

export class MultiAlertDispatcher implements ISecureAlertDispatcher {
    public readonly name = 'MultiAlertDispatcher';
    private dispatchers: ISecureAlertDispatcher[] = [];

    constructor(dispatchers: ISecureAlertDispatcher[] = []) {
        this.dispatchers = [...dispatchers];
    }

    public addDispatcher(dispatcher: ISecureAlertDispatcher): void {
        this.dispatchers.push(dispatcher);
    }

    public async dispatch(alert: AlertEvent): Promise<boolean> {
        try {
            if (this.dispatchers.length === 0) return true;
            const results = await Promise.allSettled(
                this.dispatchers.map((d) => d.dispatch(alert))
            );
            return results.some((r) => r.status === 'fulfilled' && r.value === true);
        } catch {
            return false;
        }
    }
}
