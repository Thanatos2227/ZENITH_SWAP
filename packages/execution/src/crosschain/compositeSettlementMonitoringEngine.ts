/**
 * @file compositeSettlementMonitoringEngine.ts
 * @package @zenith/execution
 *
 * ZENITH — PHASE 2 TASK 51
 * Authoritative Cross-Chain Intent & Composite Settlement Monitoring Engine.
 *
 * Unifies the complete cross-chain execution & settlement monitoring lifecycle:
 * USER INTENT -> ROUTE ARBITRATION -> EXECUTION PLAN -> SOURCE EXECUTION ->
 * ACTUAL SOURCE OUTPUT -> BRIDGE EXECUTION -> BRIDGE RELAY / TRACKING ->
 * DESTINATION ARRIVAL -> DESTINATION EXECUTION -> DESTINATION RECEIPT ->
 * TRANSFER / BALANCE EVIDENCE -> FINALITY -> SETTLEMENT
 *
 * Invariants:
 * 1. Strict 6-Tier Evidence Hierarchy: Tier 5 (Provider API) alone CANNOT settle an intent.
 * 2. Actual Amount Propagation: Actual mined source output propagates into refreshed bridge quotes.
 * 3. Network-Aware Finality: Reorg detection immediately revokes unconfirmed settlement.
 * 4. Pure BigInt raw-unit integer arithmetic (zero floating-point).
 * 5. Fail-closed conflict handling: Any unresolved mismatch halts settlement.
 * 6. Zero secret / private key exposure in logging or telemetry.
 */

import { sha256, toUtf8Bytes } from 'ethers';
import type {
  CanonicalCrossChainIntent,
  SourceSwapStepState,
  BridgeStepState,
  DestinationSwapStepState,
  DestinationVerificationStepState,
  SettlementStepState,
  FinalityState,
  CompositeOverallState,
  NormalizedMonitoringErrorCode,
  AmountTransitionAuditRecord,
  MonitoringApiStatusResponse,
  CompositeTelemetryEvent
} from '@zenith/types';
import {
  verifyDestinationSettlement,
  DestinationEvidenceTier
} from './authoritativeDestinationVerifier';
import { defaultSettlementTelemetry } from './settlementTelemetry';

export interface CompositeMonitoringRecord {
  intent: CanonicalCrossChainIntent;
  overallState: CompositeOverallState;
  sourceSwapState: SourceSwapStepState;
  bridgeState: BridgeStepState;
  destinationSwapState: DestinationSwapStepState;
  destinationVerificationState: DestinationVerificationStepState;
  settlementState: SettlementStepState;
  finalityState: FinalityState;
  sourceTxHash: string | null;
  sourceBlockNumber: number | null;
  actualSourceOutputRaw: bigint | null;
  refreshedBridgeAmountRaw: bigint | null;
  bridgeSourceTxHash: string | null;
  bridgeFillTxHash: string | null;
  bridgeProviderReportedFilled: boolean;
  destinationTxHash: string | null;
  destinationBlockNumber: number | null;
  actualDestinationOutputRaw: bigint | null;
  destinationRecipientDelivered: string | null;
  primaryEvidenceTier: DestinationEvidenceTier | 'NONE';
  reorgDetected: boolean;
  errorCode: NormalizedMonitoringErrorCode | null;
  blockingReason: string | null;
  amountAuditTrail: AmountTransitionAuditRecord[];
  createdAt: number;
  updatedAt: number;
}

export function computeCanonicalIntentId(params: {
  sourceChainId: number | string;
  destinationChainId: number | string;
  inputTokenAddress: string;
  requestedOutputTokenAddress: string;
  inputAmountRaw: bigint;
  minimumOutputRaw: bigint;
  recipient: string;
  planHash: string;
  semanticHash: string;
  createdAt: number;
}): string {
  const preimage = [
    String(params.sourceChainId).toLowerCase(),
    String(params.destinationChainId).toLowerCase(),
    params.inputTokenAddress.toLowerCase(),
    params.requestedOutputTokenAddress.toLowerCase(),
    params.inputAmountRaw.toString(),
    params.minimumOutputRaw.toString(),
    params.recipient.toLowerCase(),
    params.planHash,
    params.semanticHash,
    params.createdAt.toString()
  ].join('|');

  return sha256(toUtf8Bytes(preimage));
}

