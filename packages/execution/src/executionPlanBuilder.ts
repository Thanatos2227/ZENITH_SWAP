import { sha256, toUtf8Bytes } from 'ethers';
import {
  ExecutionPlan,
  ExecutionPlanStep,
  ExecutionPlanDiagnostic,
  SwapRoute,
  QuoteRequest,
  ExecutionStepType,
  NormalizedRoute
} from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import { isNativeToken } from '@zenith/routing';
import {
  ZERO_ADDRESS,
  validateTokenAddress,
  validateEvmAddress,
  validateRecipientAddress,
  ExecutionPlanValidationError,
  DuplicateStepIdError,
  PlanMissingDependencyError,
  PlanDependencyCycleError,
  InvalidExecutionTargetError,
  InvalidCalldataError,
  AmountMismatchError,
  TokenMismatchError,
  ChainMismatchError,
  CompositePlanValidationError,
  PlanIntegrityBreachError,
  ExecutionPlanMutationError
} from '@zenith/contracts';

export { PlanIntegrityBreachError, ExecutionPlanMutationError };

export interface PlanBuilderOptions {
  userAddress?: string;
  recipientAddress?: string;
  deadlineSeconds?: number;
}

const VALID_STEP_TYPES: ExecutionStepType[] = [
  'VALIDATION',
  'APPROVAL',
  'SOURCE_APPROVAL',
  'SOURCE_SWAP',
  'BRIDGE_QUOTE_REFRESH',
  'BRIDGE_DEPOSIT',
  'BRIDGE_RELAY_WAIT',
  'DESTINATION_APPROVAL',
  'DESTINATION_SWAP',
  'DESTINATION_VERIFY',
  'SETTLEMENT_COMPLETE'
];

/**
 * Computes a deterministic cryptographic SHA-256 integrity hash of an ExecutionPlan.
 * Spans all 18 authoritative immutable plan fields and the step DAG structure.
 */
export function computeExecutionPlanHash(plan: ExecutionPlan): string {
  const normalized = JSON.stringify({
    planId: plan.planId,
    routeId: plan.routeId,
    routeType: plan.routeType,
    sourceChainId: plan.sourceChainId,
    destinationChainId: plan.destinationChainId,
    sourceToken: (plan.tokenIn?.address || '').toLowerCase(),
    destinationToken: (plan.tokenOut?.address || '').toLowerCase(),
    expectedAmountInRaw: plan.expectedAmountInRaw,
    minimumAmountOutRaw: plan.minimumAmountOutRaw,
    expectedAmountOutRaw: plan.expectedAmountOutRaw,
    selectedProvider: plan.selectedProvider || '',
    selectedDex: plan.selectedDex || '',
    executionTarget: (plan.executionTarget || '').toLowerCase(),
    approvalTarget: (plan.approvalTarget || '').toLowerCase(),
    recipient: ((plan as any).recipient || (plan as any).userWalletAddress || '').toLowerCase(),
    calldata: plan.calldata || '',
    expiration: plan.expiration || 0,
    capabilityEvidence: plan.capabilityEvidence || '',
    totalFeeRaw: plan.totalFeeRaw || '0',
    steps: (plan.steps || []).map((s) => ({
      id: s.id,
      type: s.type,
      chainId: s.chainId,
      targetAddress: (s.targetAddress || '').toLowerCase(),
      approvalTarget: (s.approvalTarget || '').toLowerCase(),
      requiredAmountRaw: s.requiredAmountRaw || '',
      calldata: s.calldata || ''
    }))
  });
  return sha256(toUtf8Bytes(normalized)).toLowerCase().replace(/^0x/, '');
}

/**
 * Attaches cryptographic integrity seal to an ExecutionPlan.
 */
export function sealPlan(plan: ExecutionPlan): ExecutionPlan {
  const hash = computeExecutionPlanHash(plan);
  const p = plan as any;
  p.integrityHash = hash;
  p.planHash = hash;
  return plan;
}

/**
 * Verifies if an ExecutionPlan matches its cryptographic integrity seal.
 */
export function verifyPlanIntegrity(plan: ExecutionPlan, expectedHash?: string): boolean {
  const targetHash = expectedHash || plan.integrityHash || plan.planHash;
  if (!targetHash) return true;
  return computeExecutionPlanHash(plan) === targetHash;
}

/**
 * Asserts that an ExecutionPlan has not been tampered with. Fails closed.
 */
export function assertPlanIntegrity(plan: ExecutionPlan, expectedHash?: string): void {
  const targetHash = expectedHash || plan.integrityHash || plan.planHash;
  if (!targetHash) return;
  const computed = computeExecutionPlanHash(plan);
  if (computed !== targetHash) {
    throw new PlanIntegrityBreachError(
      `ExecutionPlan integrity check failed for "${plan.planId}". Expected sealed hash "${targetHash}", but computed "${computed}". Authoritative plan data has been tampered with.`,
      ['integrityHash']
    );
  }
}

export class ExecutionPlanValidator {
  /**
   * Validates the cryptographic integrity hash of the ExecutionPlan.
   * If the plan is sealed (has integrityHash or planHash), validates that none of the
   * authoritative fields have been mutated.
   */
  public static validatePlanIntegrity(plan: ExecutionPlan): void {
    assertPlanIntegrity(plan);
  }

