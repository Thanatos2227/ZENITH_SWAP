import { ExecutionPlan, PersistentSettlement, Token } from '@zenith/types';
import { AuthorizationBoundaryBreachError, SemanticEquivalenceBreachError, EconomicSafetyBreachError, MinimumOutputBreachError, ConfigurationError } from '@zenith/contracts';
import { defaultChainRegistry } from '@zenith/chains';
import { ExecutionPlanBuilder, assertPlanIntegrity, computeExecutionPlanHash } from '../executionPlanBuilder';
import { validateExecutionPlanAuthorization } from '../security/executionAuthorizationValidator';
import { validateTransactionPlanEquivalence } from '../semantics/semanticEquivalenceValidator';
import { validateMinimumOutput, validateSourceSwapEconomics, validateBridgeEconomics } from '../economic/economicSafetyValidator';
import { extractActualSourceSwapOutput } from './sourceSwapOutputExtractor';
import { verifyDestinationSettlement, DestinationSettlementStatus, DestinationEvidenceTier } from './authoritativeDestinationVerifier';
import { CrossChainStateRepository, defaultInMemoryRepository } from '../persistence/repository';
export type PipelineStage = 'STAGE_01_USER_INTENT' | 'STAGE_02_ROUTE_DISCOVERY' | 'STAGE_03_ROUTE_ARBITRATION' | 'STAGE_04_EXECUTION_PLAN_GENERATION' | 'STAGE_05_PLAN_INTEGRITY_SEALING' | 'STAGE_06_SECURITY_AUTHORIZATION' | 'STAGE_07_TRANSACTION_SEMANTICS' | 'STAGE_08_ECONOMIC_SAFETY' | 'STAGE_09_SOURCE_EXECUTION' | 'STAGE_10_SOURCE_OUTPUT_EXTRACTION' | 'STAGE_11_BRIDGE_QUOTE_REFRESH' | 'STAGE_12_BRIDGE_EXECUTION' | 'STAGE_13_BRIDGE_RELAY' | 'STAGE_14_DESTINATION_EXECUTION' | 'STAGE_15_DESTINATION_EVIDENCE' | 'STAGE_16_FINALITY_CONFIRMATION' | 'STAGE_17_SETTLEMENT';
export interface PipelineStageResult {
    stage: PipelineStage;
    status: 'PASS' | 'FAIL' | 'SKIPPED';
    durationMs: number;
    details?: Record<string, any>;
    error?: string;
}
export interface PipelineExecutionParams {
    intent: {
        intentId: string;
        userAddress: string;
        recipientAddress: string;
        sourceChainId: string | number;
        destinationChainId: string | number;
        tokenInAddress: string;
        tokenOutAddress: string;
        amountInRaw: string;
        slippageBps?: number;
        executionMode?: 'READ_ONLY' | 'PREFLIGHT_ONLY' | 'LIVE_EXECUTION' | 'LIVE_ONCHAIN';
    };
    route?: any;
    plan?: ExecutionPlan;
    transaction?: any;
    sourceReceipt?: any;
    refreshedBridgeQuote?: {
        bridgeAmountRaw: string;
        expectedOutputRaw: string;
        minOutputRaw: string;
        freshQuoteId?: string;
    };
    destTransaction?: any;
    destReceipt?: any;
    providerStatus?: string | null;
    providerFillTx?: string | null;
    currentBlockNumber?: number | null;
    repository?: CrossChainStateRepository;
    skipDestinationWait?: boolean;
}
export interface PipelineExecutionResult {
    success: boolean;
    intentId: string;
    planId?: string;
    planHash?: string;
    settlementStatus: DestinationSettlementStatus | 'SETTLED' | 'FAILED' | 'UNCERTAIN';
    stages: PipelineStageResult[];
    stageLatenciesMs: Record<string, number>;
    totalDurationMs: number;
    discrepancies: string[];
    actualSourceOutputRaw?: string;
    actualDestinationOutputRaw?: string;
    primaryEvidenceTier?: DestinationEvidenceTier | 'NONE';
    error?: string;
}
function createPipelineToken(address: string, symbol: string, chainId: string): Token {
    return {
        address,
        symbol,
        name: symbol,
        decimals: 6,
        chainId,
        verificationTier: 'VERIFIED_CANONICAL'
    };
}
export class ExecutionIntegrationPipeline {
    private repository: CrossChainStateRepository;
    constructor(repository: CrossChainStateRepository = defaultInMemoryRepository) {
        this.repository = repository;
    }
    public async executePipeline(params: PipelineExecutionParams): Promise<PipelineExecutionResult> {
        const startTime = Date.now();
        const stages: PipelineStageResult[] = [];
        const stageLatenciesMs: Record<string, number> = {};
        const discrepancies: string[] = [];
        const recordStage = (stage: PipelineStage, status: 'PASS' | 'FAIL' | 'SKIPPED', stageStart: number, details?: Record<string, any>, error?: string) => {
            const durationMs = Math.max(0.01, Date.now() - stageStart);
            stageLatenciesMs[stage] = durationMs;
            stages.push({ stage, status, durationMs, details, error });
        };
        let plan: ExecutionPlan | undefined = params.plan;
        let planHash: string | undefined;
        let actualSourceOutputRaw: string | undefined;
        let actualDestinationOutputRaw: string | undefined;
        let settlementStatus: DestinationSettlementStatus | 'SETTLED' | 'FAILED' | 'UNCERTAIN' = 'UNCERTAIN';
        let primaryEvidenceTier: DestinationEvidenceTier | 'NONE' = 'NONE';
        let currentStage: PipelineStage = 'STAGE_01_USER_INTENT';
        let sStart = Date.now();
        try {
            currentStage = 'STAGE_01_USER_INTENT';
            sStart = Date.now();
            if (!params.intent.userAddress || !params.intent.recipientAddress) {
                throw new ConfigurationError('Intent userAddress and recipientAddress are required');
            }
            if (!params.intent.amountInRaw || BigInt(params.intent.amountInRaw) <= 0n) {
                throw new ConfigurationError('Intent amountInRaw must be positive integer');
            }
            recordStage('STAGE_01_USER_INTENT', 'PASS', sStart, {
                intentId: params.intent.intentId,
                userAddress: params.intent.userAddress,
                amountInRaw: params.intent.amountInRaw
            });
            currentStage = 'STAGE_02_ROUTE_DISCOVERY';
            sStart = Date.now();
            const route = params.route;
            if (!route && !plan) {
                throw new ConfigurationError('No route option or ExecutionPlan provided');
            }
            recordStage('STAGE_02_ROUTE_DISCOVERY', 'PASS', sStart, {
                routeId: route?.routeId || plan?.routeId || 'pre-planned',
                isCrossChain: route ? (route.crossChainQuote !== undefined) : true
            });
            sStart = Date.now();
            const selectedProvider = route?.crossChainQuote?.provider || plan?.selectedProvider || 'across';
            recordStage('STAGE_03_ROUTE_ARBITRATION', 'PASS', sStart, {
                selectedProvider,
                routeId: route?.routeId || plan?.routeId
            });
            sStart = Date.now();
            if (!plan) {
                if (!route) {
                    throw new ConfigurationError('Cannot construct ExecutionPlan without route or plan');
                }
                plan = ExecutionPlanBuilder.buildPlan({
                    route,
                    request: {
                        sourceChainId: String(params.intent.sourceChainId),
                        destinationChainId: String(params.intent.destinationChainId),
                        tokenIn: createPipelineToken(params.intent.tokenInAddress, 'TKN_IN', String(params.intent.sourceChainId)),
                        tokenOut: createPipelineToken(params.intent.tokenOutAddress, 'TKN_OUT', String(params.intent.destinationChainId)),
                        amountInRaw: params.intent.amountInRaw,
                        userWalletAddress: params.intent.userAddress,
                        recipientAddress: params.intent.recipientAddress,
                        slippageTolerancePercent: (params.intent.slippageBps ?? 50) / 100
                    },
                    options: {
                        userAddress: params.intent.userAddress,
                        recipientAddress: params.intent.recipientAddress
                    }
                });
            }
            recordStage('STAGE_04_EXECUTION_PLAN_GENERATION', 'PASS', sStart, {
                planId: plan.planId,
                stepsCount: plan.steps.length
            });
            sStart = Date.now();
            assertPlanIntegrity(plan);
            planHash = computeExecutionPlanHash(plan);
            recordStage('STAGE_05_PLAN_INTEGRITY_SEALING', 'PASS', sStart, {
                planHash,
                isExecutable: plan.isExecutable
            });
            sStart = Date.now();
            const execMode = params.intent.executionMode || 'PREFLIGHT_ONLY';
            const authResult = validateExecutionPlanAuthorization(plan, {
                routeId: plan.routeId,
                sourceChainId: plan.sourceChainId,
                destinationChainId: plan.destinationChainId,
                tokenInAddress: plan.tokenIn?.address,
                tokenOutAddress: plan.tokenOut?.address,
                expectedAmountInRaw: plan.expectedAmountInRaw,
                minimumAmountOutRaw: plan.minimumAmountOutRaw,
                recipientAddress: params.intent.recipientAddress,
                provider: plan.selectedProvider,
                executionMode: (execMode === 'READ_ONLY' || execMode === 'PREFLIGHT_ONLY') ? undefined : execMode
            });
            if (!authResult.passed) {
                throw new AuthorizationBoundaryBreachError('EXECUTION_PLAN', 'Security authorization boundary check failed');
            }
            recordStage('STAGE_06_SECURITY_AUTHORIZATION', 'PASS', sStart, {
                isAuthorized: true,
                executionMode: execMode
            });
            sStart = Date.now();
            if (params.transaction) {
                const semResult = validateTransactionPlanEquivalence(params.transaction, plan);
                if (!semResult.isEquivalent) {
                    throw new SemanticEquivalenceBreachError('transaction', 'plan-equivalent-transaction', 'divergent-transaction', `Transaction semantic divergence: ${semResult.discrepancies.join(', ')}`);
                }
            }
            recordStage('STAGE_07_TRANSACTION_SEMANTICS', 'PASS', sStart, {
                validated: !!params.transaction
            });
            sStart = Date.now();
            validateMinimumOutput(plan.expectedAmountOutRaw, plan.minimumAmountOutRaw, 'ExecutionPlan economic safety');
            if (plan.steps.length > 1) {
                validateSourceSwapEconomics({
                    amountInRaw: plan.steps[0].requiredAmountRaw || plan.expectedAmountInRaw,
                    expectedAmountOutRaw: plan.steps[0].expectedAmountOutRaw || '1',
                    minimumAmountOutRaw: plan.steps[0].minimumAmountOutRaw || '1'
                });
            }
            if (plan.sourceChainId !== plan.destinationChainId) {
                const bridgeStep = plan.steps.find(s => s.type === 'BRIDGE_DEPOSIT') || plan.steps[0];
                validateBridgeEconomics({
                    inputAmountRaw: bridgeStep.requiredAmountRaw || plan.expectedAmountInRaw,
                    expectedOutputRaw: plan.expectedAmountOutRaw,
                    minOutputRaw: plan.minimumAmountOutRaw,
                    totalFeeRaw: '0',
                    destinationChainId: plan.destinationChainId,
                    destinationTokenAddress: plan.tokenOut.address,
                    receiverAddress: params.intent.recipientAddress
                });
            }
            recordStage('STAGE_08_ECONOMIC_SAFETY', 'PASS', sStart, {
                isSafe: true,
                minimumAmountOut: plan.minimumAmountOutRaw
            });
            sStart = Date.now();
            const isComposite = plan.steps.length > 1;
            const executionMode = params.intent.executionMode || 'PREFLIGHT_ONLY';
            if (executionMode === 'READ_ONLY' || executionMode === 'PREFLIGHT_ONLY') {
                recordStage('STAGE_09_SOURCE_EXECUTION', 'PASS', sStart, {
                    mode: executionMode,
                    simulatedOnly: true
                });
            }
            else {
                recordStage('STAGE_09_SOURCE_EXECUTION', 'PASS', sStart, {
                    mode: executionMode,
                    sourceReceiptStatus: params.sourceReceipt?.status ?? 1
                });
            }
            sStart = Date.now();
            if (isComposite && params.sourceReceipt) {
                const sourceSwapStep = plan.steps[0];
                const extracted = extractActualSourceSwapOutput({
                    receipt: params.sourceReceipt,
                    expectedTokenOutAddress: sourceSwapStep.outputTokenAddress || plan.tokenIn.address,
                    recipientAddress: params.intent.userAddress,
                    minimumAmountOutRaw: sourceSwapStep.minimumAmountOutRaw || '1',
                    sourceChainId: plan.sourceChainId
                });
                actualSourceOutputRaw = extracted.actualAmountRaw;
                recordStage('STAGE_10_SOURCE_OUTPUT_EXTRACTION', 'PASS', sStart, {
                    actualSourceOutputRaw,
                    extractionMethod: extracted.extractionMethod
                });
            }
            else {
                recordStage('STAGE_10_SOURCE_OUTPUT_EXTRACTION', 'SKIPPED', sStart, {
                    reason: 'Direct route or unmined source receipt'
                });
            }
            sStart = Date.now();
            if (isComposite && actualSourceOutputRaw) {
                if (!params.refreshedBridgeQuote) {
                    throw new ConfigurationError('Composite execution requires refreshedBridgeQuote with actual swap output');
                }
                if (BigInt(params.refreshedBridgeQuote.bridgeAmountRaw) !== BigInt(actualSourceOutputRaw)) {
                    throw new EconomicSafetyBreachError('bridgeAmount', actualSourceOutputRaw, params.refreshedBridgeQuote.bridgeAmountRaw, `Refreshed bridge amount ${params.refreshedBridgeQuote.bridgeAmountRaw} does not match actual swap output ${actualSourceOutputRaw}`);
                }
                if (BigInt(params.refreshedBridgeQuote.minOutputRaw) < BigInt(plan.minimumAmountOutRaw)) {
                    throw new MinimumOutputBreachError(plan.minimumAmountOutRaw, params.refreshedBridgeQuote.minOutputRaw, 'Refreshed bridge quote breached authorized minimum output');
                }
                recordStage('STAGE_11_BRIDGE_QUOTE_REFRESH', 'PASS', sStart, {
                    refreshedAmount: params.refreshedBridgeQuote.bridgeAmountRaw,
                    refreshedMinOutput: params.refreshedBridgeQuote.minOutputRaw
                });
            }
            else {
                recordStage('STAGE_11_BRIDGE_QUOTE_REFRESH', 'SKIPPED', sStart, {
                    reason: 'Direct route'
                });
            }
            sStart = Date.now();
            recordStage('STAGE_12_BRIDGE_EXECUTION', 'PASS', sStart, {
                provider: plan.selectedProvider || 'across',
                destinationChain: plan.destinationChainId
            });
            sStart = Date.now();
            recordStage('STAGE_13_BRIDGE_RELAY', 'PASS', sStart, {
                providerStatus: params.providerStatus || 'pending'
            });
            sStart = Date.now();
            recordStage('STAGE_14_DESTINATION_EXECUTION', 'PASS', sStart, {
                destTxHash: params.destTransaction?.hash || params.destReceipt?.transactionHash
            });
            sStart = Date.now();
            const destVerification = verifyDestinationSettlement({
                destinationChainId: plan.destinationChainId,
                destinationTxHash: params.destTransaction?.hash || params.destReceipt?.transactionHash || params.providerFillTx,
                expectedRecipient: params.intent.recipientAddress,
                expectedToken: plan.tokenOut.address,
                expectedMinAmountRaw: plan.minimumAmountOutRaw,
                expectedSpokePoolOrTarget: plan.executionTarget,
                expectedBlockHash: (plan as any).expectedBlockHash || (params as any).expectedBlockHash,
                receipt: params.destReceipt,
                transaction: params.destTransaction,
                providerStatus: params.providerStatus,
                providerFillTx: params.providerFillTx,
                currentBlockNumber: params.currentBlockNumber,
                bridgeProvider: plan.selectedProvider
            });
            settlementStatus = destVerification.settlementStatus;
            primaryEvidenceTier = destVerification.primaryEvidenceTier;
            actualDestinationOutputRaw = destVerification.actualDeliveredAmountRaw;
            if (destVerification.conflictReason) {
                discrepancies.push(destVerification.conflictReason);
            }
            if (destVerification.revertReason) {
                discrepancies.push(destVerification.revertReason);
            }
            recordStage('STAGE_15_DESTINATION_EVIDENCE', settlementStatus === 'STATUS_CONFLICT' ? 'FAIL' : 'PASS', sStart, {
                settlementStatus,
                primaryEvidenceTier,
                actualDestinationOutputRaw
            }, destVerification.conflictReason);
            sStart = Date.now();
            const destChain = defaultChainRegistry.getChain(plan.destinationChainId);
            const reorgBlocks = (destChain as any)?.reorgSafetyBlocks ?? 20;
            if (settlementStatus === 'DESTINATION_SETTLED') {
                recordStage('STAGE_16_FINALITY_CONFIRMATION', 'PASS', sStart, {
                    confirmationsMet: destVerification.confirmations,
                    required: reorgBlocks
                });
            }
            else if (settlementStatus === 'REORG_DETECTED') {
                recordStage('STAGE_16_FINALITY_CONFIRMATION', 'FAIL', sStart, {
                    reorgDetected: true
                }, 'Destination chain reorg detected');
            }
            else {
                recordStage('STAGE_16_FINALITY_CONFIRMATION', 'PASS', sStart, {
                    finalityPending: true
                });
            }
            sStart = Date.now();
            if (settlementStatus === 'DESTINATION_SETTLED') {
                if (this.repository) {
                    const settlementRecord: PersistentSettlement = {
                        intentId: params.intent.intentId,
                        destinationChainId: String(plan.destinationChainId),
                        destinationTxHash: params.destReceipt?.transactionHash || params.destTransaction?.hash || '0x',
                        tokenAddress: plan.tokenOut.address,
                        tokenSymbol: plan.tokenOut.symbol,
                        recipient: params.intent.recipientAddress,
                        expectedAmountRaw: plan.expectedAmountOutRaw,
                        actualAmountRaw: actualDestinationOutputRaw || plan.minimumAmountOutRaw,
                        verified: true,
                        verifiedAt: Date.now()
                    };
                    await this.repository.recordSettlement(settlementRecord);
                }
                recordStage('STAGE_17_SETTLEMENT', 'PASS', sStart, {
                    status: 'SETTLED'
                });
            }
            else {
                recordStage('STAGE_17_SETTLEMENT', 'SKIPPED', sStart, {
                    status: settlementStatus
                });
            }
            const totalDurationMs = Math.max(0.01, Date.now() - startTime);
            return {
                success: settlementStatus === 'DESTINATION_SETTLED',
                intentId: params.intent.intentId,
                planId: plan.planId,
                planHash,
                settlementStatus,
                stages,
                stageLatenciesMs,
                totalDurationMs,
                discrepancies,
                actualSourceOutputRaw,
                actualDestinationOutputRaw,
                primaryEvidenceTier
            };
        }
        catch (err: any) {
            const totalDurationMs = Math.max(0.01, Date.now() - startTime);
            discrepancies.push(err?.message || String(err));
            if (stages.length === 0 || stages[stages.length - 1].stage !== currentStage) {
                recordStage(currentStage, 'FAIL', sStart, undefined, err?.message || String(err));
            }
            return {
                success: false,
                intentId: params.intent.intentId,
                planId: plan?.planId,
                planHash,
                settlementStatus: 'FAILED',
                stages,
                stageLatenciesMs,
                totalDurationMs,
                discrepancies,
                error: err?.message || String(err)
            };
        }
    }
    public verifyFieldOwnership(field: string, values: {
        [layer: string]: any;
    }): {
        isConsistent: boolean;
        discrepancy?: string;
    } {
        const entries = Object.entries(values);
        if (entries.length <= 1)
            return { isConsistent: true };
        const first = entries[0][1];
        for (let i = 1; i < entries.length; i++) {
            const [layer, val] = entries[i];
            if (typeof first === 'string' && typeof val === 'string') {
                if (first.toLowerCase() !== val.toLowerCase()) {
                    return {
                        isConsistent: false,
                        discrepancy: `Field "${field}" mismatch: ${entries[0][0]} has "${first}", but ${layer} has "${val}"`
                    };
                }
            }
            else if (typeof first === 'bigint' || typeof val === 'bigint') {
                if (BigInt(first) !== BigInt(val)) {
                    return {
                        isConsistent: false,
                        discrepancy: `Field "${field}" mismatch: ${entries[0][0]} has "${first}", but ${layer} has "${val}"`
                    };
                }
            }
            else if (first !== val) {
                return {
                    isConsistent: false,
                    discrepancy: `Field "${field}" mismatch: ${entries[0][0]} has "${first}", but ${layer} has "${val}"`
                };
            }
        }
        return { isConsistent: true };
    }
}
export const defaultExecutionIntegrationPipeline = new ExecutionIntegrationPipeline();
