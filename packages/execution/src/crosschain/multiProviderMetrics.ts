export interface MultiProviderExecutionMetrics {
  providerFailureCount: number;
  providerSwitchCount: number;
  circuitOpenCount: number;
  circuitRecoveryCount: number;
  rpcLatency: Record<string, number>;
  bridgeApiLatency: number;
  destinationVerificationLatency: number;
  broadcastUncertainCount: number;
  recoveryCount: number;
  lastUpdated: number;
}

/**
 * Structured metrics collector for multi-provider RPC operations, bridge APIs,
 * circuit breaker events, and cross-chain recovery.
 *
 * Security Invariant: Zero secret material is ever ingested or exposed.
 */
export class MultiProviderMetricsCollector {
  private metrics: MultiProviderExecutionMetrics = {
    providerFailureCount: 0,
    providerSwitchCount: 0,
    circuitOpenCount: 0,
    circuitRecoveryCount: 0,
    rpcLatency: {},
    bridgeApiLatency: 0,
    destinationVerificationLatency: 0,
    broadcastUncertainCount: 0,
    recoveryCount: 0,
    lastUpdated: Date.now()
  };

  public recordProviderFailure(_providerId?: string): void {
    this.metrics.providerFailureCount++;
    this.metrics.lastUpdated = Date.now();
  }

  public recordProviderSwitch(): void {
    this.metrics.providerSwitchCount++;
    this.metrics.lastUpdated = Date.now();
  }

  public recordCircuitOpen(): void {
    this.metrics.circuitOpenCount++;
    this.metrics.lastUpdated = Date.now();
  }

  public recordCircuitRecovery(): void {
    this.metrics.circuitRecoveryCount++;
    this.metrics.lastUpdated = Date.now();
  }

  public recordRpcLatency(endpointId: string, latencyMs: number): void {
    this.metrics.rpcLatency[endpointId] = latencyMs;
    this.metrics.lastUpdated = Date.now();
  }

  public recordBridgeApiLatency(latencyMs: number): void {
    this.metrics.bridgeApiLatency = latencyMs;
    this.metrics.lastUpdated = Date.now();
  }

  public recordDestinationVerificationLatency(latencyMs: number): void {
    this.metrics.destinationVerificationLatency = latencyMs;
    this.metrics.lastUpdated = Date.now();
  }

  public recordBroadcastUncertainty(): void {
    this.metrics.broadcastUncertainCount++;
    this.metrics.lastUpdated = Date.now();
  }

  public recordRecovery(): void {
    this.metrics.recoveryCount++;
    this.metrics.lastUpdated = Date.now();
  }

  public getMetrics(): Readonly<MultiProviderExecutionMetrics> {
    return {
      ...this.metrics,
      rpcLatency: { ...this.metrics.rpcLatency }
    };
  }

  public reset(): void {
    this.metrics = {
      providerFailureCount: 0,
      providerSwitchCount: 0,
      circuitOpenCount: 0,
      circuitRecoveryCount: 0,
      rpcLatency: {},
      bridgeApiLatency: 0,
      destinationVerificationLatency: 0,
      broadcastUncertainCount: 0,
      recoveryCount: 0,
      lastUpdated: Date.now()
    };
  }

  public toJSON(): string {
    return JSON.stringify(this.getMetrics());
  }
}

export const defaultMultiProviderMetrics = new MultiProviderMetricsCollector();