  /**
   * Validates the entire ExecutionPlan data structure.
   * Rejects malformed or incomplete plans. Fails closed.
   */
  public static validatePlan(plan: ExecutionPlan): void {
    if (!plan || typeof plan !== 'object') {
      throw new ExecutionPlanValidationError('ExecutionPlan must be a valid object');
    }

    // Validate plan integrity seal if sealed
    this.validatePlanIntegrity(plan);

    if (!plan.planId || typeof plan.planId !== 'string' || plan.planId.trim() === '') {
      throw new ExecutionPlanValidationError('ExecutionPlan.planId must be a non-empty string');
    }

    if (!plan.routeId || typeof plan.routeId !== 'string' || plan.routeId.trim() === '') {
      throw new ExecutionPlanValidationError('ExecutionPlan.routeId must be a non-empty string');
    }

    const validRouteTypes = ['DIRECT', 'MULTI_HOP', 'CROSS_CHAIN_DIRECT', 'CROSS_CHAIN_COMPOSITE'];
    if (!validRouteTypes.includes(plan.routeType)) {
      throw new ExecutionPlanValidationError(`Invalid routeType: "${plan.routeType}". Must be one of: ${validRouteTypes.join(', ')}`);
    }

    const sourceChain = defaultChainRegistry.getChain(plan.sourceChainId);
    if (!plan.sourceChainId || !sourceChain) {
      throw new ExecutionPlanValidationError(`Unrecognized or unsupported sourceChainId: "${plan.sourceChainId}"`);
    }

    const destChain = defaultChainRegistry.getChain(plan.destinationChainId);
    if (!plan.destinationChainId || !destChain) {
      throw new ExecutionPlanValidationError(`Unrecognized or unsupported destinationChainId: "${plan.destinationChainId}"`);
    }

    if (!plan.tokenIn || typeof plan.tokenIn !== 'object' || !plan.tokenIn.address || !plan.tokenIn.symbol) {
      throw new ExecutionPlanValidationError('ExecutionPlan.tokenIn must be a valid Token object with address and symbol');
    }

    if (!plan.tokenOut || typeof plan.tokenOut !== 'object' || !plan.tokenOut.address || !plan.tokenOut.symbol) {
      throw new ExecutionPlanValidationError('ExecutionPlan.tokenOut must be a valid Token object with address and symbol');
    }

    validateTokenAddress(plan.tokenIn.address, plan.sourceChainId, plan.tokenIn.isNative);
    validateTokenAddress(plan.tokenOut.address, plan.destinationChainId, plan.tokenOut.isNative);

    try {
      if (!plan.expectedAmountInRaw || BigInt(plan.expectedAmountInRaw) <= 0n) {
        throw new Error();
      }
    } catch {
      throw new ExecutionPlanValidationError(`expectedAmountInRaw must be a valid positive integer string, got: "${plan.expectedAmountInRaw}"`);
    }

    try {
      if (!plan.expectedAmountOutRaw || BigInt(plan.expectedAmountOutRaw) <= 0n) {
        throw new Error();
      }
    } catch {
      throw new ExecutionPlanValidationError(`expectedAmountOutRaw must be a valid positive integer string, got: "${plan.expectedAmountOutRaw}"`);
    }

    try {
      if (!plan.minimumAmountOutRaw || BigInt(plan.minimumAmountOutRaw) < 0n) {
        throw new Error();
      }
    } catch {
      throw new ExecutionPlanValidationError(`minimumAmountOutRaw must be a valid non-negative integer string, got: "${plan.minimumAmountOutRaw}"`);
    }

    if (typeof plan.isExecutable !== 'boolean') {
      throw new ExecutionPlanValidationError('ExecutionPlan.isExecutable must be a boolean');
    }

    if (!plan.isExecutable && (!plan.unexecutableReason || plan.unexecutableReason.trim() === '')) {
      throw new ExecutionPlanValidationError('ExecutionPlan with isExecutable=false must specify a non-empty unexecutableReason');
    }

    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      throw new ExecutionPlanValidationError('ExecutionPlan.steps must be a non-empty array of ExecutionPlanStep objects');
    }

    // Validate individual steps
    for (const step of plan.steps) {
      this.validateStep(step, plan);
    }

    // Validate dependency DAG
    this.validateDependencyGraph(plan);

