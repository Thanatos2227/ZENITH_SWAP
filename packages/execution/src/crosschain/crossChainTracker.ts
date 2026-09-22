import {
  CrossChainQuote,
  SettlementState
} from '@zenith/types';

import { defaultChainRegistry } from '@zenith/chains';
import { defaultCrossChainAggregator, CrossChainAggregator } from '@zenith/routing';
import { ExecutionStateMachine } from '../stateMachine';
import { CrossChainStateRepository } from '../persistence/repository';
import { defaultMultiProviderRpcClient } from '../providers/multiProviderRpcClient';


export interface ActiveCrossChainOrder {
  orderId: string;
  sourceChainId: string;
  destinationChainId: string;
  sourceTxHash: string;
  destinationTxHash?: string;
  provider: string;
  recipient: string;
  quote: CrossChainQuote;
  status: SettlementState;
  createdAt: number;
  lastUpdated: number;
  errorMessage?: string;
}

export class CrossChainTracker {
  private activeOrders: Map<string, ActiveCrossChainOrder> = new Map();
  private aggregator: CrossChainAggregator;
  private repository?: CrossChainStateRepository;

  constructor(aggregator = defaultCrossChainAggregator, repository?: CrossChainStateRepository) {
    this.aggregator = aggregator;
    this.repository = repository;
  }

  public setRepository(repository: CrossChainStateRepository): void {
    this.repository = repository;
  }

  public registerOrder(order: ActiveCrossChainOrder): void {
    this.activeOrders.set(order.orderId, { ...order });
    if (this.repository) {
      this.repository.createProviderOrder({
        orderId: order.orderId,
        intentId: order.orderId,
        provider: order.provider,
        sourceChainId: order.sourceChainId,
        destinationChainId: order.destinationChainId,
        sourceTxHash: order.sourceTxHash,
        destinationTxHash: order.destinationTxHash,
        recipient: order.recipient,
        quoteJson: JSON.stringify(order.quote),
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.lastUpdated
      }).catch(() => {
        this.repository?.updateProviderOrder(order.orderId, {
          status: order.status,
          destinationTxHash: order.destinationTxHash,
          errorMessage: order.errorMessage
        }).catch(() => {});
      });
    }
  }

  public getOrder(orderId: string): ActiveCrossChainOrder | undefined {
    return this.activeOrders.get(orderId);
  }

  public getActiveOrder(orderId: string): ActiveCrossChainOrder | undefined {
    return this.activeOrders.get(orderId);
  }

  public getAllActiveOrders(): ActiveCrossChainOrder[] {
    return Array.from(this.activeOrders.values());
  }

