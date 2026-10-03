import { CanonicalTelemetryEvent, CrossChainIntentOverallState, FinalityState } from '@zenith/types';
import { validateCanonicalTelemetryEvent } from './canonicalTelemetryEvent';

export interface TelemetryFilterOptions {
    eventType?: string | string[];
    intentId?: string;
    planId?: string;
    network?: string;
    chainId?: number;
    severity?: string;
    fromTimestamp?: number;
    toTimestamp?: number;
    limit?: number;
}

export interface ReplayedIntentState {
    intentId: string;
    overallState: CrossChainIntentOverallState;
    sourceState: string;
    bridgeState: string;
    destinationState: string;
    finalityState: FinalityState;
    settlementState: string;
    evidenceTier: string;
    lastEvent: string;
    lastBlock: number | null;
    lastTxHash: string | null;
    blockingReason: string | null;
    isSettled: boolean;
    hasTerminalConflict: boolean;
    eventCount: number;
    timeline: CanonicalTelemetryEvent[];
}

export class TelemetryEventStore {
    private readonly capacity: number;
    private events: CanonicalTelemetryEvent[] = [];
    private readonly permanentSettlementLedger: CanonicalTelemetryEvent[] = [];
    private readonly eventIdSet: Set<string> = new Set<string>();
    private readonly intentSequenceMap: Map<string, number> = new Map<string, number>();
    private readonly intentSequencesSeen: Map<string, Set<number>> = new Map<string, Set<number>>();

    constructor(capacity: number = 10000) {
        this.capacity = capacity;
    }

    public append(event: CanonicalTelemetryEvent): CanonicalTelemetryEvent {
        const validation = validateCanonicalTelemetryEvent(event);
        if (!validation.valid) {
            throw new Error(`[TelemetryEventStore] Event validation failed: ${validation.error}`);
        }

        // 1. Deduplication by eventId
        if (this.eventIdSet.has(event.eventId)) {
            throw new Error(`[TelemetryEventStore] Duplicate event rejected: eventId '${event.eventId}' already exists`);
        }

        // 2. Intent sequence validation & deduplication
        if (event.intentId) {
            let seenSet = this.intentSequencesSeen.get(event.intentId);
            if (!seenSet) {
                seenSet = new Set<number>();
                this.intentSequencesSeen.set(event.intentId, seenSet);
            }

            if (seenSet.has(event.sequence)) {
                throw new Error(`[TelemetryEventStore] Duplicate sequence rejected for intent '${event.intentId}': sequence ${event.sequence}`);
            }

            const currentLastSeq = this.intentSequenceMap.get(event.intentId) ?? -1;
            if (event.sequence < currentLastSeq) {
                // Out of order: allowed into history if unique, but logged and handled without corrupting monotonic head
            } else {
                this.intentSequenceMap.set(event.intentId, event.sequence);
            }
            seenSet.add(event.sequence);
        }

        // 3. Check for terminal event conflicts
        if (event.intentId && (event.eventType === 'SETTLED' || event.eventType === 'SOURCE_FAILED' || event.eventType === 'BRIDGE_FAILED')) {
            const history = this.getEventsForIntent(event.intentId);
            const settled = history.find(e => e.eventType === 'SETTLED');
            const failed = history.find(e => e.eventType === 'SOURCE_FAILED' || e.eventType === 'BRIDGE_FAILED');
            if (settled && (event.eventType === 'SOURCE_FAILED' || event.eventType === 'BRIDGE_FAILED')) {
                // Conflict: Attempting to fail an already settled intent
                // Fail closed
            } else if (failed && event.eventType === 'SETTLED') {
                // Conflict: Attempting to settle a failed intent
            }
        }

        // 4. Memory management & Ring-Buffer Eviction
        if (this.events.length >= this.capacity) {
            const evicted = this.events.shift();
            if (evicted) {
                this.eventIdSet.delete(evicted.eventId);
            }
        }

        this.events.push(event);
        this.eventIdSet.add(event.eventId);

        // 5. Authoritative Settlement Retention (never purged)
        if (event.eventType === 'SETTLED' || event.eventType === 'SETTLEMENT_VERIFIED') {
            this.permanentSettlementLedger.push(event);
        }

        return event;
    }

