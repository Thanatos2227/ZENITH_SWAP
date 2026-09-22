import { defaultChainRegistry } from '@zenith/chains';
import { defaultCrossChainAggregator, CrossChainAggregator } from '@zenith/routing';
import { CrossChainStateRepository } from './repository';
import { defaultEVMAdapter, EVMExecutionAdapter } from '../adapters/evmAdapter';
import { MultiProviderRpcClient, defaultMultiProviderRpcClient } from '../providers/multiProviderRpcClient';
import { CrossChainStatusReconciler } from '../reconciliation/statusReconciler';

export interface RecoveryResult {
  entityId: string;
  intentId?: string;
  entityType: 'INTENT' | 'PLAN' | 'TRANSACTION';
  previousStatus: string;
  reconciledStatus: string;
  actionTaken: string;
  sourceTxHash?: string;
  destinationTxHash?: string;
  error?: string;
}

export interface ConsistencyCheckViolation {
  code: string;
  entityId: string;
  description: string;
  actionTaken: 'MOVED_TO_RECOVERY_REQUIRED' | 'RECLAIMED' | 'REPORTED';
  details?: any;
}

export interface RecoveryEngineOptions {
  repository: CrossChainStateRepository;
  aggregator?: CrossChainAggregator;
  evmAdapter?: EVMExecutionAdapter;
  rpcClient?: MultiProviderRpcClient;
  statusReconciler?: CrossChainStatusReconciler;
  workerId?: string;
  leaseDurationMs?: number;
  rpcProviders?: Record<string, any>;
}

export class CrossChainRecoveryEngine {
  private repository: CrossChainStateRepository;
  private aggregator: CrossChainAggregator;
  private evmAdapter: EVMExecutionAdapter;
  private rpcClient: MultiProviderRpcClient;
  private statusReconciler: CrossChainStatusReconciler;
  private workerId: string;
  private leaseDurationMs: number;
  private rpcProviders: Record<string, any>;

  constructor(options: RecoveryEngineOptions) {
    this.repository = options.repository;
    this.aggregator = options.aggregator || defaultCrossChainAggregator;
    this.evmAdapter = options.evmAdapter || defaultEVMAdapter;
    this.rpcClient = options.rpcClient || defaultMultiProviderRpcClient;
    this.statusReconciler = options.statusReconciler || new CrossChainStatusReconciler({
      repository: this.repository,
      rpcClient: this.rpcClient,
      aggregator: this.aggregator
    });
    this.workerId = options.workerId || `worker-${typeof process !== 'undefined' ? process.pid || 1 : 1}-${Date.now()}`;
    this.leaseDurationMs = options.leaseDurationMs || 30000;
    this.rpcProviders = options.rpcProviders || {};
  }

  public getStatusReconciler(): CrossChainStatusReconciler {
    return this.statusReconciler;
  }

  public async recoverAll(): Promise<RecoveryResult[]> {

    const results: RecoveryResult[] = [];

    // 1. Run startup consistency checks
    await this.validateStartupConsistency();

    // 2. Recover uncertain / pending transactions
    const uncertainTxs = await this.repository.listUncertainTransactions();
    for (const tx of uncertainTxs) {
      const txResult = await this.recoverUncertainTransaction(tx.transactionId);
      results.push(txResult);
    }

    // 3. Recover active execution plans
    const activePlans = await this.repository.listActiveExecutionPlans();
    for (const plan of activePlans) {
      const planResult = await this.recoverPlan(plan.planId);
      results.push(planResult);
    }

    // 4. Recover recoverable intents
    const recoverableIntents = await this.repository.listRecoverableIntents();
    for (const intent of recoverableIntents) {
      const intentResult = await this.recoverIntent(intent.intentId);
      results.push(intentResult);
    }

    return results;
  }