export class CompositeSettlementMonitoringEngine {
  private records: Map<string, CompositeMonitoringRecord> = new Map();
  private telemetryEvents: CompositeTelemetryEvent[] = [];

  /**
   * Registers a new canonical cross-chain intent. Fails closed on invalid inputs or replay.
   */
  public registerIntent(intent: CanonicalCrossChainIntent): CompositeMonitoringRecord {
    if (!intent.intentId || intent.intentId.trim() === '') {
      throw new Error('[CompositeMonitoring] Invalid intent: missing intentId');
    }
    if (intent.inputAmountRaw <= 0n) {
      throw new Error('[CompositeMonitoring] Invalid intent: inputAmountRaw must be > 0');
    }
    if (intent.minimumOutputRaw <= 0n) {
      throw new Error('[CompositeMonitoring] Invalid intent: minimumOutputRaw must be > 0');
    }
    if (!intent.recipient || intent.recipient.trim() === '') {
      throw new Error('[CompositeMonitoring] Invalid intent: recipient address required');
    }
    if (this.records.has(intent.intentId)) {
      throw new Error(`[CompositeMonitoring] Duplicate intent registration rejected: ${intent.intentId}`);
    }

    const now = Date.now();
    const isComposite = intent.routeType === 'COMPOSITE_CROSS_CHAIN';

    const record: CompositeMonitoringRecord = {
      intent: { ...intent },
      overallState: 'READY',
      sourceSwapState: isComposite ? 'PLANNED' : 'CONFIRMED',
      bridgeState: 'PLANNED',
      destinationSwapState: isComposite && intent.destinationExecutionMode === 'BRIDGE_AND_SWAP' ? 'PLANNED' : 'NOT_APPLICABLE',
      destinationVerificationState: 'NOT_STARTED',
      settlementState: 'PENDING',
      finalityState: 'UNCONFIRMED',
      sourceTxHash: null,
      sourceBlockNumber: null,
      actualSourceOutputRaw: null,
      refreshedBridgeAmountRaw: isComposite ? null : intent.inputAmountRaw,
      bridgeSourceTxHash: null,
      bridgeFillTxHash: null,
      bridgeProviderReportedFilled: false,
      destinationTxHash: null,
      destinationBlockNumber: null,
      actualDestinationOutputRaw: null,
      destinationRecipientDelivered: null,
      primaryEvidenceTier: 'NONE',
      reorgDetected: false,
      errorCode: null,
      blockingReason: null,
      amountAuditTrail: [
        {
          stage: 'INTENT_INITIAL',
          token: intent.inputToken.symbol,
          chainId: intent.sourceChainId,
          expectedAmountRaw: intent.inputAmountRaw,
          actualAmountRaw: intent.inputAmountRaw,
          deltaRaw: 0n,
          timestamp: now
        }
      ],
      createdAt: now,
      updatedAt: now
    };

    this.records.set(intent.intentId, record);
    this.emitTelemetry(record, 'INTENT_REGISTERED', 'READY', 'TIER_6_LOCAL_CACHE');
    return record;
  }