    // Validate composite constraints if applicable
    if (
      plan.routeType === 'CROSS_CHAIN_COMPOSITE' ||
      (plan.steps.some((s) => s.type === 'SOURCE_SWAP') && plan.steps.some((s) => s.type === 'BRIDGE_DEPOSIT'))
    ) {
      this.validateCompositePlan(plan);
    }
  }

  public static validateStep(step: ExecutionPlanStep, plan?: ExecutionPlan): void {
    if (!step.id || typeof step.id !== 'string' || step.id.trim() === '') {
      throw new ExecutionPlanValidationError('ExecutionPlanStep.id must be a non-empty string');
    }

    if (!VALID_STEP_TYPES.includes(step.type)) {
      throw new ExecutionPlanValidationError(`Invalid step type: "${step.type}". Must be one of: ${VALID_STEP_TYPES.join(', ')}`);
    }

    const stepChain = defaultChainRegistry.getChain(step.chainId);
    if (!step.chainId || !stepChain) {
      throw new ExecutionPlanValidationError(`Unrecognized step chainId: "${step.chainId}" on step "${step.id}"`);
    }

    const validEnvs = ['EVM', 'SOLANA', 'OFF_CHAIN'];
    if (!validEnvs.includes(step.executionEnvironment)) {
      throw new ExecutionPlanValidationError(`Invalid step executionEnvironment: "${step.executionEnvironment}" on step "${step.id}"`);
    }

    if (step.executionEnvironment !== 'OFF_CHAIN') {
      const expectedEnv = stepChain.executionEnvironment === 'SOLANA' ? 'SOLANA' : 'EVM';
      if (step.executionEnvironment !== expectedEnv) {
        throw new ExecutionPlanValidationError(
          `Conflicting execution environment on step "${step.id}": step declares "${step.executionEnvironment}" but chain "${step.chainId}" is "${expectedEnv}"`
        );
      }
    }

    if (plan) {
      if ((step.type === 'SOURCE_SWAP' || step.type === 'APPROVAL' || step.type === 'SOURCE_APPROVAL' || step.type === 'BRIDGE_DEPOSIT' || step.type === 'BRIDGE_QUOTE_REFRESH') && step.chainId !== plan.sourceChainId) {
        throw new ExecutionPlanValidationError(`Step "${step.id}" of type "${step.type}" declares chainId "${step.chainId}", but plan sourceChainId is "${plan.sourceChainId}"`);
      }
      if ((step.type === 'DESTINATION_SWAP' || step.type === 'DESTINATION_APPROVAL' || step.type === 'DESTINATION_VERIFY') && step.chainId !== plan.destinationChainId) {
        throw new ExecutionPlanValidationError(`Step "${step.id}" of type "${step.type}" declares chainId "${step.chainId}", but plan destinationChainId is "${plan.destinationChainId}"`);
      }
    }

    if (!Array.isArray(step.dependencies)) {
      throw new ExecutionPlanValidationError(`step.dependencies must be an array on step "${step.id}"`);
    }

    if (!step.retryPolicy || typeof step.retryPolicy.maxRetries !== 'number' || step.retryPolicy.maxRetries < 0) {
      throw new ExecutionPlanValidationError(`Invalid retryPolicy on step "${step.id}"`);
    }

    // Executable EVM steps validation
    if (
      (!plan || plan.isExecutable) &&
      (step.type === 'SOURCE_SWAP' || step.type === 'BRIDGE_DEPOSIT' || step.type === 'DESTINATION_SWAP') &&
      step.executionEnvironment === 'EVM'
    ) {
      if (!step.targetAddress || step.targetAddress === ZERO_ADDRESS) {
        throw new InvalidExecutionTargetError(step.targetAddress || 'EMPTY', step.chainId, `Target address missing or zero on step "${step.id}"`);
      }
      validateEvmAddress(step.targetAddress, `Step ${step.id} Target Address`);

      if (!step.calldata || step.calldata === '0x' || !step.calldata.startsWith('0x') || step.calldata.length < 4) {
        throw new InvalidCalldataError(`Invalid calldata on executable step "${step.id}": "${step.calldata}"`);
      }

      if (step.valueWei !== undefined) {
        try {
          if (BigInt(step.valueWei) < 0n) throw new Error();
        } catch {
          throw new ExecutionPlanValidationError(`Invalid valueWei on step "${step.id}": "${step.valueWei}"`);
        }
      }
    }

    // Approval steps validation
    if (step.type === 'APPROVAL' || step.type === 'SOURCE_APPROVAL' || step.type === 'DESTINATION_APPROVAL') {
      if (!step.requiredTokenAddress || step.requiredTokenAddress === ZERO_ADDRESS) {
        throw new ExecutionPlanValidationError(`requiredTokenAddress is required on approval step "${step.id}"`);
      }
      validateTokenAddress(step.requiredTokenAddress, step.chainId);

      if (!step.approvalTarget || step.approvalTarget === ZERO_ADDRESS) {
        throw new InvalidExecutionTargetError(step.approvalTarget || 'EMPTY', step.chainId, `approvalTarget missing or zero on step "${step.id}"`);
      }
      validateEvmAddress(step.approvalTarget, `Step ${step.id} Approval Target`);

      try {
        if (!step.requiredAmountRaw || BigInt(step.requiredAmountRaw) <= 0n) {
          throw new Error();
        }
      } catch {
        throw new ExecutionPlanValidationError(`requiredAmountRaw must be positive integer on step "${step.id}"`);
      }
    }
  }

  /**
   * Validates composite cross-chain route constraints:
   * 1. Chain continuity: source swap and bridge deposit execute on same source chain.
   * 2. Token continuity: source swap outputToken matches bridge deposit requiredToken.
   * 3. Amount continuity: initial expected output equals bridge required amount.
   * 4. Topological order: SOURCE_SWAP must execute before BRIDGE_DEPOSIT.
   * 5. Slippage separation: source swap minAmountOut <= expectedAmountOut.
   */
  public static validateCompositePlan(plan: ExecutionPlan): void {
    const srcSwapStep = plan.steps.find((s) => s.type === 'SOURCE_SWAP');
    const bridgeDepositStep = plan.steps.find((s) => s.type === 'BRIDGE_DEPOSIT');

    if (srcSwapStep && bridgeDepositStep) {
      // 1. Chain continuity
      if (srcSwapStep.chainId !== bridgeDepositStep.chainId) {
        throw new ChainMismatchError(
          srcSwapStep.chainId,
          bridgeDepositStep.chainId,
          `Source swap chain (${srcSwapStep.chainId}) does not match bridge deposit chain (${bridgeDepositStep.chainId})`
        );
      }
      if (srcSwapStep.chainId !== plan.sourceChainId) {
        throw new ChainMismatchError(
          plan.sourceChainId,
          srcSwapStep.chainId,
          `Source swap chain (${srcSwapStep.chainId}) does not match plan sourceChainId (${plan.sourceChainId})`
        );
      }

      // 2. Token continuity
      if (srcSwapStep.outputTokenAddress && bridgeDepositStep.requiredTokenAddress) {
        if (srcSwapStep.outputTokenAddress.toLowerCase() !== bridgeDepositStep.requiredTokenAddress.toLowerCase()) {
          throw new TokenMismatchError(
            srcSwapStep.outputTokenAddress,
            bridgeDepositStep.requiredTokenAddress,
            `Source swap output token (${srcSwapStep.outputTokenAddress}) does not match bridge deposit required token (${bridgeDepositStep.requiredTokenAddress})`
          );
        }
      }

      // 3. Amount continuity (pre-execution estimates)
      if (srcSwapStep.expectedAmountOutRaw && bridgeDepositStep.requiredAmountRaw) {
        if (srcSwapStep.expectedAmountOutRaw !== bridgeDepositStep.requiredAmountRaw) {
          throw new AmountMismatchError(
            srcSwapStep.expectedAmountOutRaw,
            bridgeDepositStep.requiredAmountRaw,
            `Source swap estimated output amount (${srcSwapStep.expectedAmountOutRaw}) does not match bridge deposit required amount (${bridgeDepositStep.requiredAmountRaw})`
          );
        }
      }

      // 4. Slippage validation
      if (srcSwapStep.minimumAmountOutRaw && srcSwapStep.expectedAmountOutRaw) {
        if (BigInt(srcSwapStep.minimumAmountOutRaw) > BigInt(srcSwapStep.expectedAmountOutRaw)) {
          throw new CompositePlanValidationError(
            `Source swap minimumAmountOutRaw (${srcSwapStep.minimumAmountOutRaw}) cannot exceed expectedAmountOutRaw (${srcSwapStep.expectedAmountOutRaw})`
          );
        }
      }

      // 5. Dependency order: BRIDGE_DEPOSIT must depend on SOURCE_SWAP or BRIDGE_QUOTE_REFRESH which depends on SOURCE_SWAP
      const topologicalSteps = this.getTopologicalOrder(plan);
      const srcSwapIndex = topologicalSteps.findIndex((s) => s.id === srcSwapStep.id);
      const bridgeDepositIndex = topologicalSteps.findIndex((s) => s.id === bridgeDepositStep.id);

      if (srcSwapIndex >= bridgeDepositIndex) {
        throw new CompositePlanValidationError(
          `SOURCE_SWAP step ("${srcSwapStep.id}") must be executed before BRIDGE_DEPOSIT step ("${bridgeDepositStep.id}") in dependency topology`
        );
      }
    }
  }

  /**
   * Validates the execution dependency graph:
   * 1. No duplicate step IDs
   * 2. No missing or unknown dependencies
   * 3. No circular dependencies (DAG property)
   * 4. No self-dependencies
   */
  public static validateDependencyGraph(plan: ExecutionPlan): void {
    const seenIds = new Set<string>();

    // 1. Duplicate step ID check
    for (const step of plan.steps) {
      if (seenIds.has(step.id)) {
        throw new DuplicateStepIdError(step.id);
      }
      seenIds.add(step.id);
    }

    // 2. Unknown dependency check & self-dependency check
    for (const step of plan.steps) {
      for (const depId of step.dependencies) {
        if (depId === step.id) {
          throw new PlanDependencyCycleError([step.id, step.id]);
        }
        if (!seenIds.has(depId)) {
          throw new PlanMissingDependencyError(step.id, depId);
        }
      }
    }

    // 3. Circular dependency detection (Cycle Detection via DFS / Topological Sort)
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const adjMap = new Map<string, string[]>();

    for (const step of plan.steps) {
      adjMap.set(step.id, [...step.dependencies]);
    }

    const checkCycle = (nodeId: string, path: string[]): void => {
      visiting.add(nodeId);
      path.push(nodeId);

      const deps = adjMap.get(nodeId) || [];
      for (const dep of deps) {
        if (visiting.has(dep)) {
          const cyclePath = [...path.slice(path.indexOf(dep)), dep];
          throw new PlanDependencyCycleError(cyclePath);
        }
        if (!visited.has(dep)) {
          checkCycle(dep, path);
        }
      }

      path.pop();
      visiting.delete(nodeId);
      visited.add(nodeId);
    };

    for (const step of plan.steps) {
      if (!visited.has(step.id)) {
        checkCycle(step.id, []);
      }
    }
  }

  /**
   * Returns steps sorted in valid dependency resolution order.
   */
  public static getTopologicalOrder(plan: ExecutionPlan): ExecutionPlanStep[] {
    this.validateDependencyGraph(plan);

    const stepMap = new Map<string, ExecutionPlanStep>();
    plan.steps.forEach((s) => stepMap.set(s.id, s));

    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>(); // dependency -> dependents

    plan.steps.forEach((s) => {
      inDegree.set(s.id, s.dependencies.length);
      graph.set(s.id, []);
    });

    plan.steps.forEach((s) => {
      s.dependencies.forEach((depId) => {
        graph.get(depId)?.push(s.id);
      });
    });

    const queue: string[] = [];
    inDegree.forEach((deg, id) => {
      if (deg === 0) queue.push(id);
    });

    const ordered: ExecutionPlanStep[] = [];
    while (queue.length > 0) {
      const currId = queue.shift()!;
      ordered.push(stepMap.get(currId)!);

      const dependents = graph.get(currId) || [];
      for (const dep of dependents) {
        const newDeg = (inDegree.get(dep) || 1) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) {
          queue.push(dep);
        }
      }
    }

    return ordered;
  }
}