  public async recoverPlan(planId: string): Promise<RecoveryResult> {
    const plan = await this.repository.getExecutionPlan(planId);
    if (!plan) {
      return {
        entityId: planId,
        intentId: planId,
        entityType: 'PLAN',
        previousStatus: 'UNKNOWN',
        reconciledStatus: 'FAILED',
        actionTaken: 'PLAN_NOT_FOUND',
        error: `ExecutionPlan ${planId} not found in repository.`
      };
    }

    const leaseResourceId = `plan:${planId}`;
    const leaseClaimed = await this.repository.acquireLease(leaseResourceId, this.workerId, this.leaseDurationMs);
    if (!leaseClaimed) {
      return {
        entityId: planId,
        intentId: planId,
        entityType: 'PLAN',
        previousStatus: 'ACTIVE',
        reconciledStatus: 'ACTIVE',
        actionTaken: 'LEASE_LOCKED_BY_OTHER_WORKER'
      };
    }

    try {
      const steps = await this.repository.getPlanSteps(planId);
      let anyReverted = false;
      let lastTxHash: string | undefined = undefined;

      for (const step of steps) {
        if (step.status === 'SUCCESS') {
          if (step.txHash) lastTxHash = step.txHash;
          continue;
        }

        const stepTxs = await this.repository.getTransactionsForStep(planId, step.id);
        for (const tx of stepTxs) {
          if (tx.state === 'BROADCAST_UNCERTAIN') {
            await this.recoverUncertainTransaction(tx.transactionId);
          }

          if (tx.txHash) {
            const rpc = this.getRpcRunner(step.chainId);
            const status = await this.queryTransactionStatus(tx.txHash, rpc);
            if (status.status === 'CONFIRMED') {
              await this.repository.updateTransaction(tx.transactionId, { state: 'CONFIRMED', confirmedAt: Date.now() });
              await this.repository.updatePlanStep(planId, step.id, { status: 'SUCCESS', txHash: tx.txHash });
              step.status = 'SUCCESS';
              step.txHash = tx.txHash;
              lastTxHash = tx.txHash;
            } else if (status.status === 'REVERTED') {
              await this.repository.updateTransaction(tx.transactionId, { state: 'REVERTED' });
              await this.repository.updatePlanStep(planId, step.id, { status: 'FAILED', error: 'Transaction reverted on-chain' });
              step.status = 'FAILED';
              anyReverted = true;
            }
          }
        }
      }

      const allSuccess = steps.every((s) => s.status === 'SUCCESS');
      return {
        entityId: planId,
        intentId: planId,
        entityType: 'PLAN',
        previousStatus: 'ACTIVE',
        reconciledStatus: anyReverted ? 'FAILED' : (allSuccess ? 'COMPLETED' : 'ACTIVE'),
        actionTaken: allSuccess ? 'RECONCILED_COMPLETED' : (anyReverted ? 'RECONCILED_FAILED' : 'RECONCILED_IN_FLIGHT'),
        sourceTxHash: lastTxHash
      };
    } finally {
      await this.repository.releaseLease(leaseResourceId, this.workerId);
    }
  }