  /**
   * Records source swap execution and propagates actual mined output.
   */
  public recordSourceSwapExecution(params: {
    intentId: string;
    txHash: string;
    blockNumber: number;
    status: 'SUCCESS' | 'REVERTED' | 'BROADCAST_UNCERTAIN';
    actualOutputRaw?: bigint;
  }): CompositeMonitoringRecord {
    const record = this.mustGetRecord(params.intentId);
    const now = Date.now();

    if (params.status === 'BROADCAST_UNCERTAIN') {
      record.sourceSwapState = 'BROADCAST_UNCERTAIN';
      record.overallState = 'UNCERTAIN';
      record.errorCode = 'SOURCE_BROADCAST_UNCERTAIN';
      record.blockingReason = 'Source swap broadcast status is uncertain; halting automatic retries fail-closed.';
      record.updatedAt = now;
      this.emitTelemetry(record, 'SOURCE_SWAP_UNCERTAIN', 'UNCERTAIN', 'TIER_2_ONCHAIN_TX_LOOKUP', params.txHash);
      return record;
    }

    if (params.status === 'REVERTED') {
      record.sourceSwapState = 'FAILED';
      record.overallState = 'FAILED';
      record.errorCode = 'SOURCE_EXECUTION_FAILED';
      record.blockingReason = 'Source swap transaction reverted on-chain.';
      record.updatedAt = now;
      this.emitTelemetry(record, 'SOURCE_SWAP_FAILED', 'FAILED', 'TIER_1_ONCHAIN_RECEIPT', params.txHash);
      return record;
    }

    // Success
    record.sourceSwapState = 'CONFIRMED';
    record.sourceTxHash = params.txHash;
    record.sourceBlockNumber = params.blockNumber;
    record.actualSourceOutputRaw = params.actualOutputRaw ?? record.intent.inputAmountRaw;
    record.refreshedBridgeAmountRaw = record.actualSourceOutputRaw;
    record.overallState = 'SOURCE_CONFIRMED';
    record.updatedAt = now;

    record.amountAuditTrail.push({
      stage: 'SOURCE_SWAP_CONFIRMED',
      token: record.intent.inputToken.symbol,
      chainId: record.intent.sourceChainId,
      expectedAmountRaw: record.intent.inputAmountRaw,
      actualAmountRaw: record.actualSourceOutputRaw,
      deltaRaw: record.actualSourceOutputRaw - record.intent.inputAmountRaw,
      timestamp: now
    });

    this.emitTelemetry(record, 'SOURCE_SWAP_CONFIRMED', 'SOURCE_CONFIRMED', 'TIER_1_ONCHAIN_RECEIPT', params.txHash);
    return record;
  }

  /**
   * Records bridge transaction submission and relay progress.
   */
  public recordBridgeSubmission(params: {
    intentId: string;
    sourceTxHash: string;
    provider: string;
    status: 'SUBMITTED' | 'SOURCE_CONFIRMED' | 'RELAY_PENDING' | 'FAILED' | 'BROADCAST_UNCERTAIN';
  }): CompositeMonitoringRecord {
    const record = this.mustGetRecord(params.intentId);
    const now = Date.now();

    if (params.status === 'BROADCAST_UNCERTAIN') {
      record.bridgeState = 'UNCERTAIN';
      record.overallState = 'UNCERTAIN';
      record.errorCode = 'BRIDGE_BROADCAST_UNCERTAIN';
      record.blockingReason = 'Bridge submission broadcast is uncertain; halting automatic retries.';
      record.updatedAt = now;
      this.emitTelemetry(record, 'BRIDGE_SUBMISSION_UNCERTAIN', 'UNCERTAIN', 'TIER_2_ONCHAIN_TX_LOOKUP', params.sourceTxHash);
      return record;
    }

    if (params.status === 'FAILED') {
      record.bridgeState = 'FAILED';
      record.overallState = 'FAILED';
      record.errorCode = 'BRIDGE_SUBMISSION_FAILED';
      record.blockingReason = 'Bridge transaction failed or rejected by relayer.';
      record.updatedAt = now;
      this.emitTelemetry(record, 'BRIDGE_SUBMISSION_FAILED', 'FAILED', 'TIER_1_ONCHAIN_RECEIPT', params.sourceTxHash);
      return record;
    }

    record.bridgeState = params.status === 'RELAY_PENDING' ? 'RELAY_PENDING' : 'SOURCE_CONFIRMED';
    record.bridgeSourceTxHash = params.sourceTxHash;
    record.overallState = 'BRIDGE_PENDING';
    record.updatedAt = now;

    this.emitTelemetry(record, 'BRIDGE_RELAY_PENDING', 'BRIDGE_PENDING', 'TIER_5_PROVIDER_API', params.sourceTxHash);
    return record;
  }