let planSequenceNumber = 1;

export class ExecutionPlanBuilder {
  /**
   * Builds a deterministic ExecutionPlan from a SwapRoute and QuoteRequest.
   * Does NOT execute transactions; its sole responsibility is validation and deterministic plan construction.
   */
  public static buildPlan(params: {
    route: SwapRoute;
    request: QuoteRequest;
    options?: PlanBuilderOptions;
  }): ExecutionPlan {
    const { route, request, options } = params;
    validateTokenAddress(request.tokenIn.address, request.sourceChainId, request.tokenIn.isNative);
    validateTokenAddress(request.tokenOut.address, request.destinationChainId, request.tokenOut.isNative);
    if (options?.userAddress) {
      validateEvmAddress(options.userAddress, 'User Address');
    }
    if (options?.recipientAddress) {
      validateRecipientAddress(options.recipientAddress, request.destinationChainId);
    } else if (request.recipientAddress) {
      validateRecipientAddress(request.recipientAddress, request.destinationChainId);
    }
    const sourceChain = defaultChainRegistry.getChain(request.sourceChainId);
    const destChain = defaultChainRegistry.getChain(request.destinationChainId);

    const isCrossChain = request.sourceChainId !== request.destinationChainId;
    const ccQuote = route.crossChainQuote;

    const diagnostics: ExecutionPlanDiagnostic[] = [
      ...(route.diagnostics || []),
      ...(route.crossChainQuote?.diagnostics || [])
    ];

    const steps: ExecutionPlanStep[] = [];
    const stepIds: string[] = [];
    let isPlanExecutable = true;
    let unexecutableReason: string | undefined = undefined;
    let compositeMode: 'ATOMIC' | 'SOLVER' | 'SEPARATE_DESTINATION_TX' | 'UNSUPPORTED' = 'ATOMIC';

    const routeType = isCrossChain
      ? (ccQuote?.destDexQuote || ccQuote?.sourceDexQuote ? 'CROSS_CHAIN_COMPOSITE' : 'CROSS_CHAIN_DIRECT')
      : (route.routeType === 'MULTI_HOP' ? 'MULTI_HOP' : 'DIRECT');

    // 1. Step: VALIDATION
    const validationStepId = 'validation';
    stepIds.push(validationStepId);
    steps.push({
      id: validationStepId,
      type: 'VALIDATION',
      title: 'Pre-Execution Validation',
      description: `Validate wallet balance, token security policies, and recipient on ${sourceChain?.shortName || request.sourceChainId}`,
      chainId: request.sourceChainId,
      numericChainId: sourceChain?.chainId,
      executionEnvironment: sourceChain?.executionEnvironment === 'SOLANA' ? 'SOLANA' : 'EVM',
      status: 'NOT_STARTED',
      dependencies: [],
      retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 10000 },
      verificationCondition: { type: 'API_STATUS', expectedValue: 'VALID' }
    });

    let prevStepId = validationStepId;

    // 2. Step: APPROVAL (if source token is non-native on EVM)
    const isSourceNative = isNativeToken(request.tokenIn.address) || Boolean(request.tokenIn.isNative);
    const sourceEnv = sourceChain?.executionEnvironment || 'EVM';

    if (!isSourceNative && sourceEnv === 'EVM') {
      const approvalStepId = `approval:source:${request.tokenIn.symbol.toUpperCase()}`;
      stepIds.push(approvalStepId);

      const approvalTarget = route.execution?.approvalTarget ||
        route.dexQuote?.approvalTarget ||
        route.crossChainQuote?.approvalTarget;

      steps.push({
        id: approvalStepId,
        type: 'APPROVAL',
        title: `Authorize ${request.tokenIn.symbol}`,
        description: `Approve router/bridge (${approvalTarget || 'contract'}) to spend ${request.tokenIn.symbol}`,
        chainId: request.sourceChainId,
        numericChainId: sourceChain?.chainId,
        executionEnvironment: 'EVM',
        targetAddress: request.tokenIn.address,
        approvalTarget: approvalTarget,
        requiredTokenAddress: request.tokenIn.address,
        requiredTokenSymbol: request.tokenIn.symbol,
        requiredAmountRaw: request.amountInRaw,
        status: 'NOT_STARTED',
        dependencies: [prevStepId],
        retryPolicy: { maxRetries: 2, backoffMs: 2000, timeoutMs: 60000 },
        verificationCondition: { type: 'ON_CHAIN_RECEIPT' }
      });

      prevStepId = approvalStepId;
    }

