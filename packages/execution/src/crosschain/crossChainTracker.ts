import { JsonRpcProvider, Network } from 'ethers';
import {
  CrossChainQuote,
  SettlementState
} from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import { defaultCrossChainAggregator, CrossChainAggregator } from '@zenith/routing';
import { ExecutionStateMachine } from '../stateMachine';

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

  constructor(aggregator = defaultCrossChainAggregator) {
    this.aggregator = aggregator;
  }

  public registerOrder(order: ActiveCrossChainOrder): void {
    this.activeOrders.set(order.orderId, { ...order });
  }

  public getOrder(orderId: string): ActiveCrossChainOrder | undefined {
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
    onStateChange?: (state: SettlementState, meta?: { destTxHash?: string; error?: string }) => void;
  }): Promise<{ isSuccess: boolean; destinationTxHash?: string; receipt?: any; error?: string }> {
    const {
      order,
      stateMachine,
      maxPollDurationMs = 1800000,
      pollIntervalMs = 4000,
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
    let currentOrder = { ...order };

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
            expectedRecipient: order.recipient
          });

          if (destVerification.isVerified) {
            currentOrder.status = 'SETTLED';
            this.activeOrders.set(order.orderId, currentOrder);

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

          }
        } else if (status.isFailed) {
          currentOrder.status = 'FAILED';
          currentOrder.errorMessage = status.errorMessage;
          this.activeOrders.set(order.orderId, currentOrder);

          onStateChange?.('FAILED', { error: status.errorMessage });
          stateMachine?.transitionTo('FAILED', {
            id: 'step-intent-fulfill',
            status: 'ERROR',
            error: status.errorMessage
          });

          return { isSuccess: false, error: status.errorMessage || 'Cross-chain fulfillment failed' };
        } else {

          onStateChange?.('FULFILLING');
        }
      } catch (err: any) {
        console.warn(`[CrossChainTracker] Polling note for order ${order.orderId}:`, err?.message || err);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    const timeoutErr = `Cross-chain settlement timed out after ${Math.round(maxPollDurationMs / 1000)} seconds.`;
    currentOrder.status = 'FAILED';
    currentOrder.errorMessage = timeoutErr;
    this.activeOrders.set(order.orderId, currentOrder);

    onStateChange?.('FAILED', { error: timeoutErr });
    stateMachine?.transitionTo('FAILED', { id: 'step-intent-fulfill', status: 'ERROR', error: timeoutErr });

    return { isSuccess: false, error: timeoutErr };
  }

  public async verifyDestinationSettlement(params: {
    destinationChainId: string;
    destinationTxHash: string;
    expectedRecipient: string;
  }): Promise<{ isVerified: boolean; receipt?: any; reason?: string }> {
    const destChain = defaultChainRegistry.getChain(params.destinationChainId);
    if (!destChain) {
      return { isVerified: false, reason: 'Destination chain not found' };
    }

    if (destChain.executionEnvironment === 'EVM') {
      try {
        const rpcUrl = defaultChainRegistry.getHealthyRPC(destChain.id);
        const chainNumeric = Number(destChain.chainId || 1);
        const network = Network.from(chainNumeric);
        const provider = new JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
        const receipt = await provider.getTransactionReceipt(params.destinationTxHash);

        if (receipt && receipt.status === 1) {
          return { isVerified: true, receipt };
        }
        if (receipt && receipt.status === 0) {
          return { isVerified: false, receipt, reason: 'Destination transaction reverted on-chain' };
        }
      } catch (err: any) {

        return { isVerified: false, reason: err?.message || 'Destination RPC query pending' };
      }
    }

    return { isVerified: true };
  }
}

export const defaultCrossChainTracker = new CrossChainTracker();