  /**
   * Records bridge provider status update.
   * STRICT AXIOM: A bridge provider API reporting 'FILLED' alone does NOT settle the intent.
   * It is mapped to BRIDGE_FILLED with primaryEvidenceTier = TIER_5_PROVIDER_API.
   */
  public recordBridgeProviderProgress(params: {
    intentId: string;
    providerState: 'PENDING' | 'FILLED' | 'REFUNDED' | 'FAILED';
    providerFillTx?: string;
  }): CompositeMonitoringRecord {
    const record = this.mustGetRecord(params.intentId);
    const now = Date.now();

    if (params.providerState === 'FILLED') {
      record.bridgeState = 'FILLED';
      record.bridgeProviderReportedFilled = true;
      record.bridgeFillTxHash = params.providerFillTx ?? null;
      record.overallState = 'BRIDGE_FILLED';
      record.updatedAt = now;

      this.emitTelemetry(record, 'BRIDGE_PROVIDER_REPORTED_FILLED', 'BRIDGE_FILLED', 'TIER_5_PROVIDER_API', params.providerFillTx);
      return record;
    }

    if (params.providerState === 'FAILED' || params.providerState === 'REFUNDED') {
      record.bridgeState = 'FAILED';
      record.overallState = 'FAILED';
      record.errorCode = 'BRIDGE_FILL_UNCONFIRMED';
      record.blockingReason = `Bridge provider reported terminal state: ${params.providerState}`;
      record.updatedAt = now;

      this.emitTelemetry(record, 'BRIDGE_PROVIDER_FAILED', 'FAILED', 'TIER_5_PROVIDER_API');
      return record;
    }

    return record;
  }