  public async recoverUncertainTransaction(transactionId: string): Promise<RecoveryResult> {
    const tx = await this.repository.getTransaction(transactionId);
    if (!tx) {
      return {
        entityId: transactionId,
        entityType: 'TRANSACTION',
        previousStatus: 'UNKNOWN',
        reconciledStatus: 'FAILED',
        actionTaken: 'TRANSACTION_NOT_FOUND'
      };
    }

    const rpc = this.getRpcRunner(tx.chainId);

    // 1. If txHash exists, verify receipt
    if (tx.txHash) {
      const txStatus = await this.queryTransactionStatus(tx.txHash, rpc);
      if (txStatus.status === 'CONFIRMED') {
        await this.repository.updateTransaction(transactionId, {
          state: 'CONFIRMED',
          confirmedAt: Date.now()
        });
        await this.repository.updatePlanStep(tx.planId, tx.stepId, {
          status: 'SUCCESS',
          txHash: tx.txHash
        });
        return {
          entityId: transactionId,
          entityType: 'TRANSACTION',
          previousStatus: tx.state,
          reconciledStatus: 'CONFIRMED',
          actionTaken: 'CONFIRMED_VIA_RECEIPT',
          sourceTxHash: tx.txHash
        };
      } else if (txStatus.status === 'REVERTED') {
        await this.repository.updateTransaction(transactionId, {
          state: 'REVERTED'
        });
        await this.repository.updatePlanStep(tx.planId, tx.stepId, {
          status: 'FAILED',
          error: 'Transaction reverted on-chain'
        });
        return {
          entityId: transactionId,
          entityType: 'TRANSACTION',
          previousStatus: tx.state,
          reconciledStatus: 'REVERTED',
          actionTaken: 'RECONCILED_REVERTED',
          sourceTxHash: tx.txHash
        };
      }
    }

    // 2. If txHash is missing but sender + nonce are known, attempt nonce discovery
    if (tx.nonce !== undefined && tx.fromAddress && rpc) {
      const discovery = await this.evmAdapter.discoverTransactionByNonce({
        sender: tx.fromAddress,
        nonce: tx.nonce,
        provider: rpc
      });

      if (discovery.found && discovery.txHash) {
        const status = await this.queryTransactionStatus(discovery.txHash, rpc);
        if (status.status === 'CONFIRMED') {
          await this.repository.updateTransaction(transactionId, {
            txHash: discovery.txHash,
            state: 'CONFIRMED',
            confirmedAt: Date.now()
          });
          await this.repository.updatePlanStep(tx.planId, tx.stepId, {
            status: 'SUCCESS',
            txHash: discovery.txHash
          });
          return {
            entityId: transactionId,
            entityType: 'TRANSACTION',
            previousStatus: tx.state,
            reconciledStatus: 'CONFIRMED',
            actionTaken: 'DISCOVERED_VIA_NONCE',
            sourceTxHash: discovery.txHash
          };
        }
      }
    }

    // 3. Check if sender's nonce has advanced beyond tx.nonce without our tx
    if (tx.nonce !== undefined && tx.fromAddress && rpc && typeof rpc.getTransactionCount === 'function') {
      try {
        const latestNonce = await rpc.getTransactionCount(tx.fromAddress, 'latest');
        if (latestNonce > tx.nonce) {
          // A different transaction consumed this nonce
          await this.repository.updateTransaction(transactionId, {
            state: 'RECOVERY_REQUIRED',
            errorMessage: `Nonce ${tx.nonce} was consumed by another on-chain transaction.`
          });
          return {
            entityId: transactionId,
            entityType: 'TRANSACTION',
            previousStatus: tx.state,
            reconciledStatus: 'RECOVERY_REQUIRED',
            actionTaken: 'NONCE_CONFLICT_DETECTED'
          };
        } else if (latestNonce === tx.nonce) {
          // The nonce is untouched; check pending mempool
          const pendingNonce = typeof rpc.getTransactionCount === 'function'
            ? await rpc.getTransactionCount(tx.fromAddress, 'pending').catch(() => latestNonce)
            : latestNonce;

          if (pendingNonce === latestNonce) {
            // Unincluded in block and not in mempool: safe to mark BROADCAST_FAILED for retry
            await this.repository.updateTransaction(transactionId, {
              state: 'BROADCAST_FAILED',
              errorMessage: 'Proven not accepted by network nodes.'
            });
            return {
              entityId: transactionId,
              entityType: 'TRANSACTION',
              previousStatus: tx.state,
              reconciledStatus: 'BROADCAST_FAILED',
              actionTaken: 'PROVEN_UNBROADCAST_SAFE_FOR_RETRY'
            };
          }
        }
      } catch (err: any) {
        console.warn('[RecoveryEngine] Nonce verification note:', err?.message || err);
      }
    }

    // 4. Ambiguity remains unresolved -> Fail Closed into RECOVERY_REQUIRED
    await this.repository.updateTransaction(transactionId, {
      state: 'RECOVERY_REQUIRED',
      errorMessage: 'Unresolved broadcast ambiguity during recovery.'
    });
    return {
      entityId: transactionId,
      entityType: 'TRANSACTION',
      previousStatus: tx.state,
      reconciledStatus: 'RECOVERY_REQUIRED',
      actionTaken: 'AMBIGUOUS_MOVED_TO_RECOVERY_REQUIRED'
    };
  }

