import { Contract } from 'ethers';
import { defaultChainRegistry } from '@zenith/chains';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];
import {
  ExecutionStep,
  QuoteResponse,
  ReceiptView,
  ExecutionPlan,
  ExecutionPlanStep,
  StepStatus
} from '@zenith/types';
import { defaultEVMAdapter, EVMExecutionAdapter } from './adapters/evmAdapter';
import { defaultSolanaAdapter, SolanaExecutionAdapter } from './adapters/solanaAdapter';
import { ExecutionStateMachine } from './stateMachine';
import { defaultIntentEngine, CrossChainIntentEngine } from './crosschain/intentEngine';
import { defaultCrossChainTracker, CrossChainTracker, ActiveCrossChainOrder } from './crosschain/crossChainTracker';
import { defaultDestinationExecutionEngine, DestinationExecutionEngine } from './crosschain/destinationExecutionEngine';
import { ExecutionPlanBuilder, ExecutionPlanValidator, sealPlan, assertPlanIntegrity } from './executionPlanBuilder';
import { defaultTokenRiskEngine } from '@zenith/security';
import {
  RecipientMismatchError,
  SecurityPolicyViolationError,
  ConfigurationError,
  SignerRequiredError,
  ExecutionUnavailableError,
  DestinationExecutionUnavailableError,
  SourceSwapUnavailableError,
  SourceSwapFailedError,
  BridgeFailedError,
  DestinationExecutionFailedError,
  CompositeExecutionUnavailableError,
  RecoveryRequiredError,
  LeaseLockConflictError,
  AmountMismatchError,
  StatusConflictError,
  QuoteUnavailableError
} from '@zenith/contracts';
import { CrossChainStateRepository, defaultInMemoryRepository } from './persistence/repository';
import { extractActualSourceSwapOutput } from './crosschain/sourceSwapOutputExtractor';

import { defaultDEXAggregator, defaultCrossChainAggregator, validateCrossChainQuoteExecutability } from '@zenith/routing';

export interface ExecuteTradeParams {
  quote?: QuoteResponse;
  plan?: ExecutionPlan;
  userAddress: string;
  stateMachine?: ExecutionStateMachine;
  signer?: any;
  destSigner?: any;
  provider?: any;
  destProvider?: any;
  skipDestinationWait?: boolean;
  actualAmounts?: {
    sourceSwapActualOut?: bigint;
    bridgeActualOut?: bigint;
    destSwapActualOut?: bigint;
  };
  maxPollDurationMs?: number;
  repository?: CrossChainStateRepository;
}

export class ExecutionCoordinator {
  private evmAdapter: EVMExecutionAdapter;
  private solanaAdapter: SolanaExecutionAdapter;
  private intentEngine: CrossChainIntentEngine;
  private tracker: CrossChainTracker;
  private destinationEngine: DestinationExecutionEngine;
  private repository: CrossChainStateRepository;
  private workerId: string;
  private executedStepRegistry: Map<string, { txHash?: string; status: StepStatus }> = new Map();

  constructor(
    evmAdapter = defaultEVMAdapter,
    solanaAdapter = defaultSolanaAdapter,
    intentEngine = defaultIntentEngine,
    tracker = defaultCrossChainTracker,
    destinationEngine = defaultDestinationExecutionEngine,
    repository = defaultInMemoryRepository,
    workerId?: string
  ) {
    this.evmAdapter = evmAdapter;
    this.solanaAdapter = solanaAdapter;
    this.intentEngine = intentEngine;
    this.tracker = tracker;
    this.destinationEngine = destinationEngine;
    this.repository = repository;
    this.workerId = workerId || `worker-${typeof process !== 'undefined' ? process.pid || 1 : 1}-${Date.now()}`;
  }