  public async trackUntilSettled(params: {
    order: ActiveCrossChainOrder;
    stateMachine?: ExecutionStateMachine;
    maxPollDurationMs?: number;
    pollIntervalMs?: number;
    destRpcProvider?: any;
    onStateChange?: (state: SettlementState, meta?: { destTxHash?: string; error?: string }) => void;
  }): Promise<{ isSuccess: boolean; destinationTxHash?: string; receipt?: any; error?: string; isTimeout?: boolean; isRefunded?: boolean }> {
    const {
      order,
      stateMachine,
      maxPollDurationMs = 1800000,
      pollIntervalMs = 4000,
      destRpcProvider,
      onStateChange
    } = params;

    const providerAdapter = this.aggregator.getProvider(order.provider);
    if (!providerAdapter) {
      const err = `Bridge provider ${order.provider} is not registered in tracker.`;
      onStateChange?.('FAILED', { error: err });
      stateMachine?.transitionTo('FAILED', { id: 'step-intent-fulfill', status: 'ERROR', error: err });
      return { isSuccess: false, error: err };
    }

    const startTime = Date.now();
    const currentOrder = { ...order };

    while (Date.now() - startTime < maxPollDurationMs) {
      try {
        const status = await providerAdapter.getStatus(currentOrder.sourceTxHash, currentOrder.quote);

        if (status.state === 'DESTINATION_FILLED' && status.destinationTxHash) {
          currentOrder.destinationTxHash = status.destinationTxHash;
          currentOrder.status = 'DESTINATION_FILLED';
          this.activeOrders.set(order.orderId, currentOrder);

          onStateChange?.('DESTINATION_FILLED', { destTxHash: status.destinationTxHash });
          stateMachine?.transitionTo('BRIDGE_DESTINATION_CONFIRMED', {
            id: 'step-intent-fulfill',
            status: 'ACTIVE',
            txHash: status.destinationTxHash
          });

          const destVerification = await this.verifyDestinationSettlement({
            destinationChainId: order.destinationChainId,
            destinationTxHash: status.destinationTxHash,
            expectedRecipient: order.recipient,
            provider: destRpcProvider
          });

          if (destVerification.isVerified) {
            currentOrder.status = 'SETTLED';
            this.activeOrders.set(order.orderId, currentOrder);
            if (this.repository) {
              this.repository.updateProviderOrder(order.orderId, {
                destinationTxHash: status.destinationTxHash,
                status: 'SETTLED'
              }).catch(() => {});
              this.repository.updateIntent(order.orderId, {
                destinationTxHash: status.destinationTxHash,
                status: 'SETTLED'
              }).catch(() => {});
              this.repository.recordSettlement({
                intentId: order.orderId,
                destinationTxHash: status.destinationTxHash,
                destinationChainId: order.destinationChainId,
                tokenAddress: order.quote.destinationToken.address,
                tokenSymbol: order.quote.destinationToken.symbol,
                recipient: order.recipient,
                expectedAmountRaw: order.quote.destinationAmountRaw,
                actualAmountRaw: order.quote.destinationAmountRaw,
                verified: true,
                verifiedAt: Date.now()
              }).catch(() => {});
            }

            onStateChange?.('SETTLED', { destTxHash: status.destinationTxHash });
            stateMachine?.transitionTo('COMPLETED', {
              id: 'step-intent-fulfill',
              status: 'SUCCESS',
              txHash: status.destinationTxHash
            });

            return {
              isSuccess: true,
              destinationTxHash: status.destinationTxHash,
              receipt: destVerification.receipt
            };
          } else {
            currentOrder.status = 'FAILED';
            currentOrder.errorMessage = destVerification.reason;
            this.activeOrders.set(order.orderId, currentOrder);
            if (this.repository) {
              this.repository.updateProviderOrder(order.orderId, {
                status: 'FAILED',
                errorMessage: destVerification.reason
              }).catch(() => {});
              this.repository.updateIntent(order.orderId, {
                status: 'FAILED',
                errorMessage: destVerification.reason
              }).catch(() => {});
            }

            onStateChange?.('FAILED', { error: destVerification.reason });
            stateMachine?.transitionTo('FAILED', {
              id: 'step-intent-fulfill',
              status: 'ERROR',
              error: destVerification.reason
            });

            return {
              isSuccess: false,
              destinationTxHash: status.destinationTxHash,
              error: destVerification.reason || 'Destination verification failed'
            };
          }
        } else if (status.state === 'REFUND_PENDING' || status.state === 'REFUNDED') {
          currentOrder.status = status.state;
          currentOrder.errorMessage = status.errorMessage;
          this.activeOrders.set(order.orderId, currentOrder);
          if (this.repository) {
            this.repository.updateProviderOrder(order.orderId, {
              status: status.state,
              errorMessage: status.errorMessage
            }).catch(() => {});
            this.repository.updateIntent(order.orderId, {
              status: status.state,
              errorMessage: status.errorMessage
            }).catch(() => {});
          }

          onStateChange?.(status.state, { error: status.errorMessage });
          stateMachine?.transitionTo(status.state, {
            id: 'step-intent-fulfill',
            status: 'ERROR',
            error: status.errorMessage
          });

          return { isSuccess: false, isRefunded: true, error: status.errorMessage || 'Bridge order was refunded' };
        } else if (status.isFailed) {
          currentOrder.status = 'FAILED';
          currentOrder.errorMessage = status.errorMessage;
          this.activeOrders.set(order.orderId, currentOrder);
          if (this.repository) {
            this.repository.updateProviderOrder(order.orderId, {
              status: 'FAILED',
              errorMessage: status.errorMessage
            }).catch(() => {});
            this.repository.updateIntent(order.orderId, {
              status: 'FAILED',
              errorMessage: status.errorMessage
            }).catch(() => {});
          }

          onStateChange?.('FAILED', { error: status.errorMessage });
          stateMachine?.transitionTo('FAILED', {
            id: 'step-intent-fulfill',
            status: 'ERROR',
            error: status.errorMessage
          });

          return { isSuccess: false, error: status.errorMessage || 'Cross-chain fulfillment failed' };
        } else if (status.state === 'TRACKING_UNAVAILABLE') {
          onStateChange?.('TRACKING_UNAVAILABLE');
        } else {
          if (this.repository) {
            this.repository.updateProviderOrder(order.orderId, { status: 'FULFILLING' }).catch(() => {});
          }
          onStateChange?.('FULFILLING');
        }
      } catch (err: any) {
        console.warn(`[CrossChainTracker] Polling note for order ${order.orderId}:`, err?.message || err);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    const timeoutErr = `Cross-chain settlement tracking timed out after ${Math.round(maxPollDurationMs / 1000)} seconds. Order may still complete on-chain.`;
    currentOrder.status = 'TRACKING_TIMEOUT';
    currentOrder.errorMessage = timeoutErr;
    this.activeOrders.set(order.orderId, currentOrder);

    onStateChange?.('TRACKING_TIMEOUT', { error: timeoutErr });
    stateMachine?.transitionTo('TRACKING_TIMEOUT', { id: 'step-intent-fulfill', status: 'ACTIVE', error: timeoutErr });

    return { isSuccess: false, isTimeout: true, error: timeoutErr };
  }

  public async verifyDestinationSettlement(params: {
    destinationChainId: string;
    destinationTxHash: string;
    expectedRecipient: string;
    provider?: any;
  }): Promise<{ isVerified: boolean; receipt?: any; reason?: string }> {
    const destChain = defaultChainRegistry.getChain(params.destinationChainId);
    if (!destChain) {
      return { isVerified: false, reason: 'Destination chain not found in registry' };
    }

    if (!params.destinationTxHash || !/^0x[0-9a-fA-F]{64}$/.test(params.destinationTxHash)) {
      return { isVerified: false, reason: `Invalid destination transaction hash format: "${params.destinationTxHash}"` };
    }

    if (destChain.executionEnvironment === 'EVM') {
      try {
        let receipt: any;
        if (params.provider && typeof params.provider.getTransactionReceipt === 'function') {
          receipt = await params.provider.getTransactionReceipt(params.destinationTxHash);
        } else {
          receipt = await defaultMultiProviderRpcClient.getTransactionReceipt(destChain.id, params.destinationTxHash);
        }

        if (receipt && (receipt.status === 1 || receipt.status === '0x1')) {
          return { isVerified: true, receipt };
        }
        if (receipt && (receipt.status === 0 || receipt.status === '0x0')) {
          return { isVerified: false, receipt, reason: 'Destination transaction reverted on-chain' };
        }
        if (!receipt) {
          return { isVerified: false, reason: 'Destination transaction receipt pending or not found on-chain' };
        }
      } catch (err: any) {
        return { isVerified: false, reason: err?.message || 'Destination RPC query failed' };
      }
    }

    return { isVerified: true };
  }
}


export const defaultCrossChainTracker = new CrossChainTracker();
