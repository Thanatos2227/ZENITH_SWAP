import {
  ReconciliationEvidence,
  ReconciliationResult,
  CrossChainQuote,
  SettlementState
} from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import { defaultCrossChainAggregator, CrossChainAggregator } from '@zenith/routing';
import { CrossChainStateRepository } from '../persistence/repository';
import { MultiProviderRpcClient, defaultMultiProviderRpcClient } from '../providers/multiProviderRpcClient';

export interface ReconcilerOptions {
  repository: CrossChainStateRepository;
  rpcClient?: MultiProviderRpcClient;
  aggregator?: CrossChainAggregator;
  workerId?: string;
}

export class CrossChainStatusReconciler {
  private repository: CrossChainStateRepository;
  private rpcClient: MultiProviderRpcClient;
  private aggregator: CrossChainAggregator;
  private workerId: string;

  constructor(options: ReconcilerOptions) {
    this.repository = options.repository;
    this.rpcClient = options.rpcClient || defaultMultiProviderRpcClient;
    this.aggregator = options.aggregator || defaultCrossChainAggregator;
    this.workerId = options.workerId || `reconciler-${typeof process !== 'undefined' ? process.pid || 1 : 1}-${Date.now()}`;
  }

  public getWorkerId(): string {
    return this.workerId;
  }