    if (!isCrossChain) {
      // SAME-CHAIN SWAP
      const dexProtocol = route.dexQuote?.provider || route.hops[0]?.dexProtocol || 'ZENITH_V3';
      const swapStepId = `source-swap:${dexProtocol.toLowerCase()}`;
      stepIds.push(swapStepId);

      const executionTo = route.execution?.to || route.dexQuote?.executionTarget;
      const executionData = route.execution?.data || route.dexQuote?.calldata;

      if (!executionTo || executionTo === ZERO_ADDRESS) {
        isPlanExecutable = false;
        unexecutableReason = 'INVALID_EXECUTION_TARGET: DEX router target contract address is missing or zero.';
        diagnostics.push({
          code: 'INVALID_EXECUTION_TARGET',
          message: 'DEX router target contract address is invalid.',
          severity: 'ERROR',
          providerId: dexProtocol,
          timestamp: Date.now()
        });
      }

      steps.push({
        id: swapStepId,
        type: 'SOURCE_SWAP',
        title: `Execute Swap on ${dexProtocol}`,
        description: `Swap ${request.tokenIn.symbol} -> ${request.tokenOut.symbol} on ${sourceChain?.shortName || request.sourceChainId}`,
        chainId: request.sourceChainId,
        numericChainId: sourceChain?.chainId,
        executionEnvironment: sourceEnv === 'SOLANA' ? 'SOLANA' : 'EVM',
        targetAddress: executionTo,
        calldata: executionData,
        valueWei: route.execution?.value || (isSourceNative ? request.amountInRaw : '0'),
        requiredTokenAddress: request.tokenIn.address,
        requiredTokenSymbol: request.tokenIn.symbol,
        requiredAmountRaw: request.amountInRaw,
        outputTokenAddress: request.tokenOut.address,
        outputTokenSymbol: request.tokenOut.symbol,
        expectedAmountOutRaw: route.dexQuote?.amountOut?.toString(),
        minimumAmountOutRaw: route.dexQuote?.minimumAmountOut?.toString() || route.dexQuote?.amountOut?.toString(),
        status: 'NOT_STARTED',
        dependencies: [prevStepId],
        retryPolicy: { maxRetries: 1, backoffMs: 3000, timeoutMs: 120000 },
        verificationCondition: { type: 'ON_CHAIN_RECEIPT' }
      });
      prevStepId = swapStepId;

      // Verification Step
      const verifyStepId = `destination-verification:${request.sourceChainId}`;
      stepIds.push(verifyStepId);
      steps.push({
        id: verifyStepId,
        type: 'DESTINATION_VERIFY',
        title: 'Verify Settlement',
        description: `Confirm token balance delta for ${request.tokenOut.symbol} on ${sourceChain?.shortName || request.sourceChainId}`,
        chainId: request.sourceChainId,
        numericChainId: sourceChain?.chainId,
        executionEnvironment: sourceEnv === 'SOLANA' ? 'SOLANA' : 'EVM',
        status: 'NOT_STARTED',
        dependencies: [prevStepId],
        retryPolicy: { maxRetries: 5, backoffMs: 2000, timeoutMs: 30000 },
        verificationCondition: { type: 'BALANCE_DELTA' }
      });
    } else {
      // CROSS-CHAIN EXECUTION
      const bridgeProtocol = ccQuote?.provider || 'BRIDGE';

      compositeMode = 'ATOMIC';

      // Check if source swap is required (Composite Route)
      if (ccQuote?.sourceDexQuote) {
        compositeMode = 'SEPARATE_DESTINATION_TX';
        const srcDex = ccQuote.sourceDexQuote.provider;
        const srcSwapStepId = `source-swap:${srcDex.toLowerCase()}`;
        stepIds.push(srcSwapStepId);

        const srcCalldata = ccQuote.sourceDexQuote.calldata;
        const srcTarget = ccQuote.sourceDexQuote.executionTarget;

        if (!srcCalldata || srcCalldata === '0x' || !srcTarget || srcTarget === ZERO_ADDRESS) {
          isPlanExecutable = false;
          unexecutableReason = 'SOURCE_SWAP_UNAVAILABLE';
          diagnostics.push({
            code: 'SOURCE_SWAP_UNAVAILABLE',
            message: `Source DEX swap (${request.tokenIn.symbol} -> ${ccQuote.sourceConnectorToken?.symbol || 'Connector'}) has no executable calldata or target on ${sourceChain?.shortName}.`,
            severity: 'ERROR',
            providerId: srcDex,
            timestamp: Date.now()
          });
        }

        const connectorAddress = ccQuote.sourceConnectorToken?.address || ccQuote.sourceDexQuote.tokenOut?.address;
        const connectorSymbol = ccQuote.sourceConnectorToken?.symbol || ccQuote.sourceDexQuote.tokenOut?.symbol;
        const srcAmountOut = ccQuote.sourceDexQuote.amountOut?.toString();
        const srcMinAmountOut = ccQuote.sourceDexQuote.minimumAmountOut?.toString() || srcAmountOut;

        steps.push({
          id: srcSwapStepId,
          type: 'SOURCE_SWAP',
          title: `Source Swap (${srcDex})`,
          description: `Swap ${request.tokenIn.symbol} -> ${connectorSymbol || 'Connector'} on ${sourceChain?.shortName}`,
          chainId: request.sourceChainId,
          numericChainId: sourceChain?.chainId,
          executionEnvironment: sourceEnv === 'SOLANA' ? 'SOLANA' : 'EVM',
          targetAddress: srcTarget,
          calldata: srcCalldata,
          requiredTokenAddress: request.tokenIn.address,
          requiredTokenSymbol: request.tokenIn.symbol,
          requiredAmountRaw: request.amountInRaw,
          outputTokenAddress: connectorAddress,
          outputTokenSymbol: connectorSymbol,
          expectedAmountOutRaw: srcAmountOut,
          minimumAmountOutRaw: srcMinAmountOut,
          status: 'NOT_STARTED',
          dependencies: [prevStepId],
          retryPolicy: { maxRetries: 1, backoffMs: 2000, timeoutMs: 60000 },
          verificationCondition: { type: 'ON_CHAIN_RECEIPT' }
        });
        prevStepId = srcSwapStepId;

        // Bridge Quote Refresh Step (autoritative DAG step)
        const refreshStepId = `bridge-quote-refresh:${bridgeProtocol.toLowerCase()}`;
        stepIds.push(refreshStepId);
        steps.push({
          id: refreshStepId,
          type: 'BRIDGE_QUOTE_REFRESH',
          title: `Refresh Bridge Quote (${ccQuote?.providerName || bridgeProtocol})`,
          description: `Query fresh bridge quote using actual source swap output for ${connectorSymbol || 'Connector'}`,
          chainId: request.sourceChainId,
          numericChainId: sourceChain?.chainId,
          executionEnvironment: 'OFF_CHAIN',
          requiredTokenAddress: connectorAddress,
          requiredTokenSymbol: connectorSymbol,
          requiredAmountRaw: srcAmountOut,
          status: 'NOT_STARTED',
          dependencies: [prevStepId],
          retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 15000 },
          verificationCondition: { type: 'API_STATUS', expectedValue: 'REFRESHED' }
        });
        prevStepId = refreshStepId;
      }

      // Bridge Submission Step
      const bridgeStepId = `bridge:${bridgeProtocol.toLowerCase()}`;
      stepIds.push(bridgeStepId);

