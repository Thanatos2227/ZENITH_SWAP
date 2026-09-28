import { SettlementTelemetryRecord } from '@zenith/types';
function sanitizeSecrets(str: string): string {
    return str.replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_SECRET]');
}
export class SettlementTelemetry {
    private static instance: SettlementTelemetry | null = null;
    private records: SettlementTelemetryRecord[] = [];
    private readonly maxBufferSize = 1000;
    public static getInstance(): SettlementTelemetry {
        if (!SettlementTelemetry.instance) {
            SettlementTelemetry.instance = new SettlementTelemetry();
        }
        return SettlementTelemetry.instance;
    }
    public record(entry: Omit<SettlementTelemetryRecord, 'timestamp'> & {
        timestamp?: number;
    }): SettlementTelemetryRecord {
        const sanitizedRecord: SettlementTelemetryRecord = {
            planId: sanitizeSecrets(String(entry.planId || '')),
            intentId: sanitizeSecrets(String(entry.intentId || '')),
            stepId: entry.stepId ? sanitizeSecrets(String(entry.stepId)) : undefined,
            sourceChainId: entry.sourceChainId,
            destinationChainId: entry.destinationChainId,
            destinationTxHash: String(entry.destinationTxHash || ''),
            destinationBlockHash: entry.destinationBlockHash ? String(entry.destinationBlockHash) : undefined,
            destinationBlockNumber: entry.destinationBlockNumber !== undefined ? Number(entry.destinationBlockNumber) : undefined,
            confirmations: entry.confirmations !== undefined ? Number(entry.confirmations) : undefined,
            requiredConfirmations: entry.requiredConfirmations !== undefined ? Number(entry.requiredConfirmations) : undefined,
            expectedRecipient: String(entry.expectedRecipient || '').toLowerCase(),
            actualRecipient: entry.actualRecipient ? String(entry.actualRecipient).toLowerCase() : undefined,
            expectedToken: String(entry.expectedToken || '').toLowerCase(),
            actualToken: entry.actualToken ? String(entry.actualToken).toLowerCase() : undefined,
            expectedMinAmount: String(entry.expectedMinAmount || '0'),
            actualDeliveredAmount: entry.actualDeliveredAmount ? String(entry.actualDeliveredAmount) : undefined,
            primaryEvidenceTier: String(entry.primaryEvidenceTier || 'NONE'),
            evidenceSource: String(entry.evidenceSource || 'UNKNOWN'),
            verificationResult: entry.verificationResult,
            reorgDetected: Boolean(entry.reorgDetected),
            conflictReason: entry.conflictReason ? sanitizeSecrets(String(entry.conflictReason)) : undefined,
            timestamp: entry.timestamp || Date.now()
        };
        if (this.records.length >= this.maxBufferSize) {
            this.records.shift();
        }
        this.records.push(sanitizedRecord);
        return sanitizedRecord;
    }
    public getRecords(): readonly SettlementTelemetryRecord[] {
        return [...this.records];
    }
    public getLatestRecord(): SettlementTelemetryRecord | null {
        if (this.records.length === 0)
            return null;
        return this.records[this.records.length - 1];
    }
    public clear(): void {
        this.records = [];
    }
}
export const defaultSettlementTelemetry = SettlementTelemetry.getInstance();