  /**
   * Authoritatively reconciles destination arrival, execution receipts, token logs, balance deltas, and finality.
   */
  public reconcileDestinationSettlement(params: {
    intentId: string;
    destinationTxHash?: string;
    receipt?: {
      status: number | string;
      blockNumber: number;
      blockHash?: string;
      gasUsed?: string | bigint;
      logs?: Array<{ address: string; topics: string[]; data: string }>;
    } | null;
    transaction?: {
      hash: string;
      from: string;
      to: string;
      chainId?: number | bigint | string;
    } | null;
    currentBlockNumber?: number;
    requiredConfirmations?: number;
    currentBalanceRaw?: bigint;
    preBridgeBalanceRaw?: bigint;
  }): CompositeMonitoringRecord {
    const record = this.mustGetRecord(params.intentId);
    const now = Date.now();

    // Invoke authoritative destination verifier
    const verification = verifyDestinationSettlement({
      destinationChainId: record.intent.destinationChainId,
      destinationTxHash: params.destinationTxHash ?? record.bridgeFillTxHash,
      expectedRecipient: record.intent.recipient,
      expectedToken: record.intent.requestedOutputToken.address || '',
      expectedMinAmountRaw: record.intent.minimumOutputRaw,
      currentBlockNumber: params.currentBlockNumber,
      requiredConfirmations: params.requiredConfirmations ?? 1,
      providerStatus: record.bridgeProviderReportedFilled ? 'FILLED' : null,
      providerFillTx: record.bridgeFillTxHash,
      bridgeProvider: record.intent.bridgeProvider,
      preBridgeBalanceRaw: params.preBridgeBalanceRaw,
      receipt: params.receipt,
      transaction: params.transaction,
      currentBalanceRaw: params.currentBalanceRaw,
      intentId: record.intent.intentId
    });

    record.primaryEvidenceTier = verification.primaryEvidenceTier;

    // Fail-Closed Conflict Evaluator
    if (verification.settlementStatus === 'STATUS_CONFLICT') {
      record.overallState = 'RECONCILIATION_BLOCKED';
      record.settlementState = 'SETTLEMENT_BLOCKED';
      record.errorCode = 'RECONCILIATION_CONFLICT';
      record.blockingReason = verification.conflictReason || 'Cross-chain evidence conflict detected; halting fail-closed.';
      record.updatedAt = now;
      this.emitTelemetry(record, 'RECONCILIATION_CONFLICT', 'RECONCILIATION_BLOCKED', verification.primaryEvidenceTier);
      return record;
    }

    if (verification.settlementStatus === 'REORG_DETECTED') {
      record.reorgDetected = true;
      record.finalityState = 'REORG_DETECTED';
      record.overallState = 'RECONCILIATION_BLOCKED';
      record.settlementState = 'SETTLEMENT_BLOCKED';
      record.errorCode = 'REORG_DETECTED';
      record.blockingReason = 'Destination reorg detected; block/receipt invalidated.';
      record.updatedAt = now;
      this.emitTelemetry(record, 'REORG_DETECTED', 'RECONCILIATION_BLOCKED', verification.primaryEvidenceTier);
      return record;
    }

    if (verification.settlementStatus === 'DESTINATION_FAILED') {
      record.overallState = 'FAILED';
      record.settlementState = 'SETTLEMENT_BLOCKED';
      record.errorCode = 'DESTINATION_RECEIPT_FAILED';
      record.blockingReason = verification.revertReason || 'Destination transaction reverted or failed execution.';
      record.updatedAt = now;
      this.emitTelemetry(record, 'DESTINATION_FAILED', 'FAILED', verification.primaryEvidenceTier);
      return record;
    }

    // Update intermediate destination verification step states
    if (verification.actualDeliveredAmountRaw) {
      record.actualDestinationOutputRaw = BigInt(verification.actualDeliveredAmountRaw);
      record.destinationRecipientDelivered = record.intent.recipient;

      record.amountAuditTrail.push({
        stage: 'DESTINATION_SETTLEMENT_CONFIRMED',
        token: record.intent.requestedOutputToken.symbol,
        chainId: record.intent.destinationChainId,
        expectedAmountRaw: record.intent.minimumOutputRaw,
        actualAmountRaw: record.actualDestinationOutputRaw,
        deltaRaw: record.actualDestinationOutputRaw - record.intent.minimumOutputRaw,
        timestamp: now
      });
    }

    if (params.destinationTxHash) {
      record.destinationTxHash = params.destinationTxHash;
      record.destinationVerificationState = 'TX_FOUND';
    }

    if (params.receipt && params.receipt.status === 1) {
      record.destinationVerificationState = 'RECEIPT_VERIFIED';
      record.destinationBlockNumber = params.receipt.blockNumber;
    }

    if (verification.deliveredToExpectedRecipient && verification.tokenMatched) {
      record.destinationVerificationState = 'TRANSFER_VERIFIED';
    }

    // Finality Evaluation
    if (verification.isFinalized) {
      record.finalityState = 'FINAL';
      record.destinationVerificationState = 'FINALITY_VERIFIED';
    } else if (verification.confirmations && verification.confirmations > 0) {
      record.finalityState = 'FINALITY_PENDING';
    }

    // Authoritative Settlement Promotion: Requires Tier 1, 3, or 4 on-chain proof
    const isAuthoritativeOnChainSettled =
      verification.settlementStatus === 'DESTINATION_SETTLED' &&
      (verification.primaryEvidenceTier === 'TIER_1_ONCHAIN_RECEIPT' ||
        verification.primaryEvidenceTier === 'TIER_3_ERC20_TRANSFER_EVENT' ||
        verification.primaryEvidenceTier === 'TIER_4_RECIPIENT_BALANCE_DELTA');

    if (isAuthoritativeOnChainSettled && record.finalityState === 'FINAL') {
      record.settlementState = 'SETTLED';
      record.overallState = 'SETTLED';
      record.blockingReason = null;
      record.errorCode = null;
      record.updatedAt = now;
      this.emitTelemetry(record, 'SETTLEMENT_FINALIZED', 'SETTLED', verification.primaryEvidenceTier, params.destinationTxHash);
    } else if (isAuthoritativeOnChainSettled) {
      record.overallState = 'FINALITY_PENDING';
      record.settlementState = 'VERIFIED';
      record.updatedAt = now;
      this.emitTelemetry(record, 'SETTLEMENT_VERIFIED_AWAITING_FINALITY', 'FINALITY_PENDING', verification.primaryEvidenceTier);
    } else {
      // Provider reported filled but unconfirmed on-chain
      record.overallState = 'DESTINATION_CONFIRMING';
      record.settlementState = 'PENDING';
      record.updatedAt = now;
    }

    return record;
  }