  public async executeTrade(params: ExecuteTradeParams): Promise<ReceiptView> {
    const stateMachine = params.stateMachine || new ExecutionStateMachine();

    // 1. Resolve Authoritative ExecutionPlan
    let plan: ExecutionPlan;
    if (params.plan) {
      plan = params.plan;
    } else if (params.quote) {
      if (params.quote.executionPlan) {
        plan = params.quote.executionPlan;
      } else {
        if (!params.quote.bestRoute.execution && params.userAddress) {
          if (!params.quote.bestRoute.crossChainQuote && params.quote.bestRoute.dexQuote) {
            try {
              const exec = await defaultDEXAggregator.buildExecution(
                params.quote.bestRoute.dexQuote,
                params.userAddress,
                params.quote.request?.recipientAddress || params.userAddress
              );
              if (exec) {
                params.quote.bestRoute.execution = exec;
                params.quote.bestRoute.isExecutable = true;
                params.quote.bestRoute.unexecutableReason = undefined;
              }
            } catch (execErr) {
              console.warn('[ExecutionCoordinator] DEX buildExecution notice:', execErr);
            }
          } else if (params.quote.bestRoute.crossChainQuote) {
            try {
              const exec = await defaultCrossChainAggregator.buildExecution(
                params.quote.bestRoute.crossChainQuote,
                params.userAddress,
                params.quote.request?.recipientAddress || (params.quote.request as any)?.recipient || params.userAddress
              );
              if (exec) {
                params.quote.bestRoute.execution = exec;
                params.quote.bestRoute.isExecutable = true;
                params.quote.bestRoute.unexecutableReason = undefined;
              }
            } catch (execErr) {
              console.warn('[ExecutionCoordinator] Cross-chain buildExecution notice:', execErr);
            }
          }
        }

        const effectiveRecipient =
          params.quote.request?.recipientAddress ||
          (params.quote.request as any)?.recipient ||
          params.userAddress;

        plan = ExecutionPlanBuilder.buildPlan({
          route: params.quote.bestRoute,
          request: {
            ...params.quote.request,
            userWalletAddress: params.userAddress,
            recipientAddress: effectiveRecipient
          },
          options: {
            userAddress: params.userAddress,
            recipientAddress: effectiveRecipient
          }
        });
      }
    } else {
      throw new ConfigurationError('[ExecutionCoordinator] Neither ExecutionPlan nor QuoteResponse provided for execution.');
    }

    // 2. Comprehensive Plan & Dependency Validation (Fail Closed)
    ExecutionPlanValidator.validatePlan(plan);
    assertPlanIntegrity(plan);

    if (!plan.isExecutable) {
      if (plan.unexecutableReason?.includes('DESTINATION_EXECUTION_UNAVAILABLE')) {
        throw new DestinationExecutionUnavailableError(
          plan.tokenOut.symbol,
          plan.destinationChainId
        );
      }
      if (plan.unexecutableReason?.includes('SOURCE_SWAP_UNAVAILABLE')) {
        throw new SourceSwapUnavailableError(
          plan.unexecutableReason || 'Source DEX swap cannot be constructed: calldata missing.'
        );
      }
      if (plan.unexecutableReason?.includes('COMPOSITE_EXECUTION_UNAVAILABLE')) {
        throw new CompositeExecutionUnavailableError(plan.unexecutableReason);
      }
      throw new ExecutionUnavailableError(
        `[ExecutionCoordinator] Execution plan is not executable: ${plan.unexecutableReason || 'UNEXECUTABLE_ROUTE'}`
      );
    }

    const sourceChain = defaultChainRegistry.getChain(plan.sourceChainId);
    const destChain = defaultChainRegistry.getChain(plan.destinationChainId);

    if (!sourceChain || !destChain) {
      throw new ConfigurationError('[ExecutionCoordinator] Source or destination chain config not found in registry');
    }

    const isCrossChain = plan.sourceChainId !== plan.destinationChainId;

    // 3. Security Policy & Recipient Validation
    const expectedRecipient =
      (plan as any)?.recipient ||
      params.quote?.request?.recipientAddress ||
      params.quote?.request?.userWalletAddress ||
      params.userAddress;
    if (params.userAddress.toLowerCase() !== expectedRecipient.toLowerCase()) {
      throw new RecipientMismatchError(params.userAddress, expectedRecipient);
    }

    const riskIn = defaultTokenRiskEngine.evaluateToken(plan.tokenIn);
    const riskOut = defaultTokenRiskEngine.evaluateToken(plan.tokenOut);

    if (!riskIn.isTradeable) {
      throw new SecurityPolicyViolationError(
        `Execution blocked: Token ${plan.tokenIn.symbol} failed security policy (${riskIn.overallRiskLevel} risk).`,
        riskIn.reasons
      );
    }
    if (!riskOut.isTradeable) {
      throw new SecurityPolicyViolationError(
        `Execution blocked: Token ${plan.tokenOut.symbol} failed security policy (${riskOut.overallRiskLevel} risk).`,
        riskOut.reasons
      );
    }

    if (sourceChain.executionEnvironment === 'EVM' && !params.signer) {
      throw new SignerRequiredError('Wallet signer is required to sign and broadcast transaction on-chain.');
    }

    // 4. Authoritative ExecutionPlan Persistence (Immutable once stored)
    const repo = params.repository || this.repository;
    try {
      const existingPlan = await repo.getExecutionPlan(plan.planId);
      if (!existingPlan) {
        await repo.saveExecutionPlan(plan);
      }
    } catch (persistErr: any) {
      console.warn('[ExecutionCoordinator] ExecutionPlan persistence notice:', persistErr?.message || persistErr);
    }

    // 5. Initialize ExecutionStateMachine with deterministic steps from plan
    const uiSteps: ExecutionStep[] = plan.steps.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      status: 'PENDING'
    }));

    stateMachine.initializeSteps(uiSteps);

    // 6. Dependency-Aware DAG Traversal
    const topologicalSteps = ExecutionPlanValidator.getTopologicalOrder(plan);
    const stepStateMap = new Map<string, ExecutionPlanStep>();
    plan.steps.forEach((s) => stepStateMap.set(s.id, { ...s }));

    let txHash = '';
    let destinationTxHash: string | undefined = undefined;
    let gasUsedWei: bigint = 0n;
    let gasPriceWei: bigint = 0n;
    let lastSourceSwapOutput: bigint | undefined = params.actualAmounts?.sourceSwapActualOut;

    if (isCrossChain && params.quote?.intent) {
      this.intentEngine.registerIntent(params.quote.intent);
      this.intentEngine.updateIntentState(params.quote.intent.orderId, 'SIGNED');
      this.intentEngine.updateIntentState(params.quote.intent.orderId, 'SUBMITTED');
    }

    // Step Execution Loop
    for (const step of topologicalSteps) {
      // Step Dependency Gate: Every declared dependency must be in SUCCESS state
      for (const depId of step.dependencies) {
        const depStep = stepStateMap.get(depId);
        if (!depStep || depStep.status !== 'SUCCESS') {
          step.status = 'FAILED';
          stepStateMap.set(step.id, step);
          stateMachine.transitionTo('FAILED', {
            id: step.id,
            status: 'ERROR',
            error: `Dependency step "${depId}" did not complete successfully.`
          });
          throw new ExecutionUnavailableError(`Step "${step.id}" blocked: dependency "${depId}" failed or was not executed.`);
        }
      }

      // Step Worker Lease Lock (Prevents concurrent duplicate step execution across workers)
      const stepResourceId = `step:${plan.planId}:${step.id}`;
      const leaseAcquired = await repo.acquireLease(stepResourceId, this.workerId, 30000);
      if (!leaseAcquired) {
        throw new LeaseLockConflictError(stepResourceId, 'Another worker is actively executing this step.');
      }

      try {
        // Persistent Idempotency Gate: Check database and memory state
        const persistedStep = await repo.getPlanStep(plan.planId, step.id);
        const idempotencyKey = `${plan.planId}:${step.id}`;
        const existingExecution = this.executedStepRegistry.get(idempotencyKey);

        if ((persistedStep && persistedStep.status === 'SUCCESS') || (existingExecution && existingExecution.status === 'SUCCESS') || step.status === 'SUCCESS') {
          console.log(`[ZENITH ExecutionCoordinator] Idempotency: Step "${step.id}" already completed successfully. Skipping re-broadcast.`);
          step.status = 'SUCCESS';
          step.txHash = persistedStep?.txHash || existingExecution?.txHash || step.txHash;
          if (step.type === 'SOURCE_SWAP' || step.type === 'BRIDGE_DEPOSIT') {
            txHash = step.txHash || txHash;
          } else if (step.type === 'DESTINATION_SWAP' || step.type === 'BRIDGE_RELAY_WAIT') {
            destinationTxHash = step.txHash || destinationTxHash;
          }
          stepStateMap.set(step.id, step);
          this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS', txHash: step.txHash });
          stateMachine.transitionTo('CONFIRMING', { id: step.id, status: 'SUCCESS', txHash: step.txHash });
          continue;
        }

        // Check for uncertain or recovery required transactions for this step
        const stepTxs = await repo.getTransactionsForStep(plan.planId, step.id);
        const uncertainTx = stepTxs.find((t) => t.state === 'BROADCAST_UNCERTAIN' || t.state === 'RECOVERY_REQUIRED');
        if (uncertainTx) {
          throw new RecoveryRequiredError(
            `Step "${step.id}" has an uncertain broadcast (txId: ${uncertainTx.transactionId}). Must be reconciled before execution can continue.`,
            uncertainTx
          );
        }

      // Execute Step Based on Type
      switch (step.type) {
        case 'VALIDATION': {
          stateMachine.transitionTo('SIMULATING', { id: step.id, status: 'ACTIVE' });
          step.status = 'SUCCESS';
          stepStateMap.set(step.id, step);
          this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS' });
          stateMachine.transitionTo('SIMULATED', { id: step.id, status: 'SUCCESS' });
          break;
        }

        case 'APPROVAL':
        case 'SOURCE_APPROVAL': {
          if (step.executionEnvironment === 'EVM' && step.requiredTokenAddress && step.approvalTarget && step.requiredAmountRaw) {
            stateMachine.transitionTo('APPROVING', { id: step.id, status: 'ACTIVE' });
            const currentAllowance = await this.evmAdapter.checkAllowance({
              tokenAddress: step.requiredTokenAddress,
              ownerAddress: params.userAddress,
              spenderAddress: step.approvalTarget,
              signer: params.signer,
              provider: params.provider
            });

            const requiredAllowance = BigInt(step.requiredAmountRaw);
            if (currentAllowance < requiredAllowance) {
              if (step.calldata && step.calldata !== '0x') {
                const execResult = await this.evmAdapter.executeTransaction({
                  chainId: step.chainId,
                  to: step.targetAddress || step.requiredTokenAddress,
                  data: step.calldata,
                  value: step.valueWei || '0',
                  approvalTarget: step.approvalTarget,
                  tokenInAddress: step.requiredTokenAddress,
                  tokenInSymbol: step.requiredTokenSymbol,
                  amountInRaw: step.requiredAmountRaw,
                  userAddress: params.userAddress,
                  signer: params.signer,
                  provider: params.provider,
                  onStatusChange: (status, hash) => {
                    if (status === 'APPROVING') {
                      stateMachine.transitionTo('APPROVING', { id: step.id, status: 'ACTIVE' });
                    } else if (status === 'APPROVED') {
                      stateMachine.transitionTo('APPROVED', { id: step.id, status: 'SUCCESS', txHash: hash });
                    }
                  }
                });
                step.txHash = execResult.txHash;
              } else {
                stateMachine.transitionTo('APPROVING', { id: step.id, status: 'ACTIVE' });
                const tokenContract = new Contract(step.requiredTokenAddress, ERC20_ABI, params.signer);
                const approveTx = await tokenContract.approve(step.approvalTarget, requiredAllowance);
                if (typeof approveTx?.wait === 'function') {
                  const approveReceipt = await approveTx.wait(1);
                  if (!approveReceipt || approveReceipt.status === 0) {
                    throw new Error(`Approval transaction reverted on-chain: ${approveTx.hash}`);
                  }
                }
                step.txHash = approveTx?.hash;
                stateMachine.transitionTo('APPROVED', { id: step.id, status: 'SUCCESS', txHash: step.txHash });
              }
            }
            step.status = 'SUCCESS';
            stepStateMap.set(step.id, step);
            this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS', txHash: step.txHash });
            stateMachine.transitionTo('APPROVED', { id: step.id, status: 'SUCCESS' });
          } else {
            step.status = 'SUCCESS';
            stepStateMap.set(step.id, step);
            this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS' });
          }
          break;
        }

        case 'SOURCE_SWAP': {
          if (sourceChain.executionEnvironment === 'SOLANA') {
            const solResult = await this.solanaAdapter.executeSwap({
              quote: params.quote!,
              userPublicKey: params.userAddress,
              walletProvider: params.signer,
              onStatusChange: (status, signature) => {
                if (signature) txHash = signature;
                stateMachine.transitionTo(status, { id: step.id, status: 'ACTIVE', txHash: signature });
              }
            });
            txHash = solResult.txSignature;
            step.txHash = txHash;
            step.status = 'SUCCESS';
            stepStateMap.set(step.id, step);
            this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS', txHash });
            stateMachine.transitionTo('CONFIRMING', { id: step.id, status: 'SUCCESS', txHash });
          } else {
            stateMachine.transitionTo('SIGNING', { id: step.id, status: 'ACTIVE' });
            let swapTxHash = '';
            try {
              const execResult = await this.evmAdapter.executeTransaction({
                chainId: step.chainId,
                to: step.targetAddress!,
                data: step.calldata!,
                value: step.valueWei || '0',
                approvalTarget: step.approvalTarget,
                tokenInAddress: step.requiredTokenAddress,
                tokenInSymbol: step.requiredTokenSymbol,
                amountInRaw: step.requiredAmountRaw,
                userAddress: params.userAddress,
                signer: params.signer,
                provider: params.provider,
                onStatusChange: (status, hash) => {
                  if (hash) swapTxHash = hash;
                  if (status === 'SUBMITTING' || status === 'BROADCASTED' || status === 'CONFIRMING') {
                    stateMachine.transitionTo(status, { id: step.id, status: 'ACTIVE', txHash: hash });
                  }
                }
              });
              swapTxHash = execResult.txHash;
              txHash = swapTxHash;
              gasUsedWei = execResult.gasUsed;
              gasPriceWei = execResult.effectiveGasPriceWei;

              if (lastSourceSwapOutput === undefined && execResult?.receipt && step.outputTokenAddress) {
                try {
                  const extractionResult = extractActualSourceSwapOutput({
                    receipt: execResult.receipt,
                    expectedTokenOutAddress: step.outputTokenAddress,
                    recipientAddress: params.userAddress,
                    minimumAmountOutRaw: step.minimumAmountOutRaw || '0',
                    sourceChainId: step.chainId,
                    fallbackAmountRaw: step.expectedAmountOutRaw
                  });
                  lastSourceSwapOutput = extractionResult.actualAmountBig;
                } catch (extractErr) {
                  console.warn('[ExecutionCoordinator] extractActualSourceSwapOutput error:', extractErr);
                  throw extractErr;
                }
              } else if (lastSourceSwapOutput !== undefined && step.minimumAmountOutRaw) {
                if (lastSourceSwapOutput < BigInt(step.minimumAmountOutRaw)) {
                  throw new AmountMismatchError(
                    step.minimumAmountOutRaw,
                    lastSourceSwapOutput.toString(),
                    `Actual output amount ${lastSourceSwapOutput.toString()} was less than minimum acceptable amount ${step.minimumAmountOutRaw}`
                  );
                }
              }

              step.txHash = swapTxHash;
              step.status = 'SUCCESS';
              stepStateMap.set(step.id, step);
              this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS', txHash: swapTxHash });
              stateMachine.transitionTo('CONFIRMING', { id: step.id, status: 'SUCCESS', txHash: swapTxHash });
            } catch (err: any) {
              step.status = 'FAILED';
              step.error = err?.message;
              stepStateMap.set(step.id, step);
              stateMachine.transitionTo('FAILED', { id: step.id, status: 'ERROR', error: err?.message });
              if (err instanceof AmountMismatchError || err instanceof StatusConflictError) {
                throw err;
              }
              throw new SourceSwapFailedError(err?.message || 'Source swap transaction failed', swapTxHash);
            }
          }
          break;
        }

        case 'BRIDGE_QUOTE_REFRESH': {
          stateMachine.transitionTo('SIMULATING', { id: step.id, status: 'ACTIVE' });
          const bridgeInputAmount = (lastSourceSwapOutput !== undefined ? lastSourceSwapOutput.toString() : step.requiredAmountRaw) || '0';

          const refreshedQuote = await defaultCrossChainAggregator.getQuote({
            sourceChainId: plan.sourceChainId,
            destinationChainId: plan.destinationChainId,
            tokenIn: {
              address: step.requiredTokenAddress || plan.tokenIn.address,
              symbol: step.requiredTokenSymbol || 'USDC',
              name: step.requiredTokenSymbol || 'USDC',
              decimals: 6,
              chainId: plan.sourceChainId,
              verificationTier: 'VERIFIED_CANONICAL'
            },
            tokenOut: plan.tokenOut,
            amountInRaw: bridgeInputAmount,
            userWalletAddress: params.userAddress,
            recipientAddress: params.quote?.request?.recipientAddress || params.userAddress,
            slippageTolerancePercent: params.quote?.request?.slippageTolerancePercent ?? 0.5
          });

          if (refreshedQuote) {
            const execCheck = validateCrossChainQuoteExecutability(refreshedQuote);
            if (!execCheck.isExecutable || !refreshedQuote.isExecutable) {
              throw new QuoteUnavailableError(
                `Refreshed bridge quote failed executability validation: ${execCheck.unexecutableReason || refreshedQuote.unexecutableReason || 'BRIDGE_UNAVAILABLE'}`
              );
            }

            const refreshedExec = await defaultCrossChainAggregator.buildExecution(
              refreshedQuote,
              params.userAddress,
              params.quote?.request?.recipientAddress || params.userAddress
            );

            // Update downstream BRIDGE_DEPOSIT step in plan, stepStateMap, and repository
            const bridgeDepositStep = plan.steps.find((s) => s.type === 'BRIDGE_DEPOSIT');
            if (bridgeDepositStep) {
              bridgeDepositStep.requiredAmountRaw = bridgeInputAmount;
              if (refreshedExec?.to || refreshedQuote.executionTarget) {
                bridgeDepositStep.targetAddress = refreshedExec?.to || refreshedQuote.executionTarget;
              }
              if (refreshedExec?.data || refreshedQuote.calldata) {
                bridgeDepositStep.calldata = refreshedExec?.data || refreshedQuote.calldata;
              }
              if (refreshedExec?.approvalTarget || refreshedQuote.approvalTarget) {
                bridgeDepositStep.approvalTarget = refreshedExec?.approvalTarget || refreshedQuote.approvalTarget;
              }
              stepStateMap.set(bridgeDepositStep.id, { ...bridgeDepositStep });
              try {
                await repo.updatePlanStep(plan.planId, bridgeDepositStep.id, {
                  requiredAmountRaw: bridgeDepositStep.requiredAmountRaw,
                  calldata: bridgeDepositStep.calldata,
                  targetAddress: bridgeDepositStep.targetAddress,
                  approvalTarget: bridgeDepositStep.approvalTarget
                });
              } catch {
                // Best effort
              }
            }
            // Update authoritative execution plan minimum and expected amounts
            (plan as any).expectedAmountOutRaw = refreshedQuote.destinationAmountRaw;
            (plan as any).minimumAmountOutRaw = refreshedQuote.minDestinationAmountRaw;
            plan.updatedAt = Date.now();
            sealPlan(plan);
          } else {
            // Update bridge deposit requiredAmountRaw with actual swap output
            const bridgeDepositStep = plan.steps.find((s) => s.type === 'BRIDGE_DEPOSIT');
            if (bridgeDepositStep) {
              bridgeDepositStep.requiredAmountRaw = bridgeInputAmount;
              stepStateMap.set(bridgeDepositStep.id, { ...bridgeDepositStep });
            }
          }

          step.status = 'SUCCESS';
          stepStateMap.set(step.id, step);
          this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS' });
          stateMachine.transitionTo('SIMULATED', { id: step.id, status: 'SUCCESS' });
          break;
        }

        case 'BRIDGE_DEPOSIT': {
          if (lastSourceSwapOutput !== undefined && step.requiredAmountRaw !== lastSourceSwapOutput.toString()) {
            step.requiredAmountRaw = lastSourceSwapOutput.toString();
          }
          stateMachine.transitionTo('SIGNING', { id: step.id, status: 'ACTIVE' });
          let bridgeTxHash = '';
          try {
            const execResult = await this.evmAdapter.executeTransaction({
              chainId: step.chainId,
              to: step.targetAddress!,
              data: step.calldata!,
              value: step.valueWei || '0',
              approvalTarget: step.approvalTarget,
              tokenInAddress: step.requiredTokenAddress,
              tokenInSymbol: step.requiredTokenSymbol,
              amountInRaw: step.requiredAmountRaw,
              userAddress: params.userAddress,
              signer: params.signer,
              provider: params.provider,
              onStatusChange: (status, hash) => {
                if (hash) bridgeTxHash = hash;
                stateMachine.transitionTo(status, { id: step.id, status: 'ACTIVE', txHash: hash });
              }
            });
            bridgeTxHash = execResult.txHash;
            txHash = bridgeTxHash;
            gasUsedWei = execResult.gasUsed;
            gasPriceWei = execResult.effectiveGasPriceWei;
            step.txHash = bridgeTxHash;
            step.status = 'SUCCESS';
            stepStateMap.set(step.id, step);
            this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS', txHash: bridgeTxHash });
            stateMachine.transitionTo('BRIDGE_IN_FLIGHT', { id: step.id, status: 'SUCCESS', txHash: bridgeTxHash });
          } catch (bridgeErr: any) {
            step.status = 'FAILED';
            step.error = bridgeErr?.message;
            stepStateMap.set(step.id, step);
            stateMachine.transitionTo('FAILED', { id: step.id, status: 'ERROR', error: bridgeErr?.message });
            throw new BridgeFailedError(bridgeErr?.message || 'Bridge deposit transaction reverted', bridgeTxHash);
          }
          break;
        }

        case 'BRIDGE_RELAY_WAIT': {
          stateMachine.transitionTo('BRIDGE_IN_FLIGHT', { id: step.id, status: 'ACTIVE' });

          const ccQuote = params.quote?.crossChainQuote || params.quote?.bestRoute?.crossChainQuote;
          const orderId = params.quote?.intent?.orderId || `order-${ccQuote?.provider?.toLowerCase() || 'bridge'}-${txHash.slice(0, 10)}`;

          const activeOrder: ActiveCrossChainOrder = {
            orderId,
            sourceChainId: plan.sourceChainId,
            destinationChainId: plan.destinationChainId,
            sourceTxHash: txHash,
            provider: ccQuote?.provider || 'ACROSS',
            recipient: params.userAddress,
            quote: ccQuote!,
            status: 'FULFILLING',
            createdAt: Date.now(),
            lastUpdated: Date.now()
          };

          this.tracker.registerOrder(activeOrder);

          if (!params.skipDestinationWait && ccQuote) {
            const trackingResult = await this.tracker.trackUntilSettled({
              order: activeOrder,
              stateMachine,
              maxPollDurationMs: params.maxPollDurationMs || step.retryPolicy.timeoutMs || 1800000,
              pollIntervalMs: step.retryPolicy.backoffMs || 2500,
              onStateChange: (state, meta) => {
                if (params.quote?.intent) {
                  this.intentEngine.updateIntentState(params.quote.intent.orderId, state, {
                    txHashDestination: meta?.destTxHash
                  });
                }
              }
            });

            if (trackingResult.isSuccess && trackingResult.destinationTxHash) {
              destinationTxHash = trackingResult.destinationTxHash;
              step.txHash = destinationTxHash;
              step.status = 'SUCCESS';
              stepStateMap.set(step.id, step);
              this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS', txHash: destinationTxHash });
              stateMachine.transitionTo('BRIDGE_DESTINATION_CONFIRMED', { id: step.id, status: 'SUCCESS', txHash: destinationTxHash });
            } else if (trackingResult.isTimeout) {
              step.status = 'FAILED';
              stepStateMap.set(step.id, step);
              throw new ExecutionUnavailableError('Cross-chain bridge relay tracking timed out.');
            } else if (trackingResult.isRefunded) {
              step.status = 'FAILED';
              stepStateMap.set(step.id, step);
              throw new ExecutionUnavailableError('Cross-chain bridge deposit was refunded on origin chain.');
            } else {
              step.status = 'FAILED';
              stepStateMap.set(step.id, step);
              throw new BridgeFailedError(trackingResult.error || 'Bridge fulfillment tracking failed');
            }
          } else {
            step.status = 'SUCCESS';
            stepStateMap.set(step.id, step);
            this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS' });
          }
          break;
        }

        case 'DESTINATION_APPROVAL': {
          // Destination token approval when executing separate destination transaction
          if (step.executionEnvironment === 'EVM' && params.destSigner && step.requiredTokenAddress && step.approvalTarget && step.requiredAmountRaw) {
            stateMachine.transitionTo('APPROVING', { id: step.id, status: 'ACTIVE' });
            const currentAllowance = await this.evmAdapter.checkAllowance({
              tokenAddress: step.requiredTokenAddress,
              ownerAddress: params.userAddress,
              spenderAddress: step.approvalTarget,
              signer: params.destSigner,
              provider: params.destProvider
            });

            const requiredAllowance = BigInt(step.requiredAmountRaw);
            if (currentAllowance < requiredAllowance) {
              if (step.calldata && step.calldata !== '0x') {
                await this.evmAdapter.executeTransaction({
                  chainId: step.chainId,
                  to: step.targetAddress || step.approvalTarget,
                  data: step.calldata,
                  value: '0',
                  approvalTarget: step.approvalTarget,
                  tokenInAddress: step.requiredTokenAddress,
                  tokenInSymbol: step.requiredTokenSymbol,
                  amountInRaw: step.requiredAmountRaw,
                  userAddress: params.userAddress,
                  signer: params.destSigner,
                  provider: params.destProvider,
                  onStatusChange: (status) => {
                    if (status === 'APPROVING') stateMachine.transitionTo('APPROVING', { id: step.id, status: 'ACTIVE' });
                    if (status === 'APPROVED') stateMachine.transitionTo('APPROVED', { id: step.id, status: 'SUCCESS' });
                  }
                });
              } else {
                stateMachine.transitionTo('APPROVING', { id: step.id, status: 'ACTIVE' });
                const tokenContract = new Contract(step.requiredTokenAddress, ERC20_ABI, params.destSigner);
                const approveTx = await tokenContract.approve(step.approvalTarget, requiredAllowance);
                if (typeof approveTx?.wait === 'function') {
                  const approveReceipt = await approveTx.wait(1);
                  if (!approveReceipt || approveReceipt.status === 0) {
                    throw new Error(`Approval transaction reverted on-chain: ${approveTx.hash}`);
                  }
                }
                step.txHash = approveTx?.hash;
                stateMachine.transitionTo('APPROVED', { id: step.id, status: 'SUCCESS', txHash: step.txHash });
              }
            }
          }
          step.status = 'SUCCESS';
          stepStateMap.set(step.id, step);
          this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS' });
          break;
        }

        case 'DESTINATION_SWAP': {
          if (plan.compositeExecutionMode === 'UNSUPPORTED') {
            stateMachine.transitionTo('FAILED', {
              id: step.id,
              status: 'ERROR',
              error: 'DESTINATION_EXECUTION_UNAVAILABLE'
            });
            throw new DestinationExecutionUnavailableError(
              plan.tokenOut.symbol,
              plan.destinationChainId
            );
          }

          if (params.destSigner) {
            // Mode C: Separate user-signed destination transaction
            try {
              stateMachine.transitionTo('SIGNING', { id: step.id, status: 'ACTIVE' });
              const dstResult = await this.evmAdapter.executeTransaction({
                chainId: step.chainId,
                to: step.targetAddress!,
                data: step.calldata!,
                value: step.valueWei || '0',
                approvalTarget: step.approvalTarget,
                tokenInAddress: step.requiredTokenAddress,
                tokenInSymbol: step.requiredTokenSymbol,
                amountInRaw: step.requiredAmountRaw,
                userAddress: params.userAddress,
                signer: params.destSigner,
                provider: params.destProvider,
                onStatusChange: (status, hash) => {
                  if (hash) destinationTxHash = hash;
                  stateMachine.transitionTo(status, { id: step.id, status: 'ACTIVE', txHash: hash });
                }
              });
              destinationTxHash = dstResult.txHash;
              step.txHash = destinationTxHash;
              step.status = 'SUCCESS';
              stepStateMap.set(step.id, step);
              this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS', txHash: destinationTxHash });
              stateMachine.transitionTo('CONFIRMING', { id: step.id, status: 'SUCCESS', txHash: destinationTxHash });
            } catch (dstErr: any) {
              step.status = 'FAILED';
              stepStateMap.set(step.id, step);
              stateMachine.transitionTo('FAILED', { id: step.id, status: 'ERROR', error: dstErr?.message });
              throw new DestinationExecutionFailedError(dstErr?.message || 'Destination swap failed on destination chain', destinationTxHash);
            }
          } else {
            // Mode A / B: Solver / Automated execution engine
            try {
              stateMachine.transitionTo('SIGNING', { id: step.id, status: 'ACTIVE' });
              const destPlan = await this.destinationEngine.prepareExecution({
                intentId: `intent-${Date.now()}`,
                sourceChainId: plan.sourceChainId,
                destinationChainId: plan.destinationChainId,
                recipient: params.userAddress,
                inputToken: plan.tokenIn,
                inputAmountActual: step.requiredAmountRaw || plan.expectedAmountInRaw,
                outputToken: plan.tokenOut,
                minimumOutputAmount: plan.minimumAmountOutRaw,
                deadline: Date.now() + 600000,
                bridgeProvider: 'ACROSS',
                providerOrderId: `order-${Date.now()}`
              });

              const solverResult = await this.destinationEngine.executeDestinationSwap({
                plan: destPlan,
                provider: params.destProvider
              });

              destinationTxHash = solverResult.destinationTxHash;
              step.txHash = destinationTxHash;
              step.status = 'SUCCESS';
              stepStateMap.set(step.id, step);
              this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS', txHash: destinationTxHash });
              stateMachine.transitionTo('CONFIRMING', { id: step.id, status: 'SUCCESS', txHash: destinationTxHash });
            } catch (solverErr: any) {
              step.status = 'FAILED';
              stepStateMap.set(step.id, step);
              stateMachine.transitionTo('FAILED', { id: step.id, status: 'ERROR', error: solverErr?.message });
              if (solverErr instanceof DestinationExecutionUnavailableError) {
                throw solverErr;
              }
              throw new DestinationExecutionFailedError(solverErr?.message || 'Destination execution solver failed', destinationTxHash);
            }
          }
          break;
        }

        case 'DESTINATION_VERIFY': {
          if (isCrossChain && !params.skipDestinationWait && step.executionEnvironment === 'EVM' && destinationTxHash) {
            const destVerification = await this.tracker.verifyDestinationSettlement({
              destinationChainId: step.chainId,
              destinationTxHash: destinationTxHash,
              expectedRecipient: params.userAddress,
              provider: params.destProvider || (step.chainId === plan.sourceChainId ? (params.provider || params.signer?.provider) : undefined)
            });

            if (!destVerification.isVerified) {
              step.status = 'FAILED';
              stepStateMap.set(step.id, step);
              stateMachine.transitionTo('FAILED', { id: step.id, status: 'ERROR', error: destVerification.reason });
              throw new ExecutionUnavailableError(`Destination verification failed: ${destVerification.reason}`);
            }
          }
          step.status = 'SUCCESS';
          stepStateMap.set(step.id, step);
          this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS' });
          stateMachine.transitionTo('COMPLETED', { id: step.id, status: 'SUCCESS', txHash: destinationTxHash || txHash });
          break;
        }

        case 'SETTLEMENT_COMPLETE': {
          step.status = 'SUCCESS';
          stepStateMap.set(step.id, step);
          this.executedStepRegistry.set(idempotencyKey, { status: 'SUCCESS' });
          stateMachine.transitionTo('COMPLETED', { id: step.id, status: 'SUCCESS', txHash: destinationTxHash || txHash });
          break;
        }
      }
    } finally {
      try {
        await repo.updatePlanStep(plan.planId, step.id, {
          status: step.status,
          txHash: step.txHash,
          error: step.error
        });
      } catch {
        // Step status sync best effort
      }
      await repo.releaseLease(stepResourceId, this.workerId);
    }
  }

    const explorerUrl = defaultChainRegistry.getExplorerTxUrl(sourceChain.id, txHash);
    const destExplorerUrl = destinationTxHash
      ? defaultChainRegistry.getExplorerTxUrl(destChain.id, destinationTxHash)
      : undefined;

    let gasPaidUSD = params.quote?.bestRoute?.gasCostUSD || 0.1;
    if (gasUsedWei > 0n && gasPriceWei > 0n && sourceChain.nativeCurrency?.symbol) {
      const nativePrice = sourceChain.id === 'base' || sourceChain.id === 'arbitrum' || sourceChain.id === 'optimism' || sourceChain.id === 'ethereum'
        ? (plan.tokenIn.symbol === 'ETH' ? plan.tokenIn.priceUSD || 2500 : 2500)
        : 1;
      const gasCostEth = Number(gasUsedWei * gasPriceWei) / 1e18;
      gasPaidUSD = Number((gasCostEth * nativePrice).toFixed(4));
    }

    const receipt: ReceiptView = {
      txHash,
      sourceChain,
      destinationChain: destChain,
      destChain,
      tokenIn: plan.tokenIn,
      tokenOut: plan.tokenOut,
      amountInFormatted: params.quote?.amountInFormatted || plan.expectedAmountInRaw,
      amountOutFormatted: params.quote?.amountOutFormatted || plan.expectedAmountOutRaw,
      amountOutUSD: params.quote?.request?.tokenOut?.priceUSD
        ? Number(params.quote.amountOutFormatted.replace(/,/g, '')) * params.quote.request.tokenOut.priceUSD
        : undefined,
      realizedPriceImpactPercent: params.quote?.priceImpact?.percentage || 0.0,
      realizedSlippagePercent: 0.0,
      gasPaidUSD,
      protocolFeePaidUSD: params.quote?.protocolFee?.feeUSD || 0,
      effectiveExecutionScore: params.quote?.effectiveExecutionScore || 99,
      timestamp: Date.now(),
      status: isCrossChain ? (destinationTxHash ? 'COMPLETED' : 'BRIDGE_IN_FLIGHT') : 'COMPLETED',
      explorerUrl,
      routeSummary: isCrossChain
        ? `Cross-chain via ${params.quote?.bestRoute?.crossChainQuote?.providerName || 'Bridge'}`
        : `Swapped on ${sourceChain.canonicalName}`,
      bridgeDetails: isCrossChain
        ? {
            bridgeName: params.quote?.bestRoute?.crossChainQuote?.providerName || 'Across Protocol',
            sourceTxHash: txHash,
            destTxHash: destinationTxHash,
            elapsedSec: params.quote?.bestRoute?.crossChainQuote?.estimatedTransferTimeSec || 30,
            sourceExplorerUrl: explorerUrl,
            destExplorerUrl,
            destinationVerified: Boolean(destinationTxHash)
          }
        : undefined
    };

    stateMachine.setReceipt(receipt);
    return receipt;
  }
}

export const defaultExecutionCoordinator = new ExecutionCoordinator();
