import { CanonicalTelemetryEvent, CanonicalTelemetryEventType, TelemetrySeverity } from '@zenith/types';

export const VALID_CANONICAL_EVENT_TYPES: ReadonlySet<CanonicalTelemetryEventType> = new Set<CanonicalTelemetryEventType>([
    'SYSTEM_STARTED',
    'SYSTEM_HEALTH_CHANGED',
    'RPC_HEALTH_CHANGED',
    'RPC_DISAGREEMENT_DETECTED',
    'RPC_CIRCUIT_OPENED',
    'RPC_CIRCUIT_RECOVERED',
    'NETWORK_VERIFIED',
    'NETWORK_CAPABILITY_CHANGED',
    'DEX_CAPABILITY_CHANGED',
    'TOKEN_CAPABILITY_CHANGED',
    'ROUTE_DISCOVERY_STARTED',
    'ROUTE_DISCOVERY_COMPLETED',
    'ROUTE_REJECTED',
    'ROUTE_SELECTED',
    'ROUTE_ARBITRATION_COMPLETED',
    'QUOTE_REQUESTED',
    'QUOTE_RECEIVED',
    'QUOTE_REJECTED',
    'QUOTE_EXPIRED',
    'INTENT_CREATED',
    'INTENT_VALIDATED',
    'PLAN_CREATED',
    'PLAN_SEALED',
    'SOURCE_PREFLIGHT_STARTED',
    'SOURCE_PREFLIGHT_COMPLETED',
    'SOURCE_BROADCAST',
    'SOURCE_CONFIRMED',
    'SOURCE_FAILED',
    'SOURCE_BROADCAST_UNCERTAIN',
    'ACTUAL_OUTPUT_EXTRACTED',
    'BRIDGE_QUOTE_REQUESTED',
    'BRIDGE_QUOTE_RECEIVED',
    'BRIDGE_QUOTE_REFRESHED',
    'BRIDGE_SUBMITTED',
    'BRIDGE_SOURCE_CONFIRMED',
    'BRIDGE_RELAY_PENDING',
    'BRIDGE_FILLED',
    'BRIDGE_FAILED',
    'BRIDGE_UNCERTAIN',
    'DESTINATION_TX_FOUND',
    'DESTINATION_RECEIPT_VERIFIED',
    'DESTINATION_TRANSFER_VERIFIED',
    'DESTINATION_BALANCE_VERIFIED',
    'FINALITY_PENDING',
    'FINALITY_REACHED',
    'REORG_DETECTED',
    'SETTLEMENT_PENDING',
    'SETTLEMENT_VERIFIED',
    'SETTLEMENT_BLOCKED',
    'SETTLED',
    'RECOVERY_STARTED',
    'RECOVERY_COMPLETED',
    'IDEMPOTENCY_BLOCKED',
    'ERROR_RAISED'
]);

export const VALID_SEVERITIES: ReadonlySet<TelemetrySeverity> = new Set<TelemetrySeverity>([
    'INFO',
    'WARNING',
    'ERROR',
    'CRITICAL'
]);

export function scrubTelemetrySecrets(input: string): string {
    if (!input) return input;
    return input
        .replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_SECRET]')
        .replace(/(?:private[_-]?key|secret|password|bearer|api[_-]?key)[\s:=]+([^\s,;]+)/gi, '$1:[REDACTED_SECRET]');
}

