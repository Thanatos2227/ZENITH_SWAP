import { EconomicTelemetryRecord } from '@zenith/types';

export class EconomicTelemetry {
  private static instance: EconomicTelemetry | null = null;
  private records: EconomicTelemetryRecord[] = [];
  private readonly maxBufferSize = 1000;

  public static getInstance(): EconomicTelemetry {
    if (!EconomicTelemetry.instance) {
      EconomicTelemetry.instance = new EconomicTelemetry();
    }
    return EconomicTelemetry.instance;
  }

  public record(entry: Omit<EconomicTelemetryRecord, 'timestamp'> & { timestamp?: number }): EconomicTelemetryRecord {
    const sanitizedRecord: EconomicTelemetryRecord = {
      planId: String(entry.planId || ''),
      routeId: String(entry.routeId || ''),
      stepId: entry.stepId ? String(entry.stepId) : undefined,
      inputAmount: String(entry.inputAmount || '0'),
      expectedOutput: String(entry.expectedOutput || '0'),
      minimumOutput: String(entry.minimumOutput || '0'),
      actualOutput: entry.actualOutput !== undefined ? String(entry.actualOutput) : undefined,
      feeCategory: String(entry.feeCategory || 'STANDARD'),
      totalFeeRaw: String(entry.totalFeeRaw || '0'),
      quoteAgeMs: Number(entry.quoteAgeMs || 0),
      provider: String(entry.provider || 'UNKNOWN'),
      sourceChainId: entry.sourceChainId,
      destinationChainId: entry.destinationChainId,
      tokenInAddress: String(entry.tokenInAddress || '').toLowerCase(),
      tokenOutAddress: String(entry.tokenOutAddress || '').toLowerCase(),
      timestamp: entry.timestamp || Date.now(),
      status: entry.status,
      violationReason: entry.violationReason ? String(entry.violationReason) : undefined
    };

    if (this.records.length >= this.maxBufferSize) {
      this.records.shift();
    }
    this.records.push(sanitizedRecord);

    return sanitizedRecord;
  }

  public getRecords(): readonly EconomicTelemetryRecord[] {
    return [...this.records];
  }

  public getLatestRecord(): EconomicTelemetryRecord | null {
    if (this.records.length === 0) return null;
    return this.records[this.records.length - 1];
  }

  public clear(): void {
    this.records = [];
  }
}

export const defaultEconomicTelemetry = EconomicTelemetry.getInstance();