      const bridgeTo = route.execution?.to || ccQuote?.executionTarget;
      const bridgeData = route.execution?.data || ccQuote?.calldata;

      if (!bridgeTo || bridgeTo === ZERO_ADDRESS) {
        isPlanExecutable = false;
        unexecutableReason = 'INVALID_EXECUTION_TARGET: Bridge contract target address is missing or zero.';
      }

      if (!bridgeData || bridgeData === '0x') {
        isPlanExecutable = false;
        unexecutableReason = ccQuote?.unexecutableReason || 'EXECUTION_UNAVAILABLE: Bridge calldata is missing or unverified.';
      }

      steps.push({
        id: bridgeStepId,
        type: 'BRIDGE_DEPOSIT',
        title: `Submit to ${ccQuote?.providerName || bridgeProtocol}`,
        description: `Deposit tokens into ${bridgeProtocol} on ${sourceChain?.shortName || request.sourceChainId}`,
        chainId: request.sourceChainId,
        numericChainId: sourceChain?.chainId,
        executionEnvironment: sourceEnv === 'SOLANA' ? 'SOLANA' : 'EVM',
        targetAddress: bridgeTo,
        calldata: bridgeData,
        valueWei: route.execution?.value || (isSourceNative && !ccQuote?.sourceDexQuote ? request.amountInRaw : '0'),
        approvalTarget: route.execution?.approvalTarget || ccQuote?.approvalTarget,
        requiredTokenAddress: ccQuote?.sourceConnectorToken?.address || request.tokenIn.address,
        requiredTokenSymbol: ccQuote?.sourceConnectorToken?.symbol || request.tokenIn.symbol,
        requiredAmountRaw: ccQuote?.sourceDexQuote?.amountOut?.toString() || request.amountInRaw,
        status: 'NOT_STARTED',
        dependencies: [prevStepId],
        retryPolicy: { maxRetries: 1, backoffMs: 3000, timeoutMs: 120000 },
        verificationCondition: { type: 'ON_CHAIN_RECEIPT' }
      });
      prevStepId = bridgeStepId;

      // Bridge Relay Wait Step
      const relayWaitStepId = `bridge-relay-wait:${bridgeProtocol.toLowerCase()}`;
      stepIds.push(relayWaitStepId);
      steps.push({
        id: relayWaitStepId,
        type: 'BRIDGE_RELAY_WAIT',
        title: `Relay Fulfillment (${bridgeProtocol})`,
        description: `Wait for relayer to deliver assets to ${destChain?.shortName || request.destinationChainId}`,
        chainId: request.destinationChainId,
        numericChainId: destChain?.chainId,
        executionEnvironment: 'OFF_CHAIN',
        status: 'NOT_STARTED',
        dependencies: [prevStepId],
        retryPolicy: { maxRetries: 120, backoffMs: 2500, timeoutMs: 1800000 },
        verificationCondition: { type: 'API_STATUS', expectedValue: 'DESTINATION_FILLED' }
      });
      prevStepId = relayWaitStepId;

      // If destination DEX swap is part of composite route
      if (ccQuote?.destDexQuote) {
        const dstDex = ccQuote.destDexQuote.provider;
        const dstSwapStepId = `destination-swap:${dstDex.toLowerCase()}`;

        if (
          ccQuote.compositeExecutionMode === 'SEPARATE_DESTINATION_TX' &&
          ccQuote.destDexQuote.calldata &&
          ccQuote.destDexQuote.calldata !== '0x'
        ) {
          compositeMode = 'SEPARATE_DESTINATION_TX';
          stepIds.push(dstSwapStepId);
          steps.push({
            id: dstSwapStepId,
            type: 'DESTINATION_SWAP',
            title: `Destination Swap (${dstDex})`,
            description: `Swap ${ccQuote.destConnectorToken?.symbol || 'Connector'} -> ${request.tokenOut.symbol} on ${destChain?.shortName}`,
            chainId: request.destinationChainId,
            numericChainId: destChain?.chainId,
            executionEnvironment: destChain?.executionEnvironment === 'SOLANA' ? 'SOLANA' : 'EVM',
            targetAddress: ccQuote.destDexQuote.executionTarget,
            calldata: ccQuote.destDexQuote.calldata,
            requiredTokenAddress: ccQuote.destConnectorToken?.address || request.tokenOut.address,
            requiredTokenSymbol: ccQuote.destConnectorToken?.symbol || request.tokenOut.symbol,
            requiredAmountRaw: ccQuote.destDexQuote.amountIn?.toString(),
            status: 'NOT_STARTED',
            dependencies: [prevStepId],
            retryPolicy: { maxRetries: 1, backoffMs: 3000, timeoutMs: 120000 },
            verificationCondition: { type: 'ON_CHAIN_RECEIPT' }
          });
          prevStepId = dstSwapStepId;
        } else if (
          (ccQuote.compositeExecutionMode === 'SOLVER' || ccQuote.compositeExecutionMode === 'ATOMIC' || !ccQuote.compositeExecutionMode) &&
          ccQuote.destDexQuote.calldata &&
          ccQuote.destDexQuote.calldata !== '0x'
        ) {
          compositeMode = ccQuote.compositeExecutionMode === 'ATOMIC' ? 'ATOMIC' : 'SOLVER';
          stepIds.push(dstSwapStepId);
          steps.push({
            id: dstSwapStepId,
            type: 'DESTINATION_SWAP',
            title: `Destination Swap (${dstDex})`,
            description: `Automated Solver Swap ${ccQuote.destConnectorToken?.symbol || 'Connector'} -> ${request.tokenOut.symbol} on ${destChain?.shortName}`,
            chainId: request.destinationChainId,
            numericChainId: destChain?.chainId,
            executionEnvironment: destChain?.executionEnvironment === 'SOLANA' ? 'SOLANA' : 'EVM',
            targetAddress: ccQuote.destDexQuote.executionTarget,
            calldata: ccQuote.destDexQuote.calldata,
            requiredTokenAddress: ccQuote.destConnectorToken?.address || request.tokenOut.address,
            requiredTokenSymbol: ccQuote.destConnectorToken?.symbol || request.tokenOut.symbol,
            requiredAmountRaw: ccQuote.destDexQuote.amountIn?.toString(),
            status: 'NOT_STARTED',
            dependencies: [prevStepId],
            retryPolicy: { maxRetries: 1, backoffMs: 3000, timeoutMs: 120000 },
            verificationCondition: { type: 'ON_CHAIN_RECEIPT' }
          });
          prevStepId = dstSwapStepId;
        } else {
          compositeMode = 'UNSUPPORTED';
          isPlanExecutable = false;
          unexecutableReason = 'DESTINATION_EXECUTION_UNAVAILABLE';
          diagnostics.push({
            code: 'DESTINATION_EXECUTION_UNAVAILABLE',
            message: `Destination DEX swap (${ccQuote.destConnectorToken?.symbol || 'USDC'} -> ${request.tokenOut.symbol}) has no verified automated solver/execution payload on ${destChain?.shortName}.`,
            severity: 'ERROR',
            providerId: dstDex,
            timestamp: Date.now()
          });
        }
      }