  public async validateStartupConsistency(): Promise<ConsistencyCheckViolation[]> {
    const violations: ConsistencyCheckViolation[] = [];

    // Check 1: Expired leases
    const expiredLeases = await this.repository.listExpiredLeases();
    for (const lease of expiredLeases) {
      await this.repository.releaseLease(lease.resourceId, lease.workerId);
      violations.push({
        code: 'EXPIRED_LEASE_RECLAIMED',
        entityId: lease.resourceId,
        description: `Expired lease owned by ${lease.workerId} was reclaimed.`,
        actionTaken: 'RECLAIMED',
        details: lease
      });
    }

    // Check 2: Active plans consistency
    const activePlans = await this.repository.listActiveExecutionPlans();
    for (const plan of activePlans) {
      const steps = await this.repository.getPlanSteps(plan.planId);
      const isMarkedComplete = steps.every((s) => s.status === 'SUCCESS');
      const finalStep = steps[steps.length - 1];

      if (isMarkedComplete && finalStep && finalStep.status !== 'SUCCESS') {
        violations.push({
          code: 'PLAN_COMPLETE_STEP_INCOMPLETE',
          entityId: plan.planId,
          description: `Plan ${plan.planId} has inconsistent final step status.`,
          actionTaken: 'MOVED_TO_RECOVERY_REQUIRED'
        });
      }

      for (const step of steps) {
        if (step.status === 'SUCCESS' && (step.type === 'SOURCE_SWAP' || step.type === 'BRIDGE_DEPOSIT') && !step.txHash) {
          violations.push({
            code: 'STEP_SUCCESS_WITHOUT_TXHASH',
            entityId: `${plan.planId}:${step.id}`,
            description: `Step ${step.id} is marked SUCCESS but lacks a transaction hash.`,
            actionTaken: 'MOVED_TO_RECOVERY_REQUIRED'
          });
        }
      }
    }

    return violations;
  }