export function validateCanonicalTelemetryEvent(event: CanonicalTelemetryEvent): { valid: boolean; error?: string } {
    if (!event) return { valid: false, error: 'Event object is undefined or null' };
    if (!event.eventId || typeof event.eventId !== 'string' || event.eventId.trim().length === 0) {
        return { valid: false, error: 'Invalid or missing eventId' };
    }
    if (!VALID_CANONICAL_EVENT_TYPES.has(event.eventType)) {
        return { valid: false, error: `Unsupported eventType: ${String(event.eventType)}` };
    }
    if (typeof event.timestamp !== 'number' || isNaN(event.timestamp) || event.timestamp <= 0) {
        return { valid: false, error: 'Invalid timestamp: must be positive numeric epoch ms' };
    }
    if (typeof event.sequence !== 'number' || isNaN(event.sequence) || event.sequence < 0) {
        return { valid: false, error: 'Invalid sequence: must be non-negative integer' };
    }
    if (!event.source || typeof event.source !== 'string') {
        return { valid: false, error: 'Invalid or missing source string' };
    }
    if (!VALID_SEVERITIES.has(event.severity)) {
        return { valid: false, error: `Invalid severity: ${String(event.severity)}` };
    }
    if (event.chainId !== null && event.chainId !== undefined && (typeof event.chainId !== 'number' || isNaN(event.chainId) || event.chainId <= 0)) {
        return { valid: false, error: 'Invalid chainId: must be positive integer or null' };
    }
    if (event.latency !== null && event.latency !== undefined && (typeof event.latency !== 'number' || isNaN(event.latency) || event.latency < 0)) {
        return { valid: false, error: 'Invalid latency: must be non-negative number or null' };
    }
    if (event.blockNumber !== null && event.blockNumber !== undefined && (typeof event.blockNumber !== 'number' || isNaN(event.blockNumber) || event.blockNumber < 0)) {
        return { valid: false, error: 'Invalid blockNumber: must be non-negative number or null' };
    }
    return { valid: true };
}

let globalSequenceCounter = 0;

export function createCanonicalTelemetryEvent(params: {
    eventType: CanonicalTelemetryEventType;
    source: string;
    sequence?: number;
    network?: string | null;
    chainId?: number | null;
    intentId?: string | null;
    planId?: string | null;
    stepId?: string | null;
    routeId?: string | null;
    provider?: string | null;
    state?: string | null;
    previousState?: string | null;
    newState?: string | null;
    evidenceTier?: string | null;
    blockNumber?: number | null;
    txHash?: string | null;
    latency?: number | null;
    errorCode?: string | null;
    severity?: TelemetrySeverity;
    timestamp?: number;
    eventId?: string;
}): CanonicalTelemetryEvent {
    const timestamp = params.timestamp ?? Date.now();
    const sequence = params.sequence !== undefined ? params.sequence : ++globalSequenceCounter;
    const eventId = params.eventId ?? `evt-${params.eventType.toLowerCase()}-${timestamp}-${sequence}`;
    
    const event: CanonicalTelemetryEvent = {
        eventId: scrubTelemetrySecrets(eventId),
        eventType: params.eventType,
        timestamp,
        sequence,
        source: scrubTelemetrySecrets(params.source),
        network: params.network ? scrubTelemetrySecrets(params.network) : null,
        chainId: params.chainId !== undefined ? params.chainId : null,
        intentId: params.intentId ? scrubTelemetrySecrets(params.intentId) : null,
        planId: params.planId ? scrubTelemetrySecrets(params.planId) : null,
        stepId: params.stepId ? scrubTelemetrySecrets(params.stepId) : null,
        routeId: params.routeId ? scrubTelemetrySecrets(params.routeId) : null,
        provider: params.provider ? scrubTelemetrySecrets(params.provider) : null,
        state: params.state ? scrubTelemetrySecrets(params.state) : null,
        previousState: params.previousState ? scrubTelemetrySecrets(params.previousState) : null,
        newState: params.newState ? scrubTelemetrySecrets(params.newState) : null,
        evidenceTier: params.evidenceTier ? scrubTelemetrySecrets(params.evidenceTier) : null,
        blockNumber: params.blockNumber !== undefined ? params.blockNumber : null,
        txHash: params.txHash ? scrubTelemetrySecrets(params.txHash) : null,
        latency: params.latency !== undefined ? params.latency : null,
        errorCode: params.errorCode ? scrubTelemetrySecrets(params.errorCode) : null,
        severity: params.severity ?? 'INFO'
    };

    const validation = validateCanonicalTelemetryEvent(event);
    if (!validation.valid) {
        throw new Error(`[ZENITH Telemetry] Invalid CanonicalTelemetryEvent: ${validation.error}`);
    }

    return Object.freeze(event);
}