      // Destination Verification Step
      const destVerifyStepId = `destination-verification:${request.destinationChainId}`;
      stepIds.push(destVerifyStepId);
      steps.push({
        id: destVerifyStepId,
        type: 'DESTINATION_VERIFY',
        title: 'Verify Destination Receipt',
        description: `Verify destination transaction confirmation on ${destChain?.shortName || request.destinationChainId}`,
        chainId: request.destinationChainId,
        numericChainId: destChain?.chainId,
        executionEnvironment: destChain?.executionEnvironment === 'SOLANA' ? 'SOLANA' : 'EVM',
        status: 'NOT_STARTED',
        dependencies: [prevStepId],
        retryPolicy: { maxRetries: 10, backoffMs: 3000, timeoutMs: 60000 },
        verificationCondition: { type: 'ON_CHAIN_RECEIPT' }
      });
      prevStepId = destVerifyStepId;

      // Settlement Completion Step
      const settlementStepId = 'settlement';
      stepIds.push(settlementStepId);
      steps.push({
        id: settlementStepId,
        type: 'SETTLEMENT_COMPLETE',
        title: 'Settlement Finalized',
        description: 'Complete cross-chain settlement and persist trade record',
        chainId: request.destinationChainId,
        numericChainId: destChain?.chainId,
        executionEnvironment: 'OFF_CHAIN',
        status: 'NOT_STARTED',
        dependencies: [prevStepId],
        retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 5000 },
        verificationCondition: { type: 'API_STATUS', expectedValue: 'SETTLED' }
      });

      if (ccQuote?.compositeExecutionMode) {
        compositeMode = ccQuote.compositeExecutionMode;
      }
    }

    if (route.isExecutable === false) {
      isPlanExecutable = false;
      if (!unexecutableReason) {
        unexecutableReason = route.unexecutableReason || 'ROUTE_NOT_EXECUTABLE';
      }
    }

    const planSequence = planSequenceNumber++;
    const plan: ExecutionPlan = {
      planId: `plan-${request.sourceChainId}-${request.destinationChainId}-${Date.now()}-${planSequence}`,
      routeId: route.id || (route as any).routeIdentifier || (route as any).routeId || `route-${routeType.toLowerCase()}-${request.sourceChainId}-${request.destinationChainId}`,
      routeType,
      sourceChainId: request.sourceChainId,
      destinationChainId: request.destinationChainId,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      expectedAmountInRaw: request.amountInRaw,
      expectedAmountOutRaw: route.dexQuote?.amountOut?.toString() || route.crossChainQuote?.destinationAmountRaw || '0',
      minimumAmountOutRaw: route.dexQuote?.minimumAmountOut?.toString() || route.crossChainQuote?.minDestinationAmountRaw || '0',
      isExecutable: isPlanExecutable,
      unexecutableReason,
      compositeExecutionMode: isCrossChain ? (ccQuote?.compositeExecutionMode || compositeMode) : undefined,
      diagnostics,
      steps,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      selectedProvider: ccQuote?.provider || (route.hops[0]?.dexProtocol ? String(route.hops[0].dexProtocol) : undefined),
      selectedDex: route.dexQuote?.provider || ccQuote?.sourceDexQuote?.provider || ccQuote?.destDexQuote?.provider,
      calldata: route.execution?.data || ccQuote?.calldata || route.dexQuote?.calldata,
      approvalTarget: route.execution?.approvalTarget || ccQuote?.approvalTarget || route.dexQuote?.approvalTarget,
      executionTarget: route.execution?.to || ccQuote?.executionTarget || route.dexQuote?.executionTarget,
      expiration: ccQuote?.expiration || route.dexQuote?.expiration,
      capabilityEvidence: (route as any).capabilityLevel || (ccQuote as any)?.capabilityLevel,
      totalFeeRaw: ccQuote?.relayerFee || (route.dexQuote?.feeAmount ? route.dexQuote.feeAmount.toString() : '0'),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    (plan as any).recipient = request.recipientAddress || request.userWalletAddress || options?.recipientAddress || options?.userAddress;

    // Observability structured logging (privacy-safe: no private keys, signatures, or secret data)
    this.logPlanSummary(plan, stepIds);

    sealPlan(plan);
    return plan;
  }

  /**
   * Builds an authoritative ExecutionPlan directly from a NormalizedRoute and QuoteRequest.
   * Ensures deterministic pass-through without reconstructing or modifying arbitrated route data.
   */
  public static buildPlanFromNormalizedRoute(params: {
    normalizedRoute: NormalizedRoute;
    request: QuoteRequest;
    options?: PlanBuilderOptions;
  }): ExecutionPlan {
    const { normalizedRoute, request, options } = params;
    if (normalizedRoute.executionTarget === ZERO_ADDRESS || normalizedRoute.executionTarget === '') {
      throw new InvalidExecutionTargetError(normalizedRoute.executionTarget || 'EMPTY', normalizedRoute.sourceChainId, 'Zero address target is not permitted');
    }
    if (normalizedRoute.approvalTarget === ZERO_ADDRESS || normalizedRoute.approvalTarget === '') {
      throw new InvalidExecutionTargetError(normalizedRoute.approvalTarget || 'EMPTY', normalizedRoute.sourceChainId, 'Zero address approval target is not permitted');
    }
    const isCrossChain = normalizedRoute.routeType !== 'SAME_CHAIN';
    const swapRoute: SwapRoute = {
      id: normalizedRoute.routeId,
      routeType: isCrossChain ? 'CROSS_CHAIN' : 'DIRECT',
      hops: [
        {
          dexProtocol: (normalizedRoute.sourceDex || normalizedRoute.bridgeProvider || 'ZENITH') as any,
          poolAddress: normalizedRoute.executionTarget || '',
          tokenIn: normalizedRoute.sourceToken,
          tokenOut: normalizedRoute.destinationToken,
          proportionPercent: 100,
          estimatedGas: BigInt(normalizedRoute.estimatedGasRaw || '150000')
        }
      ],
      isExecutable: normalizedRoute.isExecutable,
      unexecutableReason: normalizedRoute.unexecutableReason,
      gasCostUSD: 0.1,
      estimatedGasUnits: BigInt(normalizedRoute.estimatedGasRaw || '150000'),
      execution: normalizedRoute.calldata && normalizedRoute.executionTarget ? ({
        to: normalizedRoute.executionTarget,
        data: normalizedRoute.calldata,
        value: normalizedRoute.valueWei || '0',
        approvalTarget: normalizedRoute.approvalTarget,
        chainId: String(normalizedRoute.sourceChainId)
      } as any) : undefined,
      crossChainQuote: isCrossChain ? {
        provider: (normalizedRoute.bridgeProvider || 'ACROSS') as any,
        providerName: String(normalizedRoute.bridgeProvider || 'ACROSS'),
        sourceChainId: normalizedRoute.sourceChainId,
        destinationChainId: normalizedRoute.destinationChainId,
        sourceToken: normalizedRoute.sourceToken,
        destinationToken: normalizedRoute.destinationToken,
        sourceAmountRaw: normalizedRoute.inputAmountRaw,
        destinationAmountRaw: normalizedRoute.expectedOutputRaw,
        minDestinationAmountRaw: normalizedRoute.minimumOutputRaw,
        bridgeFeeUSD: 0,
        relayerFee: normalizedRoute.totalFeeRaw,
        gasEstimateUSD: 0,
        recipient: request.recipientAddress || request.userWalletAddress || '',
        expiration: normalizedRoute.expiresAt,
        routeIdentifier: normalizedRoute.routeId,
        executionTarget: normalizedRoute.executionTarget || '',
        calldata: normalizedRoute.calldata || '0x',
        value: normalizedRoute.valueWei || '0',
        approvalTarget: normalizedRoute.approvalTarget,
        quoteTimestamp: normalizedRoute.quotedAt,
        estimatedTransferTimeSec: 60,
        securityRating: 'A',
        isExecutable: normalizedRoute.isExecutable,
        unexecutableReason: normalizedRoute.unexecutableReason,
        sourceDexQuote: normalizedRoute.sourceDex ? ({
          provider: normalizedRoute.sourceDex,
          executionTarget: (normalizedRoute as any).sourceDexTarget || (normalizedRoute.sourceDex === 'UNISWAP_V3' ? '0xE592427A0AEce92De3Edee1F18E0157C05861564' : normalizedRoute.executionTarget) || '',
          approvalTarget: (normalizedRoute as any).sourceDexApprovalTarget || (normalizedRoute.sourceDex === 'UNISWAP_V3' ? '0xE592427A0AEce92De3Edee1F18E0157C05861564' : normalizedRoute.approvalTarget) || '',
          calldata: (normalizedRoute as any).sourceDexCalldata || normalizedRoute.calldata || '0x',
          amountOut: BigInt(normalizedRoute.inputAmountRaw),
          minimumAmountOut: BigInt(normalizedRoute.inputAmountRaw),
          tokenIn: normalizedRoute.sourceToken,
          tokenOut: normalizedRoute.sourceToken,
          feeTierBps: 30,
          gasEstimate: 150000n,
          gasCostUSD: 0.05
        } as any) : undefined
      } as any : undefined,
      dexQuote: !isCrossChain ? {
        provider: (normalizedRoute.sourceDex || 'UNISWAP_V3') as any,
        providerName: String(normalizedRoute.sourceDex || 'UNISWAP_V3'),
        chainId: 137,
        tokenIn: normalizedRoute.sourceToken,
        tokenOut: normalizedRoute.destinationToken,
        amountIn: BigInt(normalizedRoute.inputAmountRaw),
        amountOut: BigInt(normalizedRoute.expectedOutputRaw),
        minimumAmountOut: BigInt(normalizedRoute.minimumOutputRaw),
        feeAmount: BigInt(normalizedRoute.totalFeeRaw || '0'),
        feeTierBps: 30,
        priceImpactPercent: 0.1,
        executionTarget: normalizedRoute.executionTarget || '',
        approvalTarget: normalizedRoute.approvalTarget || normalizedRoute.executionTarget || '',
        calldata: normalizedRoute.calldata,
        gasEstimate: BigInt(normalizedRoute.estimatedGasRaw || '150000'),
        gasCostUSD: 0.05,
        quoteTimestamp: normalizedRoute.quotedAt,
        expiration: normalizedRoute.expiresAt
      } : undefined
    };
    (swapRoute as any).capabilityLevel = normalizedRoute.capabilityLevel;
    const plan = this.buildPlan({ route: swapRoute, request, options });

    // Enforce 100% Direct Authoritative Mapping (Task 28 Section 10 & 17)
    const p = plan as any;
    p.routeId = normalizedRoute.routeId;
    p.sourceChainId = normalizedRoute.sourceChainId;
    p.destinationChainId = normalizedRoute.destinationChainId;
    p.tokenIn = normalizedRoute.sourceToken;
    p.tokenOut = normalizedRoute.destinationToken;
    p.expectedAmountInRaw = normalizedRoute.inputAmountRaw;
    p.expectedAmountOutRaw = normalizedRoute.expectedOutputRaw;
    p.minimumAmountOutRaw = normalizedRoute.minimumOutputRaw;
    p.selectedProvider = normalizedRoute.bridgeProvider;
    p.selectedDex = normalizedRoute.sourceDex || normalizedRoute.destinationDex;
    p.executionTarget = normalizedRoute.executionTarget;
    p.approvalTarget = normalizedRoute.approvalTarget;
    p.calldata = normalizedRoute.calldata;
    p.expiration = normalizedRoute.expiresAt;
    p.capabilityEvidence = normalizedRoute.capabilityLevel;
    p.totalFeeRaw = normalizedRoute.totalFeeRaw;
    p.recipient = request.recipientAddress || request.userWalletAddress;

    if (request.executionMode === 'READ_ONLY') {
      p.isExecutable = false;
      p.unexecutableReason = 'READ_ONLY_MODE: Execution disabled in READ_ONLY mode.';
    } else if (normalizedRoute.expiresAt && normalizedRoute.expiresAt <= Date.now()) {
      p.isExecutable = false;
      p.unexecutableReason = 'QUOTE_EXPIRED: The selected route quote has expired.';
    } else if (!normalizedRoute.isExecutable) {
      p.isExecutable = false;
      p.unexecutableReason = normalizedRoute.unexecutableReason || 'ROUTE_UNEXECUTABLE';
    }

    sealPlan(plan);
    return plan;
  }

  private static logPlanSummary(plan: ExecutionPlan, stepIds: string[]): void {
    try {
      console.log('[ZENITH ExecutionPlanBuilder] Generated ExecutionPlan:', {
        planId: plan.planId,
        routeId: plan.routeId,
        routeType: plan.routeType,
        sourceChain: plan.sourceChainId,
        destinationChain: plan.destinationChainId,
        stepCount: plan.steps.length,
        stepIds,
        isExecutable: plan.isExecutable,
        unexecutableReason: plan.unexecutableReason || null,
        diagnosticCount: plan.diagnostics.length
      });
    } catch {
      // Ignore logging errors
    }
  }
}