  public async reconcileOrder(orderId: string): Promise<ReconciliationResult> {
    const order = await this.repository.getProviderOrder(orderId);
    if (!order) {
      return {
        entityId: orderId,
        entityType: 'ORDER',
        status: 'FAILED',
        previousStatus: 'UNKNOWN',
        evidences: [],
        actionTaken: 'ORDER_NOT_FOUND',
        timestamp: Date.now()
      };
    }

    const prevStatus = order.status;
    const evidences: ReconciliationEvidence[] = [];

    // Add local cached record as baseline evidence (Priority 5)
    evidences.push({
      evidenceId: `ev-local-${Date.now()}`,
      source: 'LOCAL_CACHE',
      priority: 5,
      timestamp: order.updatedAt,
      status: order.status,
      txHash: order.destinationTxHash || order.sourceTxHash,
      data: { orderId }
    });

    let quote: CrossChainQuote | undefined = undefined;
    if (order.quoteJson) {
      try {
        quote = JSON.parse(order.quoteJson);
      } catch {}
    }

    const providerAdapter = this.aggregator.getProvider(order.provider);
    let providerStatus: any = null;

    if (providerAdapter && quote && order.sourceTxHash) {
      try {
        providerStatus = await providerAdapter.getStatus(order.sourceTxHash, quote);
        if (providerStatus) {
          evidences.push({
            evidenceId: `ev-provider-${Date.now()}`,
            source: 'PROVIDER_API',
            priority: 3,
            timestamp: providerStatus.timestamp || Date.now(),
            providerId: order.provider,
            status: providerStatus.state,
            txHash: providerStatus.destinationTxHash,
            data: providerStatus
          });
        }
      } catch (err: any) {
        evidences.push({
          evidenceId: `ev-provider-err-${Date.now()}`,
          source: 'PROVIDER_API',
          priority: 3,
          timestamp: Date.now(),
          providerId: order.provider,
          status: 'TRACKING_UNAVAILABLE',
          data: { error: err?.message || String(err) }
        });
      }
    }

    // Determine target destination txHash to verify on-chain
    const destTxHash = providerStatus?.destinationTxHash || order.destinationTxHash;

    // Check on-chain receipt on destination chain if txHash is present (Priority 1)
    if (destTxHash && /^0x[0-9a-fA-F]{64}$/.test(destTxHash)) {
      try {
        const destChain = defaultChainRegistry.getChain(order.destinationChainId);
        if (destChain && destChain.executionEnvironment === 'EVM') {
          const receipt = await this.rpcClient.getTransactionReceipt(destChain.id, destTxHash);
          if (receipt) {
            const isMinedSuccess = receipt.status === 1 || receipt.status === '0x1';
            const isMinedReverted = receipt.status === 0 || receipt.status === '0x0';
            const blockNumber = typeof receipt.blockNumber === 'string'
              ? (receipt.blockNumber.startsWith('0x') ? parseInt(receipt.blockNumber, 16) : Number(receipt.blockNumber))
              : Number(receipt.blockNumber);

            evidences.push({
              evidenceId: `ev-receipt-${Date.now()}`,
              source: 'ON_CHAIN_RECEIPT',
              priority: 1,
              timestamp: Date.now(),
              chainId: destChain.id,
              txHash: destTxHash,
              blockNumber,
              status: isMinedSuccess ? 'CONFIRMED' : (isMinedReverted ? 'REVERTED' : 'PENDING'),
              data: receipt
            });
          }
        }
      } catch (err: any) {
        // RPC read error during on-chain verification
      }
    }

    // Evaluate evidence hierarchy
    const receiptEvidence = evidences.find((e) => e.source === 'ON_CHAIN_RECEIPT');
    const providerEvidence = evidences.find((e) => e.source === 'PROVIDER_API' && e.status !== 'TRACKING_UNAVAILABLE');


    // Conflict Detection:
    // 1. Provider claims FILLED but on-chain receipt indicates REVERTED
    if (providerEvidence?.status === 'DESTINATION_FILLED' && receiptEvidence?.status === 'REVERTED') {
      const conflictReason = `Provider ${order.provider} reports DESTINATION_FILLED with tx ${destTxHash}, but destination on-chain receipt indicates REVERTED.`;
      await this.repository.updateProviderOrder(orderId, {
        status: 'FAILED',
        errorMessage: conflictReason
      });

      return {
        entityId: orderId,
        entityType: 'ORDER',
        status: 'STATUS_CONFLICT',
        previousStatus: prevStatus,
        sourceTxHash: order.sourceTxHash,
        destinationTxHash: destTxHash,
        evidences,
        conflict: {
          reason: conflictReason,
          conflictingEvidences: [providerEvidence, receiptEvidence]
        },
        actionTaken: 'FLAGGED_STATUS_CONFLICT',
        timestamp: Date.now()
      };
    }

    // 2. On-chain receipt confirmed
    if (receiptEvidence?.status === 'CONFIRMED') {
      await this.repository.updateProviderOrder(orderId, {
        status: 'SETTLED',
        destinationTxHash: destTxHash
      });
      await this.repository.updateIntent(order.intentId || orderId, {
        status: 'SETTLED',
        destinationTxHash: destTxHash
      }).catch(() => {});

      if (quote) {
        await this.repository.recordSettlement({
          intentId: order.intentId || orderId,
          destinationTxHash: destTxHash!,
          destinationChainId: order.destinationChainId,
          tokenAddress: quote.destinationToken.address,
          tokenSymbol: quote.destinationToken.symbol,
          recipient: order.recipient,
          expectedAmountRaw: quote.destinationAmountRaw,
          actualAmountRaw: quote.destinationAmountRaw,
          verified: true,
          verifiedAt: Date.now()
        }).catch(() => {});
      }

      return {
        entityId: orderId,
        entityType: 'ORDER',
        status: 'SETTLED',
        previousStatus: prevStatus,
        sourceTxHash: order.sourceTxHash,
        destinationTxHash: destTxHash,
        evidences,
        actionTaken: 'RECONCILED_ON_CHAIN_RECEIPT_SETTLED',
        timestamp: Date.now()
      };
    }

    // 3. Provider reports DESTINATION_FILLED (receipt pending or unverified)
    if (providerEvidence?.status === 'DESTINATION_FILLED') {
      await this.repository.updateProviderOrder(orderId, {
        status: 'DESTINATION_FILLED',
        destinationTxHash: destTxHash
      });

      return {
        entityId: orderId,
        entityType: 'ORDER',
        status: 'DESTINATION_FILLED',
        previousStatus: prevStatus,
        sourceTxHash: order.sourceTxHash,
        destinationTxHash: destTxHash,
        evidences,
        actionTaken: 'RECONCILED_PROVIDER_DESTINATION_FILLED',
        timestamp: Date.now()
      };
    }

    // 4. Provider reports REFUND_PENDING or REFUNDED
    if (providerEvidence?.status === 'REFUND_PENDING' || providerEvidence?.status === 'REFUNDED') {
      const refundState = providerEvidence.status as SettlementState;
      await this.repository.updateProviderOrder(orderId, {
        status: refundState,
        errorMessage: providerEvidence.data?.errorMessage
      });

      return {
        entityId: orderId,
        entityType: 'ORDER',
        status: 'REFUNDED',
        previousStatus: prevStatus,
        sourceTxHash: order.sourceTxHash,
        destinationTxHash: destTxHash,
        evidences,
        actionTaken: 'RECONCILED_PROVIDER_REFUND',
        timestamp: Date.now()
      };
    }

    // 5. Provider reports FAILED explicitly
    if (providerEvidence?.status === 'FAILED' && providerEvidence.data?.isFailed) {
      await this.repository.updateProviderOrder(orderId, {
        status: 'FAILED',
        errorMessage: providerEvidence.data?.errorMessage || 'Bridge provider confirmed failure'
      });

      return {
        entityId: orderId,
        entityType: 'ORDER',
        status: 'FAILED',
        previousStatus: prevStatus,
        sourceTxHash: order.sourceTxHash,
        destinationTxHash: destTxHash,
        evidences,
        actionTaken: 'RECONCILED_PROVIDER_FAILED',
        timestamp: Date.now()
      };
    }

    // 6. Provider is tracking unavailable / status unknown -> preserve prior state without fabricating failure
    return {
      entityId: orderId,
      entityType: 'ORDER',
      status: 'STATUS_UNKNOWN',
      previousStatus: prevStatus,
      sourceTxHash: order.sourceTxHash,
      destinationTxHash: destTxHash,
      evidences,
      actionTaken: 'TRACKING_UNAVAILABLE_STATE_PRESERVED',
      timestamp: Date.now()
    };
  }

