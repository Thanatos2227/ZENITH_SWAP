/**
 * Route Selection Telemetry Logger
 *
 * Implements structured, sanitized observability for route arbitration decisions.
 * CRITICAL SECURITY INVARIANT:
 * Zero private keys, mnemonics, raw signatures, secrets, or credentials may EVER be recorded.
 */

export interface RouteSelectionTelemetryRecord {
  routeSelectionId: string;
  requestId: string;
  candidateCount: number;
  eligibleCandidateCount: number;
  rejectedCandidateCount: number;
  rejectionReasons: string[];
  selectedRouteId: string | null;
  selectedProvider: string | null;
  selectedDex: string | null;
  selectedCapability: string | null;
  selectedMinimumOutputRaw: string | null;
  selectedTotalFeeRaw: string | null;
  selectionTimestamp: number;
  freshnessState: string;
  providerHealthState: string;
}

export class RouteSelectionTelemetryLogger {
  private records: RouteSelectionTelemetryRecord[] = [];
  private maxRecords: number = 500;

  /**
   * Sanitizes strings to guarantee no sensitive data is leaked.
   */
  public sanitize(value: any): any {
    if (typeof value === 'string') {
      // Redact potential private keys (64 hex characters)
      let cleaned = value.replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_KEY]');
      // Redact potential 12/24 word mnemonics or credentials
      cleaned = cleaned.replace(/(key|secret|token|auth|signature|password)=[^&]+/gi, '$1=[REDACTED]');
      return cleaned;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.sanitize(v));
    }
    return value;
  }

  /**
   * Records a route selection arbitration event.
   */
  public record(record: RouteSelectionTelemetryRecord): void {
    const sanitizedRecord: RouteSelectionTelemetryRecord = {
      routeSelectionId: String(record.routeSelectionId),
      requestId: String(record.requestId),
      candidateCount: Number(record.candidateCount) || 0,
      eligibleCandidateCount: Number(record.eligibleCandidateCount) || 0,
      rejectedCandidateCount: Number(record.rejectedCandidateCount) || 0,
      rejectionReasons: (record.rejectionReasons || []).map((r) => this.sanitize(r)),
      selectedRouteId: record.selectedRouteId ? String(record.selectedRouteId) : null,
      selectedProvider: record.selectedProvider ? String(record.selectedProvider) : null,
      selectedDex: record.selectedDex ? String(record.selectedDex) : null,
      selectedCapability: record.selectedCapability ? String(record.selectedCapability) : null,
      selectedMinimumOutputRaw: record.selectedMinimumOutputRaw ? String(record.selectedMinimumOutputRaw) : null,
      selectedTotalFeeRaw: record.selectedTotalFeeRaw ? String(record.selectedTotalFeeRaw) : null,
      selectionTimestamp: record.selectionTimestamp || Date.now(),
      freshnessState: String(record.freshnessState || 'UNKNOWN'),
      providerHealthState: String(record.providerHealthState || 'UNKNOWN')
    };

    this.records.push(sanitizedRecord);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
  }

  public getRecentLogs(limit: number = 50): RouteSelectionTelemetryRecord[] {
    return this.records.slice(-limit);
  }

  public clearLogs(): void {
    this.records = [];
  }

  public getLastRecord(): RouteSelectionTelemetryRecord | undefined {
    return this.records[this.records.length - 1];
  }
}

export const defaultRouteSelectionTelemetry = new RouteSelectionTelemetryLogger();