  public async recoverIntent(intentId: string): Promise<RecoveryResult> {
    const intent = await this.repository.getIntent(intentId);
    if (!intent) {
      return {
        entityId: intentId,
        intentId,
        entityType: 'INTENT',
        previousStatus: 'FAILED',
        reconciledStatus: 'FAILED',
        actionTaken: 'INTENT_NOT_FOUND',
        error: `Intent ${intentId} not found in repository.`
      };
    }

    // Claim Lease Lock
    const leaseClaimed = await this.repository.claimIntentLease(
      intentId,
      this.workerId,
      this.leaseDurationMs
    );

    if (!leaseClaimed) {
      return {
        entityId: intentId,
        intentId,
        entityType: 'INTENT',
        previousStatus: intent.status,
        reconciledStatus: intent.status,
        actionTaken: 'LEASE_LOCKED_BY_OTHER_WORKER'
      };
    }

    try {
      const order = await this.repository.getProviderOrder(intentId);
      const steps = await this.repository.getStepsForIntent(intentId);
      const prevStatus = intent.status;

      // 1. Check Source Transaction State on Blockchain
      if (intent.sourceTxHash) {
        const sourceRpc = this.getRpcRunner(intent.sourceChainId);
        const txState = await this.queryTransactionStatus(intent.sourceTxHash, sourceRpc);

        if (txState.status === 'REVERTED') {
          await this.repository.updateIntent(intentId, {
            status: 'FAILED',
            errorMessage: 'Source transaction reverted on-chain during recovery inspection.'
          });
          for (const s of steps) {
            if (s.type === 'SOURCE_SWAP' || s.type === 'BRIDGE_DEPOSIT') {
              await this.repository.updateStep(s.stepId, {
                status: 'FAILED',
                error: 'Transaction reverted on-chain'
              });
            }
          }
          return {
            entityId: intentId,
            intentId,
            entityType: 'INTENT',
            previousStatus: prevStatus,
            reconciledStatus: 'FAILED',
            actionTaken: 'RECONCILED_SOURCE_REVERT',
            sourceTxHash: intent.sourceTxHash
          };
        }

        if (txState.status === 'CONFIRMED' && intent.status === 'CREATED') {
          await this.repository.updateIntent(intentId, { status: 'FULFILLING' });
        }
      }

      // 2. Check Bridge Provider Fulfillment State
      if (order && order.sourceTxHash) {
        let quote: any = null;
        try {
          quote = JSON.parse(order.quoteJson);
        } catch {
          quote = {};
        }

        const providerAdapter = this.aggregator.getProvider(order.provider);
        if (providerAdapter && typeof providerAdapter.getStatus === 'function') {
          try {
            const providerStatus = await providerAdapter.getStatus(order.sourceTxHash, quote);

            if (providerStatus.state === 'DESTINATION_FILLED' && providerStatus.destinationTxHash) {
              const destRpc = this.getRpcRunner(intent.destinationChainId);
              const destTxState = await this.queryTransactionStatus(providerStatus.destinationTxHash, destRpc);

              if (destTxState.status === 'CONFIRMED' || destTxState.status === 'UNKNOWN_MOCKED') {
                await this.repository.updateProviderOrder(order.orderId, {
                  destinationTxHash: providerStatus.destinationTxHash,
                  status: 'SETTLED'
                });

                await this.repository.updateIntent(intentId, {
                  destinationTxHash: providerStatus.destinationTxHash,
                  status: 'SETTLED'
                });

                await this.repository.recordSettlement({
                  intentId,
                  destinationTxHash: providerStatus.destinationTxHash,
                  destinationChainId: intent.destinationChainId,
                  tokenAddress: intent.destinationTokenAddress,
                  tokenSymbol: intent.destinationTokenSymbol,
                  recipient: intent.userAddress,
                  expectedAmountRaw: intent.expectedAmountOutRaw,
                  actualAmountRaw: intent.expectedAmountOutRaw,
                  verified: true,
                  verifiedAt: Date.now()
                });

                return {
                  entityId: intentId,
                  intentId,
                  entityType: 'INTENT',
                  previousStatus: prevStatus,
                  reconciledStatus: 'SETTLED',
                  actionTaken: 'RECONCILED_SETTLED',
                  sourceTxHash: intent.sourceTxHash,
                  destinationTxHash: providerStatus.destinationTxHash
                };
              } else if (destTxState.status === 'REVERTED') {
                await this.repository.updateIntent(intentId, {
                  status: 'FAILED',
                  errorMessage: 'Destination transaction reverted on-chain.'
                });
                return {
                  entityId: intentId,
                  intentId,
                  entityType: 'INTENT',
                  previousStatus: prevStatus,
                  reconciledStatus: 'FAILED',
                  actionTaken: 'DESTINATION_VERIFICATION_FAILED',
                  destinationTxHash: providerStatus.destinationTxHash
                };
              }
            } else if (providerStatus.state === 'REFUNDED') {
              await this.repository.updateIntent(intentId, { status: 'REFUNDED' });
              await this.repository.updateProviderOrder(order.orderId, { status: 'REFUNDED' });
              return {
                entityId: intentId,
                intentId,
                entityType: 'INTENT',
                previousStatus: prevStatus,
                reconciledStatus: 'REFUNDED',
                actionTaken: 'RECONCILED_REFUNDED'
              };
            }
          } catch (providerErr: any) {
            return {
              entityId: intentId,
              intentId,
              entityType: 'INTENT',
              previousStatus: prevStatus,
              reconciledStatus: prevStatus,
              actionTaken: 'TRACKING_UNAVAILABLE',
              error: providerErr?.message
            };
          }
        }
      }

      // 3. If destination transaction already exists on intent (e.g. from solver execution)
      if (intent.destinationTxHash && intent.status !== 'SETTLED' && intent.status !== 'FAILED') {
        const destRpc = this.getRpcRunner(intent.destinationChainId);
        const destTxState = await this.queryTransactionStatus(intent.destinationTxHash, destRpc);
        if (destTxState.status === 'CONFIRMED' || destTxState.status === 'UNKNOWN_MOCKED') {
          await this.repository.updateIntent(intentId, { status: 'SETTLED' });
          if (order) {
            await this.repository.updateProviderOrder(order.orderId, { status: 'SETTLED', destinationTxHash: intent.destinationTxHash });
          }
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
          });
          return {
            entityId: intentId,
            intentId,
            entityType: 'INTENT',
            previousStatus: prevStatus,
            reconciledStatus: 'SETTLED',
            actionTaken: 'RECONCILED_SETTLED',
            sourceTxHash: intent.sourceTxHash,
            destinationTxHash: intent.destinationTxHash
          };
        } else if (destTxState.status === 'REVERTED') {
          await this.repository.updateIntent(intentId, {
            status: 'FAILED',
            errorMessage: 'Destination transaction reverted on-chain.'
          });
          return {
            entityId: intentId,
            intentId,
            entityType: 'INTENT',
            previousStatus: prevStatus,
            reconciledStatus: 'FAILED',
            actionTaken: 'DESTINATION_VERIFICATION_FAILED',
            destinationTxHash: intent.destinationTxHash
          };
        }
      }