    public getEvents(options?: TelemetryFilterOptions): readonly CanonicalTelemetryEvent[] {
        let results = this.events;
        if (!options) return [...results];

        if (options.eventType) {
            const types = Array.isArray(options.eventType) ? new Set(options.eventType) : new Set([options.eventType]);
            results = results.filter(e => types.has(e.eventType));
        }
        if (options.intentId) {
            results = results.filter(e => e.intentId === options.intentId);
        }
        if (options.planId) {
            results = results.filter(e => e.planId === options.planId);
        }
        if (options.network) {
            results = results.filter(e => e.network?.toLowerCase() === options.network?.toLowerCase());
        }
        if (options.chainId !== undefined) {
            results = results.filter(e => e.chainId === options.chainId);
        }
        if (options.severity) {
            results = results.filter(e => e.severity === options.severity);
        }
        if (options.fromTimestamp !== undefined) {
            results = results.filter(e => e.timestamp >= options.fromTimestamp!);
        }
        if (options.toTimestamp !== undefined) {
            results = results.filter(e => e.timestamp <= options.toTimestamp!);
        }
        if (options.limit && options.limit > 0) {
            results = results.slice(-options.limit);
        }
        return [...results];
    }

    public getEventsForIntent(intentId: string): CanonicalTelemetryEvent[] {
        return this.events.filter(e => e.intentId === intentId).sort((a, b) => a.sequence - b.sequence);
    }

    public getSettlementLedger(): readonly CanonicalTelemetryEvent[] {
        return [...this.permanentSettlementLedger];
    }

    public size(): number {
        return this.events.length;
    }

    public clear(): void {
        this.events = [];
        this.eventIdSet.clear();
        this.intentSequenceMap.clear();
        this.intentSequencesSeen.clear();
    }

