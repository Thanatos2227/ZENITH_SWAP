import { AlertEvent, AlertSeverity, AlertCategory } from '@zenith/types';
import { ISecureAlertDispatcher, NoopAlertDispatcher } from './alertDispatcher';

export interface AlertManagerConfig {
    cooldownMs?: number; // Time to suppress identical alerts (default 5 min)
    dispatcher?: ISecureAlertDispatcher;
    maxStoredAlerts?: number;
}

export class AlertManager {
    private alertSequence: number = 1000;
    private cooldownMs: number;
    private dispatcher: ISecureAlertDispatcher;
    private alertHistory: AlertEvent[] = [];
    private lastAlertTimestampByKey: Map<string, number> = new Map();
    private alertCountsByKey: Map<string, number> = new Map();
    private readonly maxStoredAlerts: number;

    constructor(config: AlertManagerConfig = {}) {
        this.cooldownMs = config.cooldownMs ?? 300000; // 5 minutes
        this.dispatcher = config.dispatcher ?? new NoopAlertDispatcher();
        this.maxStoredAlerts = config.maxStoredAlerts ?? 1000;
    }

    public setDispatcher(dispatcher: ISecureAlertDispatcher): void {
        this.dispatcher = dispatcher;
    }

    private computeDedupKey(category: AlertCategory, component: string, code: string, chainId?: string | number): string {
        return `${category}:${component}:${code}:${chainId !== undefined ? String(chainId) : 'all'}`;
    }

    public async triggerAlert(params: {
        category: AlertCategory;
        severity: AlertSeverity;
        source: string;
        code: string;
        message: string;
        component: string;
        chainId?: string | number;
        remediationHint?: string;
        metadata?: Record<string, string | number | boolean>;
        force?: boolean; // bypass cooldown
    }): Promise<{ dispatched: boolean; deduplicated: boolean; alert: AlertEvent }> {
        const now = Date.now();
        const dedupKey = this.computeDedupKey(params.category, params.component, params.code, params.chainId);
        const lastSent = this.lastAlertTimestampByKey.get(dedupKey) || 0;
        const currentCount = (this.alertCountsByKey.get(dedupKey) || 0) + 1;
        this.alertCountsByKey.set(dedupKey, currentCount);

        const seq = this.alertSequence++;
        const alert: AlertEvent = {
            alertId: `alt-${params.category.toLowerCase()}-${now}-${seq}`,
            category: params.category,
            severity: params.severity,
            source: params.source,
            code: params.code,
            message: params.message,
            component: params.component,
            chainId: params.chainId,
            timestamp: now,
            remediationHint: params.remediationHint,
            metadata: params.metadata
        };


        // Record in internal history
        if (this.alertHistory.length >= this.maxStoredAlerts) {
            this.alertHistory.shift();
        }
        this.alertHistory.push(alert);

        // Check deduplication / cooldown
        if (!params.force && (now - lastSent < this.cooldownMs)) {
            return { dispatched: false, deduplicated: true, alert };
        }

        this.lastAlertTimestampByKey.set(dedupKey, now);

        try {
            const dispatched = await this.dispatcher.dispatch(alert);
            return { dispatched, deduplicated: false, alert };
        } catch {
            return { dispatched: false, deduplicated: false, alert };
        }
    }

    public getAlertHistory(): readonly AlertEvent[] {
        return [...this.alertHistory];
    }

    public getAlertCount(category?: AlertCategory): number {
        if (!category) return this.alertHistory.length;
        return this.alertHistory.filter((a) => a.category === category).length;
    }

    public reset(): void {
        this.alertHistory = [];
        this.lastAlertTimestampByKey.clear();
        this.alertCountsByKey.clear();
    }
}

export const defaultAlertManager = new AlertManager();
