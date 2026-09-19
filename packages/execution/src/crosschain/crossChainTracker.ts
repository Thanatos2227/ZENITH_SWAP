import { JsonRpcProvider, Network, FetchRequest } from 'ethers';
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
  // Reusable provider cache to avoid recreating JsonRpcProviders on every destination verification polling cycle
  private providerCache: Map<string, { provider: JsonRpcProvider; fetchReq: FetchRequest; activeInflight: FetchRequest | null }> = new Map();

  private getOrCreateProviderEntry(url: string, network: Network) {
    let entry = this.providerCache.get(url);
    if (!entry) {
      const fetchReq = new FetchRequest(url);
      fetchReq.timeout = 6000;
      const newEntry = {
        fetchReq,
        activeInflight: null as FetchRequest | null,
        provider: null as any
      };
      fetchReq.preflightFunc = async function (req) {
        newEntry.activeInflight = this;
        return req;
      };
      newEntry.provider = new JsonRpcProvider(fetchReq, network, { staticNetwork: network });
      this.providerCache.set(url, newEntry);
      entry = newEntry;
    }
    return entry;
  }

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
          } else if (destVerification.reason?.includes('reverted on-chain')) {
            // Receipt confirmed that the destination transaction reverted on-chain
            currentOrder.status = 'FAILED';
            currentOrder.errorMessage = destVerification.reason;
            this.activeOrders.set(order.orderId, currentOrder);

            onStateChange?.('FAILED', { error: destVerification.reason });
            stateMachine?.transitionTo('FAILED', {
              id: 'step-intent-fulfill',
              status: 'ERROR',
              error: destVerification.reason
            });

            return { isSuccess: false, error: destVerification.reason };
          } else {
            // Destination transaction receipt is still pending in mempool/block or RPC is temporarily unavailable.
            // Continue polling instead of terminating early.
            console.log(`[CrossChainTracker] Destination settlement pending verification: ${destVerification.reason || 'waiting for receipt'}`);
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
        // Distinguish temporary RPC/API outages from bridge failures.
        // A transient network/API error in getStatus does not fail the order;
        // it logs a warning and continues the existing polling loop.
        console.warn(`[CrossChainTracker] Bridge status RPC/API temporarily unavailable for order ${order.orderId}:`, err?.message || err);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // This timeout limits how long ZENITH actively tracks the bridge.
    // It does not cancel or invalidate a blockchain transaction.
    // A tracking timeout means ZENITH could not confirm settlement
    // within the configured tracking window.
    const timeoutErr = `Cross-chain settlement timed out after ${Math.round(maxPollDurationMs / 1000)} seconds. This tracking window expired without on-chain confirmation; please inspect the bridge explorer to check delivery.`;
    currentOrder.status = 'FAILED';
    currentOrder.errorMessage = timeoutErr;
    this.activeOrders.set(order.orderId, currentOrder);

    onStateChange?.('FAILED', { error: timeoutErr });
    stateMachine?.transitionTo('FAILED', { id: 'step-intent-fulfill', status: 'ERROR', error: timeoutErr });

    return { isSuccess: false, error: timeoutErr };
  }

  // Inspect destination receipt verification logic using a bounded mechanism across candidate RPCs.
  // If the primary RPC fails, try another existing configured RPC.
  // If receipt exists:
  //   status === 1 (success) -> destination confirmed
  //   status === 0 (reverted) -> destination failed / reverted
  // If receipt does not exist:
  //   destination may still be pending on-chain
  // If RPC fails:
  //   do not automatically classify destination transaction as reverted.
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
      const candidateUrls = defaultChainRegistry.getCandidateRPCs(destChain.id);
      const chainNumeric = Number(destChain.chainId || 1);
      const network = Network.from(chainNumeric);

      let lastRpcError: string | null = null;

      for (let i = 0; i < candidateUrls.length; i++) {
        const rpcUrl = candidateUrls[i];
        // Reuse cached provider to prevent recreating JsonRpcProvider on every polling cycle
        const entry = this.getOrCreateProviderEntry(rpcUrl, network);
        let rpcTimer: ReturnType<typeof setTimeout> | null = null;

        try {
          const fetchReceiptPromise = entry.provider.getTransactionReceipt(params.destinationTxHash);
          const rpcTimeoutPromise = new Promise<never>((_, reject) => {
            rpcTimer = setTimeout(() => {
              // Abort the RPC request when the timeout is reached so the old request
              // does not continue running while another RPC request is started.
              if (entry.activeInflight) {
                try {
                  entry.activeInflight.cancel();
                } catch {
                  // Ignore if already completed
                }
                entry.activeInflight = null;
              }
              reject(new Error('Destination RPC timeout'));
            }, 6000);
          });

          const receipt = await Promise.race([fetchReceiptPromise, rpcTimeoutPromise]);
          if (rpcTimer) {
            clearTimeout(rpcTimer);
            rpcTimer = null;
          }
          entry.activeInflight = null;

          if (receipt && receipt.status === 1) {
            return { isVerified: true, receipt };
          }
          if (receipt && receipt.status === 0) {
            return { isVerified: false, receipt, reason: 'Destination transaction reverted on-chain' };
          }

          if (receipt === null) {
            // Receipt is null -> destination transaction has not yet been included in a block
            return { isVerified: false, reason: 'Destination transaction pending on-chain' };
          }
        } catch (err: any) {
          if (rpcTimer) {
            clearTimeout(rpcTimer);
            rpcTimer = null;
          }
          entry.activeInflight = null;
          lastRpcError = err?.message || String(err);
          console.warn(`[CrossChainTracker] Destination RPC ${i + 1} (${rpcUrl}) note: ${lastRpcError}. Trying next candidate RPC...`);
        } finally {
          if (rpcTimer) {
            clearTimeout(rpcTimer);
            rpcTimer = null;
          }
        }
      }

      // If all candidate RPCs timed out or failed with network errors, do NOT classify as reverted!
      return { isVerified: false, reason: lastRpcError ? `Destination RPC temporarily unavailable (${lastRpcError})` : 'Destination RPC query pending' };
    }

    return { isVerified: true };
  }
}

export const defaultCrossChainTracker = new CrossChainTracker();