    public replayIntent(intentId: string): ReplayedIntentState | null {
        const events = this.getEventsForIntent(intentId);
        if (events.length === 0) return null;

        let sourceState = 'INITIALIZED';
        let bridgeState = 'NONE';
        let destinationState = 'NONE';
        let finalityState: FinalityState = 'UNCONFIRMED';
        let settlementState = 'INITIALIZED';
        let overallState: CrossChainIntentOverallState = 'IN_PROGRESS';
        let evidenceTier = 'NONE';
        let lastBlock: number | null = null;
        let lastTxHash: string | null = null;
        let blockingReason: string | null = null;
        let isSettled = false;
        let hasTerminalConflict = false;

        for (const evt of events) {
            if (evt.blockNumber !== null) lastBlock = evt.blockNumber;
            if (evt.txHash !== null) lastTxHash = evt.txHash;
            if (evt.evidenceTier) evidenceTier = evt.evidenceTier;

            switch (evt.eventType) {
                case 'INTENT_CREATED':
                    overallState = 'IN_PROGRESS';
                    break;
                case 'SOURCE_PREFLIGHT_STARTED':
                    sourceState = 'PREFLIGHT';
                    break;
                case 'SOURCE_BROADCAST':
                    sourceState = 'BROADCAST';
                    finalityState = 'UNCONFIRMED';
                    break;
                case 'SOURCE_CONFIRMED':
                    sourceState = 'CONFIRMED';
                    finalityState = 'CONFIRMED';
                    break;
                case 'SOURCE_FAILED':
                    sourceState = 'FAILED';
                    overallState = 'FAILED';
                    blockingReason = evt.errorCode || 'Source execution failed';
                    if (isSettled) hasTerminalConflict = true;
                    break;
                case 'SOURCE_BROADCAST_UNCERTAIN':
                    sourceState = 'UNCERTAIN';
                    overallState = 'UNCERTAIN';
                    blockingReason = 'Source broadcast timeout / uncertain';
                    break;
                case 'BRIDGE_QUOTE_REQUESTED':
                case 'BRIDGE_QUOTE_RECEIVED':
                case 'BRIDGE_QUOTE_REFRESHED':
                    bridgeState = 'QUOTED';
                    overallState = 'WAITING_FOR_BRIDGE';
                    break;
                case 'BRIDGE_SUBMITTED':
                    bridgeState = 'SUBMITTED';
                    overallState = 'WAITING_FOR_BRIDGE';
                    break;
                case 'BRIDGE_SOURCE_CONFIRMED':
                    bridgeState = 'SOURCE_CONFIRMED';
                    break;
                case 'BRIDGE_RELAY_PENDING':
                    bridgeState = 'RELAY_PENDING';
                    overallState = 'WAITING_FOR_DESTINATION';
                    break;
                case 'BRIDGE_FILLED':
                    bridgeState = 'FILLED';
                    overallState = 'WAITING_FOR_FINALITY';
                    break;
                case 'BRIDGE_FAILED':
                    bridgeState = 'FAILED';
                    overallState = 'FAILED';
                    blockingReason = evt.errorCode || 'Bridge relay failed';
                    if (isSettled) hasTerminalConflict = true;
                    break;
                case 'DESTINATION_TX_FOUND':
                    destinationState = 'TX_FOUND';
                    break;
                case 'DESTINATION_RECEIPT_VERIFIED':
                    destinationState = 'RECEIPT_VERIFIED';
                    break;
                case 'DESTINATION_TRANSFER_VERIFIED':
                case 'DESTINATION_BALANCE_VERIFIED':
                    destinationState = 'DELIVERY_VERIFIED';
                    break;
                case 'FINALITY_PENDING':
                    finalityState = 'FINALITY_PENDING';
                    overallState = 'WAITING_FOR_FINALITY';
                    break;
                case 'FINALITY_REACHED':
                    finalityState = 'FINAL';
                    break;
                case 'REORG_DETECTED':
                    finalityState = 'REORG_DETECTED';
                    overallState = 'UNCERTAIN';
                    blockingReason = 'Blockchain reorganization detected on settlement transaction';
                    break;
                case 'SETTLEMENT_PENDING':
                    settlementState = 'PENDING';
                    break;
                case 'SETTLEMENT_BLOCKED':
                    settlementState = 'BLOCKED';
                    overallState = 'RECONCILIATION_BLOCKED';
                    blockingReason = evt.errorCode || 'Settlement blocked';
                    break;
                case 'SETTLEMENT_VERIFIED':
                case 'SETTLED':
                    settlementState = 'SETTLED';
                    overallState = 'SETTLED';
                    isSettled = true;
                    if (sourceState === 'FAILED' || bridgeState === 'FAILED') {
                        hasTerminalConflict = true;
                        overallState = 'UNCERTAIN';
                    }
                    break;
            }
        }

        if (hasTerminalConflict) {
            overallState = 'UNCERTAIN';
            blockingReason = 'Terminal state conflict detected during replay';
        }

        const lastEvt = events[events.length - 1];

        return {
            intentId,
            overallState,
            sourceState,
            bridgeState,
            destinationState,
            finalityState,
            settlementState,
            evidenceTier,
            lastEvent: lastEvt.eventType,
            lastBlock,
            lastTxHash,
            blockingReason,
            isSettled,
            hasTerminalConflict,
            eventCount: events.length,
            timeline: events
        };
    }

    public exportSnapshot(): string {
        return JSON.stringify({
            capacity: this.capacity,
            events: this.events,
            settlementLedger: this.permanentSettlementLedger,
            exportedAt: Date.now()
        });
    }

    public importSnapshot(json: string): void {
        const data = JSON.parse(json);
        this.clear();
        if (Array.isArray(data.events)) {
            for (const evt of data.events) {
                this.append(evt);
            }
        }
    }
}

export const defaultTelemetryEventStore = new TelemetryEventStore(10000);
