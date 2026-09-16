import { CrossChainIntent, SettlementState, SolverFillQuote } from '@zenith/types';
import { defaultCrossChainAggregator, CrossChainAggregator } from '@zenith/routing';

export interface SolverProfile {
  id: string;
  name: string;
  reputationScore: number;
  avgFillTimeSec: number;
  availableLiquidityUSD: number;
  isActive: boolean;
}

export class CrossChainIntentEngine {
  private aggregator: CrossChainAggregator;
  private intentStore: Map<string, CrossChainIntent> = new Map();
  private processedNonces: Set<string> = new Set();
  private processedOrderIds: Set<string> = new Set();

  constructor(aggregator = defaultCrossChainAggregator) {
    this.aggregator = aggregator;
  }

  public async getCompetitiveQuotes(intent: CrossChainIntent): Promise<SolverFillQuote[]> {
    const tokenOutDecimals = intent.destinationToken.decimals || 18;

    const quotes = await this.aggregator.getQuotes({
      sourceChainId: intent.sourceChainId,
      destinationChainId: intent.destinationChainId,
      tokenIn: intent.sourceToken,
      tokenOut: intent.destinationToken,
      amountInRaw: intent.sourceAmountRaw,
      slippageTolerancePercent: 0.5,
      recipientAddress: intent.recipient
    });

    if (quotes.length > 0) {
      return quotes.map((q) => {
        const outBig = BigInt(q.destinationAmountRaw);
        const formatted = (Number(outBig) / 10 ** tokenOutDecimals).toLocaleString(undefined, { maximumFractionDigits: 6 });
        return {
          solverId: q.provider,
          solverName: q.providerName,
          destinationAmountRaw: q.destinationAmountRaw,
          destinationAmountFormatted: formatted,
          estimatedTimeSec: q.estimatedTransferTimeSec,
          executionCostUSD: q.bridgeFeeUSD,
          solverReputationScore: q.securityRating === 'A+' ? 99 : 95,
          isGuaranteed: true
        };
      });
    }

    return [];
  }

  public registerIntent(intent: CrossChainIntent): void {
    if (!intent.orderId) {
      throw new Error('[CrossChainIntentEngine] Order ID is required');
    }

    const nonceKey = `${intent.recipient.toLowerCase()}:${intent.sourceChainId}:${intent.destinationChainId}:${intent.sourceToken.address.toLowerCase()}:${intent.destinationToken.address.toLowerCase()}:${intent.sourceAmountRaw}:${intent.nonce}`;
    if (this.processedNonces.has(nonceKey)) {
      throw new Error(`[CrossChainIntentEngine] Nonce replay detected for ${intent.recipient} (nonce: ${intent.nonce})`);
    }

    if (this.processedOrderIds.has(intent.orderId)) {
      throw new Error(`[CrossChainIntentEngine] Duplicate order ID detected: ${intent.orderId}`);
    }

    const deadlineMs = intent.deadline < 1e11 ? intent.deadline * 1000 : intent.deadline;
    if (Date.now() > deadlineMs) {
      throw new Error(`[CrossChainIntentEngine] Intent expired at ${new Date(deadlineMs).toISOString()}`);
    }

    this.processedNonces.add(nonceKey);
    this.processedOrderIds.add(intent.orderId);
    this.intentStore.set(intent.orderId, { ...intent, status: 'CREATED' });
  }

  public updateIntentState(
    orderId: string,
    newState: SettlementState,
    meta?: { solverId?: string; txHashSource?: string; txHashDestination?: string }
  ): CrossChainIntent {
    const existing = this.intentStore.get(orderId);
    if (!existing) {
      throw new Error(`[CrossChainIntentEngine] Intent ${orderId} not found`);
    }

    this.validateStateTransition(existing.status, newState);

    const updated: CrossChainIntent = {
      ...existing,
      status: newState,
      solverId: meta?.solverId || existing.solverId,
      txHashSource: meta?.txHashSource || existing.txHashSource,
      txHashDestination: meta?.txHashDestination || existing.txHashDestination
    };

    this.intentStore.set(orderId, updated);
    return updated;
  }

  public processRefund(orderId: string, reason: string): CrossChainIntent {
    const intent = this.intentStore.get(orderId);
    if (!intent) {
      throw new Error(`[CrossChainIntentEngine] Intent ${orderId} not found`);
    }

    if (intent.status === 'SETTLED' || intent.status === 'REFUNDED') {
      throw new Error(`[CrossChainIntentEngine] Cannot refund already finalized intent (${intent.status})`);
    }

    this.updateIntentState(orderId, 'REFUND_PENDING');

    const finalized = this.updateIntentState(orderId, 'REFUNDED');
    console.warn(`[CrossChainIntentEngine] Refunded ${orderId}. Reason: ${reason}`);
    return finalized;
  }

  public getIntent(orderId: string): CrossChainIntent | undefined {
    return this.intentStore.get(orderId);
  }

  private validateStateTransition(current: SettlementState, next: SettlementState): void {
    if (current === next) return;
    const allowedTransitions: Record<SettlementState, SettlementState[]> = {
      CREATED: ['SIGNED', 'CANCELLED', 'EXPIRED'],
      SIGNED: ['SUBMITTED', 'CANCELLED', 'EXPIRED'],
      SUBMITTED: ['ACCEPTED', 'REJECTED', 'FAILED', 'EXPIRED', 'FULFILLING'],
      ACCEPTED: ['FULFILLING', 'FAILED', 'REFUND_PENDING'],
      FULFILLING: ['FULFILLING', 'DESTINATION_FILLED', 'FAILED', 'REFUND_PENDING', 'SETTLED'],
      DESTINATION_FILLED: ['VERIFIED', 'SETTLING', 'SETTLED', 'FAILED', 'REFUND_PENDING'],
      VERIFIED: ['SETTLING', 'SETTLED', 'FAILED', 'REFUND_PENDING'],
      SETTLING: ['SETTLED', 'FAILED'],
      SETTLED: [],
      FAILED: ['REFUND_PENDING', 'REFUNDED'],
      REFUND_PENDING: ['REFUNDED'],
      REFUNDED: [],
      CANCELLED: [],
      EXPIRED: ['REFUND_PENDING', 'REFUNDED'],
      REJECTED: ['REFUND_PENDING', 'REFUNDED']
    };

    const allowed = allowedTransitions[current] || [];
    if (!allowed.includes(next)) {
      throw new Error(`[CrossChainIntentEngine] Invalid state transition from ${current} to ${next}`);
    }
  }
}

export const IntentEngine = CrossChainIntentEngine;
export const defaultIntentEngine = new CrossChainIntentEngine();
