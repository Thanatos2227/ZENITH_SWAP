import {
  NormalizedRoute,
  QuoteRequest
} from '@zenith/types';
import { ZERO_ADDRESS, validateEvmAddress } from '@zenith/contracts';
import { RouteFreshnessValidator } from './routeFreshnessValidator';
import { CrossChainProviderCapabilityMatrix } from '../crosschain/crossChainProviderCapabilityMatrix';
import { defaultProviderHealthRegistry, ProviderHealthRegistry } from './providerHealthRegistry';

export interface RouteFilterOptions {
  currentTime?: number;
  executionMode?: 'READ_ONLY' | 'SIMULATION' | 'PREFLIGHT_ONLY' | 'LIVE_EXECUTION' | 'LIVE_ONCHAIN' | 'DIAGNOSTIC';
  healthRegistry?: ProviderHealthRegistry;
}

export interface RouteFilterGateResult {
  passed: boolean;
  gate: string;
  reason?: string;
}

export interface RouteFilterEvaluation {
  isExecutable: boolean;
  unexecutableReason?: string;
  passedGates: string[];
  failedGates: string[];
}

export class RouteCapabilityFilter {
  /**
   * Evaluates all 10 pre-scoring gates for a normalized route.
   * Only routes passing all 10 gates enter EXECUTABLE_ROUTE_CANDIDATES.
   */
  public static evaluate(
    route: NormalizedRoute,
    request: QuoteRequest,
    options?: RouteFilterOptions
  ): RouteFilterEvaluation {
    const now = options?.currentTime ?? Date.now();
    const mode = options?.executionMode ?? request.executionMode ?? 'SIMULATION';
    const healthRegistry = options?.healthRegistry ?? defaultProviderHealthRegistry;

    const passedGates: string[] = [];
    const failedGates: string[] = [];
    const reasons: string[] = [];

    const recordGate = (name: string, passed: boolean, reason?: string) => {
      if (passed) {
        passedGates.push(name);
      } else {
        failedGates.push(name);
        if (reason) reasons.push(reason);
      }
    };

    // -------------------------------------------------------------
    // Gate 1: Provider Capability
    // -------------------------------------------------------------
    let capPassed = true;
    let capReason: string | undefined = undefined;

    if (route.bridgeProvider) {
      const providerId = String(route.bridgeProvider);
      // Provider Health check
      const healthCheck = healthRegistry.isExecutionPermitted(providerId);
      if (!healthCheck.permitted) {
        capPassed = false;
        capReason = healthCheck.reason;
      } else if (mode === 'LIVE_EXECUTION' || mode === 'LIVE_ONCHAIN') {
        const isLiveMatrix = CrossChainProviderCapabilityMatrix.isLiveVerified(
          providerId as any,
          route.sourceChainId,
          route.destinationChainId,
          route.sourceToken.symbol,
          route.destinationToken.symbol
        );
        const isLive = isLiveMatrix && route.capabilityLevel === 'LIVE_VERIFIED';
        if (!isLive) {
          capPassed = false;
          capReason = `CAPABILITY_MISMATCH: Provider ${providerId} level "${route.capabilityLevel}" is not LIVE_VERIFIED for route ${route.sourceChainId}->${route.destinationChainId}. Required for LIVE_EXECUTION.`;
        }
      } else if (mode === 'SIMULATION' || mode === 'PREFLIGHT_ONLY') {
        const rank = CrossChainProviderCapabilityMatrix.getCapabilityRank(route.capabilityLevel);
        const minRank = CrossChainProviderCapabilityMatrix.getCapabilityRank('EXECUTION_AVAILABLE');
        if (rank < minRank) {
          capPassed = false;
          capReason = `CAPABILITY_MISMATCH: Provider ${providerId} level "${route.capabilityLevel}" does not meet minimum EXECUTION_AVAILABLE required for PREFLIGHT_ONLY.`;
        }
      }
    }
    recordGate('GATE_1_PROVIDER_CAPABILITY', capPassed, capReason);

    // -------------------------------------------------------------
    // Gate 2: Quote Executability
    // -------------------------------------------------------------
    const isExec = route.isExecutable && !route.unexecutableReason;
    recordGate(
      'GATE_2_QUOTE_EXECUTABILITY',
      isExec,
      !isExec ? (route.unexecutableReason || 'QUOTE_UNEXECUTABLE: Route marked unexecutable.') : undefined
    );

    // -------------------------------------------------------------
    // Gate 3: Quote Freshness
    // -------------------------------------------------------------
    const freshness = RouteFreshnessValidator.validate(route.quotedAt, route.expiresAt, {
      currentTime: now
    });
    recordGate('GATE_3_QUOTE_FRESHNESS', freshness.isExecutable, freshness.reason);

    // -------------------------------------------------------------
    // Gate 4: Token Continuity
    // -------------------------------------------------------------
    let tokenContinuity = true;
    let tokenReason: string | undefined = undefined;

    if (
      route.sourceToken.symbol.toUpperCase() !== request.tokenIn.symbol.toUpperCase() &&
      !route.sourceDex
    ) {
      tokenContinuity = false;
      tokenReason = `TOKEN_DISCONTINUITY: Source token ${route.sourceToken.symbol} does not match requested token ${request.tokenIn.symbol}.`;
    } else if (
      route.destinationToken.symbol.toUpperCase() !== request.tokenOut.symbol.toUpperCase() &&
      !route.destinationDex
    ) {
      tokenContinuity = false;
      tokenReason = `TOKEN_DISCONTINUITY: Destination token ${route.destinationToken.symbol} does not match requested token ${request.tokenOut.symbol}.`;
    }
    recordGate('GATE_4_TOKEN_CONTINUITY', tokenContinuity, tokenReason);

    // -------------------------------------------------------------
    // Gate 5: Chain Continuity
    // -------------------------------------------------------------
    const chainContinuity =
      String(route.sourceChainId).toLowerCase() === String(request.sourceChainId).toLowerCase() &&
      String(route.destinationChainId).toLowerCase() === String(request.destinationChainId).toLowerCase();
    recordGate(
      'GATE_5_CHAIN_CONTINUITY',
      chainContinuity,
      !chainContinuity
        ? `CHAIN_DISCONTINUITY: Route chains (${route.sourceChainId}->${route.destinationChainId}) do not match request (${request.sourceChainId}->${request.destinationChainId}).`
        : undefined
    );

    // -------------------------------------------------------------
    // Gate 6: Execution Target
    // -------------------------------------------------------------
    let targetValid = true;
    let targetReason: string | undefined = undefined;
    const target = route.executionTarget;
    if (!target || target === ZERO_ADDRESS || target.trim() === '') {
      targetValid = false;
      targetReason = 'INVALID_EXECUTION_TARGET: Target contract address is missing or ZeroAddress.';
    } else {
      try {
        validateEvmAddress(target, 'Execution Target');
      } catch (err: any) {
        targetValid = false;
        targetReason = `INVALID_EXECUTION_TARGET: ${err?.message || err}`;
      }
    }
    recordGate('GATE_6_EXECUTION_TARGET', targetValid, targetReason);

    // -------------------------------------------------------------
    // Gate 7: Calldata
    // -------------------------------------------------------------
    let calldataValid = true;
    let calldataReason: string | undefined = undefined;
    const cdata = route.calldata;
    const isExecutionRequired =
      mode === 'LIVE_EXECUTION' || mode === 'LIVE_ONCHAIN' || mode === 'PREFLIGHT_ONLY';

    if (cdata !== undefined) {
      if (cdata === '0x' || !cdata.startsWith('0x') || cdata.length < 10) {
        calldataValid = false;
        calldataReason = `INVALID_CALLDATA: Calldata is missing, empty, or shorter than 4-byte selector (got "${cdata}").`;
      }
    } else if (isExecutionRequired) {
      calldataValid = false;
      calldataReason = 'INVALID_CALLDATA: Calldata is required for live or preflight execution.';
    }
    recordGate('GATE_7_CALLDATA', calldataValid, calldataReason);

    // -------------------------------------------------------------
    // Gate 8: Approval Target
    // -------------------------------------------------------------
    let approvalValid = true;
    let approvalReason: string | undefined = undefined;
    const isSourceNative = Boolean(route.sourceToken.isNative);
    if (!isSourceNative) {
      const appTarget = route.approvalTarget;
      if (appTarget !== undefined) {
        if (!appTarget || appTarget === ZERO_ADDRESS || appTarget.trim() === '') {
          approvalValid = false;
          approvalReason = 'INVALID_APPROVAL_TARGET: Approval target contract address is missing or ZeroAddress for non-native token.';
        } else {
          try {
            validateEvmAddress(appTarget, 'Approval Target');
          } catch (err: any) {
            approvalValid = false;
            approvalReason = `INVALID_APPROVAL_TARGET: ${err?.message || err}`;
          }
        }
      } else if (isExecutionRequired) {
        approvalValid = false;
        approvalReason = 'INVALID_APPROVAL_TARGET: Approval target contract address is missing for non-native token.';
      }
    }
    recordGate('GATE_8_APPROVAL_TARGET', approvalValid, approvalReason);

    // -------------------------------------------------------------
    // Gate 9: Receiver
    // -------------------------------------------------------------
    let receiverValid = true;
    let receiverReason: string | undefined = undefined;
    const receiver = request.recipientAddress || (request as any).recipient || request.userWalletAddress;
    if (receiver !== undefined) {
      if (receiver === ZERO_ADDRESS || receiver.trim() === '') {
        receiverValid = false;
        receiverReason = 'INVALID_RECEIVER: Recipient address is missing or ZeroAddress.';
      } else {
        try {
          validateEvmAddress(receiver, 'Recipient Address');
        } catch (err: any) {
          receiverValid = false;
          receiverReason = `INVALID_RECEIVER: ${err?.message || err}`;
        }
      }
    } else if (isExecutionRequired) {
      receiverValid = false;
      receiverReason = 'INVALID_RECEIVER: Recipient address is missing or ZeroAddress.';
    }
    recordGate('GATE_9_RECEIVER', receiverValid, receiverReason);

    // -------------------------------------------------------------
    // Gate 10: Expiration
    // -------------------------------------------------------------
    const expirationValid = route.expiresAt > now && route.expiresAt > 0;
    recordGate(
      'GATE_10_EXPIRATION',
      expirationValid,
      !expirationValid
        ? `INVALID_EXPIRATION: Route expiresAt (${route.expiresAt}) is not strictly in the future (currentTime: ${now}).`
        : undefined
    );

    const isAllPassed = failedGates.length === 0;

    return {
      isExecutable: isAllPassed,
      unexecutableReason: isAllPassed ? undefined : reasons.join('; '),
      passedGates,
      failedGates
    };
  }
}