      return {
        entityId: intentId,
        intentId,
        entityType: 'INTENT',
        previousStatus: prevStatus,
        reconciledStatus: intent.status,
        actionTaken: 'IN_FLIGHT_RESUMED'
      };
    } finally {
      await this.repository.releaseIntentLease(intentId, this.workerId);
    }
  }

  private getRpcRunner(chainId: string): any {
    if (this.rpcProviders[chainId]) return this.rpcProviders[chainId];
    const chain = defaultChainRegistry.getChain(chainId);
    return chain?.rpcEndpoints?.[0]?.url;
  }

  private async queryTransactionStatus(
    txHash: string,
    rpcRunner?: any,
    chainId?: string
  ): Promise<{ status: 'CONFIRMED' | 'REVERTED' | 'PENDING' | 'NOT_FOUND' | 'UNKNOWN_MOCKED' }> {
    if (typeof rpcRunner === 'object' && typeof rpcRunner.getTransactionReceipt === 'function') {
      try {
        const receipt = await rpcRunner.getTransactionReceipt(txHash);
        if (!receipt) return { status: 'PENDING' };
        return { status: receipt.status === 1 || receipt.status === '0x1' ? 'CONFIRMED' : 'REVERTED' };
      } catch {
        return { status: 'PENDING' };
      }
    }

    if (typeof rpcRunner === 'string') {
      try {
        const res = await fetch(rpcRunner, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionReceipt',
            params: [txHash]
          }),
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
          const json = await res.json();
          if (json.result) {
            const status = json.result.status;
            return { status: status === '0x1' || status === 1 ? 'CONFIRMED' : 'REVERTED' };
          }
          return { status: 'PENDING' };
        }
      } catch {
        // RPC fetch error
      }
    }

    if (chainId) {
      try {
        const receipt = await this.rpcClient.getTransactionReceipt(chainId, txHash);
        if (receipt) {
          return { status: receipt.status === 1 || receipt.status === '0x1' ? 'CONFIRMED' : 'REVERTED' };
        }
        return { status: 'PENDING' };
      } catch {
        return { status: 'PENDING' };
      }
    }

    return { status: 'UNKNOWN_MOCKED' };
  }
}