  /**
   * Retrieves full monitoring status for API consumers.
   */
  public getMonitoringStatus(intentId: string): MonitoringApiStatusResponse | undefined {
    const record = this.records.get(intentId);
    if (!record) return undefined;

    return {
      intentId: record.intent.intentId,
      planId: record.intent.executionPlanId,
      overallState: record.overallState,
      source: {
        state: record.sourceSwapState,
        txHash: record.sourceTxHash,
        confirmationState: record.sourceBlockNumber ? `CONFIRMED_AT_BLOCK_${record.sourceBlockNumber}` : 'PENDING',
        actualOutputRaw: record.actualSourceOutputRaw?.toString()
      },
      bridge: {
        provider: record.intent.bridgeProvider,
        state: record.bridgeState,
        evidenceTier: record.bridgeProviderReportedFilled ? 'TIER_5_PROVIDER_API' : 'TIER_6_LOCAL_CACHE',
        sourceTxHash: record.bridgeSourceTxHash,
        fillTxHash: record.bridgeFillTxHash
      },
      destination: {
        state: record.destinationSwapState,
        verificationState: record.destinationVerificationState,
        txHash: record.destinationTxHash,
        receiptState: record.destinationBlockNumber ? `CONFIRMED_AT_BLOCK_${record.destinationBlockNumber}` : 'UNCONFIRMED',
        evidenceTier: record.primaryEvidenceTier,
        finalityState: record.finalityState,
        actualOutputRaw: record.actualDestinationOutputRaw?.toString()
      },
      settlement: {
        state: record.settlementState,
        evidenceTier: record.primaryEvidenceTier
      },
      blockingReason: record.blockingReason,
      lastUpdated: record.updatedAt
    };
  }

  /**
   * Emits telemetry event into the settlement telemetry stream.
   */
  private emitTelemetry(
    record: CompositeMonitoringRecord,
    stepId: string,
    newState: string,
    evidenceTier: string,
    txHash?: string | null
  ): void {
    const event: CompositeTelemetryEvent = {
      intentId: record.intent.intentId,
      planId: record.intent.executionPlanId,
      stepId,
      network: String(record.intent.sourceChainId),
      chainId: record.intent.sourceChainId,
      token: record.intent.inputToken.symbol,
      amount: record.intent.inputAmountRaw.toString(),
      state: record.overallState,
      previousState: record.overallState,
      newState,
      evidenceTier,
      timestamp: Date.now(),
      blockNumber: record.sourceBlockNumber || record.destinationBlockNumber,
      txHash: txHash || record.sourceTxHash || record.destinationTxHash,
      provider: record.intent.bridgeProvider,
      errorCode: record.errorCode,
      reconciliationStatus: record.settlementState
    };

    this.telemetryEvents.push(event);
    defaultSettlementTelemetry.record({
      planId: record.intent.executionPlanId,
      intentId: record.intent.intentId,
      stepId,
      sourceChainId: record.intent.sourceChainId,
      destinationChainId: record.intent.destinationChainId || 0,
      destinationTxHash: txHash || '',
      expectedRecipient: record.intent.recipient,
      expectedToken: record.intent.requestedOutputToken.address || '',
      expectedMinAmount: record.intent.minimumOutputRaw.toString(),
      primaryEvidenceTier: evidenceTier,
      evidenceSource: 'COMPOSITE_MONITORING_ENGINE',
      verificationResult: newState as any
    });
  }

  public getTelemetryEvents(): CompositeTelemetryEvent[] {
    return [...this.telemetryEvents];
  }

  public getRecord(intentId: string): CompositeMonitoringRecord | undefined {
    const r = this.records.get(intentId);
    if (!r) return undefined;
    // Deep copy to protect internal state
    return JSON.parse(
      JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? `${v.toString()}n` : v)),
      (_, v) => (typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)
    );
  }

  private mustGetRecord(intentId: string): CompositeMonitoringRecord {
    const record = this.records.get(intentId);
    if (!record) {
      throw new Error(`[CompositeMonitoring] Intent "${intentId}" not found in monitoring store`);
    }
    return record;
  }
}

export const defaultCompositeSettlementMonitoringEngine = new CompositeSettlementMonitoringEngine();