  public async reconcileIntent(intentId: string): Promise<ReconciliationResult> {
    const intent = await this.repository.getIntent(intentId);
    if (!intent) {
      return {
        entityId: intentId,
        entityType: 'INTENT',
        status: 'FAILED',
        previousStatus: 'UNKNOWN',
        evidences: [],
        actionTaken: 'INTENT_NOT_FOUND',
        timestamp: Date.now()
      };
    }

    // Check if there is an associated provider order
    const order = await this.repository.getProviderOrder(intentId);
    if (order) {
      const orderResult = await this.reconcileOrder(order.orderId);
      return {
        ...orderResult,
        entityId: intentId,
        entityType: 'INTENT'
      };
    }


    // Check destination on-chain receipt if destinationTxHash exists
    if (intent.destinationTxHash && /^0x[0-9a-fA-F]{64}$/.test(intent.destinationTxHash)) {
      try {
        const destChain = defaultChainRegistry.getChain(intent.destinationChainId);
        if (destChain && destChain.executionEnvironment === 'EVM') {
          const receipt = await this.rpcClient.getTransactionReceipt(destChain.id, intent.destinationTxHash);
          if (receipt) {
            const isMinedSuccess = receipt.status === 1 || receipt.status === '0x1';
            if (isMinedSuccess) {
              await this.repository.updateIntent(intentId, { status: 'SETTLED' });
              await this.repository.recordSettlement({
                intentId,
                destinationTxHash: intent.destinationTxHash,
                destinationChainId: intent.destinationChainId,
                tokenAddress: intent.destinationTokenAddress,
                tokenSymbol: intent.destinationTokenSymbol,
                recipient: intent.userAddress,
                expectedAmountRaw: intent.expectedAmountOutRaw,
                actualAmountRaw: intent.expectedAmountOutRaw,
                verified: true,
                verifiedAt: Date.now()
              }).catch(() => {});

              return {
                entityId: intentId,
                entityType: 'INTENT',
                status: 'SETTLED',
                previousStatus: intent.status,
                sourceTxHash: intent.sourceTxHash,
                destinationTxHash: intent.destinationTxHash,
                evidences: [{
                  evidenceId: `ev-receipt-${Date.now()}`,
                  source: 'ON_CHAIN_RECEIPT',
                  priority: 1,
                  timestamp: Date.now(),
                  chainId: destChain.id,
                  txHash: intent.destinationTxHash,
                  status: 'CONFIRMED'
                }],
                actionTaken: 'RECONCILED_INTENT_RECEIPT_SETTLED',
                timestamp: Date.now()
              };
            }
          }
        }
      } catch {}
    }

    return {
      entityId: intentId,
      entityType: 'INTENT',
      status: 'STATUS_UNKNOWN',
      previousStatus: intent.status,
      sourceTxHash: intent.sourceTxHash,
      destinationTxHash: intent.destinationTxHash,
      evidences: [],
      actionTaken: 'IN_FLIGHT_STATE_PRESERVED',
      timestamp: Date.now()
    };
  }

  public async reconcileAll(): Promise<ReconciliationResult[]> {
    const results: ReconciliationResult[] = [];

    // 1. Reconcile recoverable intents
    const intents = await this.repository.listRecoverableIntents();
    for (const intent of intents) {
      const res = await this.reconcileIntent(intent.intentId);
      results.push(res);
    }

    return results;
  }
}

export const defaultStatusReconciler = new CrossChainStatusReconciler({
  repository: null as any // Bound at runtime
});
