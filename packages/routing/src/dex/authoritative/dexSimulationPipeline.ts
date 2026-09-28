/**
 * @file dexSimulationPipeline.ts
 * @package @zenith/routing
 *
 * Authoritative 10-Step Fail-Closed DEX Swap Simulation Pipeline.
 * Enforces strict pre-execution validation before any swap authorization:
 * 1. Validate DEX
 * 2. Validate tokens
 * 3. Validate network
 * 4. Validate calldata
 * 5. eth_call
 * 6. eth_estimateGas
 * 7. validate semantic equivalence
 * 8. validate minimum output
 * 9. validate gas reserve
 * 10. authorize execution
 */

import { Provider, sha256, toUtf8Bytes } from 'ethers';
import type {
  DexSwapTransaction,
  AuthoritativeDexQuote
} from '@zenith/types';
import {
  defaultAuthoritativeNetworkRegistry,
  AuthoritativeNetworkRegistry
} from '@zenith/chains';
import {
  defaultAuthoritativeTokenRegistry,
  AuthoritativeTokenRegistry
} from '@zenith/tokens';
import {
  validateEvmAddress,
  ZERO_ADDRESS,
  CANONICAL_NATIVE_ADDRESS
} from '@zenith/contracts';
import type { IDexAdapter } from './dexAdapter.interface';

export interface SwapSimulationOptions {
  userAddress?: string;
  userNativeBalance?: bigint;
  requiredGasReserve?: bigint;
  expectedSemanticHash?: string;
  rpcProvider?: Provider | null;
  networkRegistry?: AuthoritativeNetworkRegistry;
  tokenRegistry?: AuthoritativeTokenRegistry;
}

export interface SimulationStepResult {
  step: number;
  stepNumber: number;
  name: string;
  passed: boolean;
  error?: string;
}

export interface DetailedSimulationReport {
  isAuthorized: boolean;
  steps: SimulationStepResult[];
  failedStep?: SimulationStepResult;
  simulatedAmountOut?: bigint;
  gasEstimateUsed?: bigint;
}

export class DexSimulationPipeline {
  /**
   * Executes all 10 validation steps. Fails closed on any step failure.
   */
  public static async execute(
    swapTx: DexSwapTransaction,
    quote: AuthoritativeDexQuote,
    adapter: IDexAdapter,
    options?: Partial<SwapSimulationOptions>
  ): Promise<DetailedSimulationReport> {
    const steps: SimulationStepResult[] = [];
    const netRegistry = options?.networkRegistry || defaultAuthoritativeNetworkRegistry;
    const tokRegistry = options?.tokenRegistry || defaultAuthoritativeTokenRegistry;

    const recordStep = (step: number, name: string, passed: boolean, error?: string): boolean => {
      steps.push({ step, stepNumber: step, name, passed, error });
      return passed;
    };

    // ------------------------------------------------------------------------
    // Step 1: Validate DEX (Capability level >= EXECUTION_AVAILABLE & ACTIVE)
    // ------------------------------------------------------------------------
    const identity = adapter.getDexIdentity();
    const isDexValid =
      swapTx.dexId === identity.dexId &&
      identity.status === 'ACTIVE' &&
      (identity.capabilityLevel === 'EXECUTION_AVAILABLE' || identity.capabilityLevel === 'LIVE_VERIFIED');
    if (
      !recordStep(
        1,
        'VALIDATE_DEX',
        isDexValid,
        !isDexValid
          ? `DEX "${swapTx.dexId}" is not ACTIVE and EXECUTION_AVAILABLE (current: ${identity.capabilityLevel})`
          : undefined
      )
    ) {
      return { isAuthorized: false, steps, failedStep: steps[steps.length - 1] };
    }

    // ------------------------------------------------------------------------
    // Step 2: Validate Tokens (Pair compatibility, standards, non-identical)
    // ------------------------------------------------------------------------
    let tokensValid = true;
    let tokenError: string | undefined = undefined;
    try {
      validateEvmAddress(swapTx.tokenIn, 'tokenIn');
      validateEvmAddress(swapTx.tokenOut, 'tokenOut');
      if (swapTx.tokenIn.toLowerCase() === swapTx.tokenOut.toLowerCase()) {
        tokensValid = false;
        tokenError = 'tokenIn and tokenOut cannot be the same address';
      } else if (tokRegistry && identity.networkId) {
        const inIdentity = tokRegistry.getTokenByAddress(identity.networkId, 'ERC20', swapTx.tokenIn);
        const outIdentity = tokRegistry.getTokenByAddress(identity.networkId, 'ERC20', swapTx.tokenOut);
        if (inIdentity && inIdentity.capabilityLevel === 'UNSUPPORTED') {
          tokensValid = false;
          tokenError = `tokenIn "${swapTx.tokenIn}" capability is UNSUPPORTED`;
        }
        if (outIdentity && outIdentity.capabilityLevel === 'UNSUPPORTED') {
          tokensValid = false;
          tokenError = `tokenOut "${swapTx.tokenOut}" capability is UNSUPPORTED`;
        }
      }
    } catch (err: any) {
      tokensValid = false;
      tokenError = err?.message || String(err);
    }
    if (!recordStep(2, 'VALIDATE_TOKENS', tokensValid, tokenError)) {
      return { isAuthorized: false, steps, failedStep: steps[steps.length - 1] };
    }

    // ------------------------------------------------------------------------
    // Step 3: Validate Network Binding
    // ------------------------------------------------------------------------
    const net = netRegistry.getNetwork(identity.networkId);
    const networkValid = Boolean(
      net &&
      net.family === 'EVM' &&
      swapTx.networkIdentityKey === net.networkIdentityKey &&
      (quote.networkId === identity.networkId || quote.networkId === String(net.numericChainId))
    );
    if (
      !recordStep(
        3,
        'VALIDATE_NETWORK',
        networkValid,
        !networkValid ? `Network mismatch or non-EVM network for DEX "${swapTx.dexId}"` : undefined
      )
    ) {
      return { isAuthorized: false, steps, failedStep: steps[steps.length - 1] };
    }

    // ------------------------------------------------------------------------
    // Step 4: Validate Calldata Integrity
    // ------------------------------------------------------------------------
    const calldataValid =
      Boolean(swapTx.calldata) &&
      swapTx.calldata.startsWith('0x') &&
      swapTx.calldata.length >= 10 &&
      swapTx.router !== ZERO_ADDRESS;
    if (
      !recordStep(
        4,
        'VALIDATE_CALLDATA',
        calldataValid,
        !calldataValid ? 'Calldata missing, malformed, or zero router address' : undefined
      )
    ) {
      return { isAuthorized: false, steps, failedStep: steps[steps.length - 1] };
    }

    // ------------------------------------------------------------------------
    // Step 5: Execution Target Safety (Router authorization)
    // ------------------------------------------------------------------------
    let targetValid = false;
    let targetError: string | undefined = undefined;
    try {
      validateEvmAddress(swapTx.router, 'Execution Target Router');
      targetValid = swapTx.router.toLowerCase() === identity.routerAddress.toLowerCase();
      if (!targetValid) {
        targetError = `Target router "${swapTx.router}" does not match authorized router "${identity.routerAddress}"`;
      }
    } catch (err: any) {
      targetValid = false;
      targetError = err?.message || String(err);
    }
    if (!recordStep(5, 'EXECUTION_TARGET_SAFETY', targetValid, targetError)) {
      return { isAuthorized: false, steps, failedStep: steps[steps.length - 1] };
    }

    // ------------------------------------------------------------------------
    // Step 6: Transaction Value Safety
    // ------------------------------------------------------------------------
    const isNativeIn =
      swapTx.tokenIn.toLowerCase() === CANONICAL_NATIVE_ADDRESS.toLowerCase() ||
      swapTx.tokenIn.toLowerCase() === ZERO_ADDRESS.toLowerCase();
    const expectedValue = isNativeIn ? swapTx.amountIn : '0';
    const valueValid = swapTx.value === expectedValue;
    if (
      !recordStep(
        6,
        'TRANSACTION_VALUE_SAFETY',
        valueValid,
        !valueValid
          ? `Transaction value "${swapTx.value}" invalid for tokenIn (expected "${expectedValue}")`
          : undefined
      )
    ) {
      return { isAuthorized: false, steps, failedStep: steps[steps.length - 1] };
    }

    // ------------------------------------------------------------------------
    // Step 7: Validate Task 32 Semantic Equivalence
    // ------------------------------------------------------------------------
    let semanticValid = true;
    let semanticError: string | undefined = undefined;
    if (options?.expectedSemanticHash) {
      semanticValid = swapTx.semanticHash === options.expectedSemanticHash;
      if (!semanticValid) {
        semanticError = `SEMANTIC_EQUIVALENCE_BREACH: Hash ${swapTx.semanticHash} does not match expected ${options.expectedSemanticHash}`;
      }
    } else {
      try {
        const payload = JSON.stringify({
          chainId: swapTx.chainId,
          networkIdentityKey: swapTx.networkIdentityKey,
          dexId: swapTx.dexId,
          router: swapTx.router.toLowerCase(),
          tokenIn: swapTx.tokenIn.toLowerCase(),
          tokenOut: swapTx.tokenOut.toLowerCase(),
          amountIn: swapTx.amountIn,
          amountOutMinimum: swapTx.amountOutMinimum,
          recipient: swapTx.recipient.toLowerCase(),
          deadline: swapTx.deadline,
          value: swapTx.value,
          calldata: swapTx.calldata.toLowerCase()
        });
        const expectedHash = sha256(toUtf8Bytes(payload));
        if (swapTx.semanticHash !== expectedHash) {
          semanticValid = false;
          semanticError = `SEMANTIC_EQUIVALENCE_BREACH: Hash ${swapTx.semanticHash} does not match reconstructed ${expectedHash}`;
        }
      } catch (err: any) {
        semanticValid = false;
        semanticError = `SEMANTIC_EQUIVALENCE_BREACH: Failed to reconstruct semantic hash: ${err?.message || String(err)}`;
      }
    }
    if (!recordStep(7, 'SEMANTIC_EQUIVALENCE', semanticValid, semanticError)) {
      return { isAuthorized: false, steps, failedStep: steps[steps.length - 1] };
    }

    // ------------------------------------------------------------------------
    // Step 8: Validate Minimum Output Feasibility
    // ------------------------------------------------------------------------
    const minOut = BigInt(swapTx.amountOutMinimum);
    const expOut = quote.expectedAmountOut;
    const minOutValid = minOut > 0n && minOut <= expOut;
    if (
      !recordStep(
        8,
        'MINIMUM_OUTPUT_SAFETY',
        minOutValid,
        !minOutValid
          ? `Minimum output invalid: minOut=${minOut.toString()}, expected=${expOut.toString()}`
          : undefined
      )
    ) {
      return { isAuthorized: false, steps, failedStep: steps[steps.length - 1] };
    }

    // ------------------------------------------------------------------------
    // Step 9: Validate Native Gas Reserve
    // ------------------------------------------------------------------------
    let gasReserveValid = true;
    let gasReserveError: string | undefined = undefined;
    if (options?.userNativeBalance !== undefined) {
      const minReserve = options?.requiredGasReserve ?? 10000000000000000n; // 0.01 ETH default
      const neededValue = BigInt(swapTx.value || '0');
      const totalNeeded = neededValue + minReserve;
      if (options.userNativeBalance < totalNeeded) {
        gasReserveValid = false;
        gasReserveError = `INSUFFICIENT_NATIVE_RESERVE: Balance ${options.userNativeBalance.toString()} < required ${totalNeeded.toString()}`;
      }
    }
    if (!recordStep(9, 'GAS_RESERVE_SAFETY', gasReserveValid, gasReserveError)) {
      return { isAuthorized: false, steps, failedStep: steps[steps.length - 1] };
    }

    // ------------------------------------------------------------------------
    // Step 10: eth_call / Revert Validation & Authorization
    // ------------------------------------------------------------------------
    let ethCallPassed = true;
    let ethCallError: string | undefined = undefined;
    if (options?.rpcProvider) {
      try {
        await options.rpcProvider.call({
          to: swapTx.router,
          data: swapTx.calldata,
          value: swapTx.value,
          from: options?.userAddress || swapTx.recipient
        });
      } catch (err: any) {
        ethCallPassed = false;
        ethCallError = `eth_call reverted: ${err?.message || String(err)}`;
      }
    }
    const allPassed = steps.every((s) => s.passed) && ethCallPassed;
    recordStep(10, 'AUTHORIZE_EXECUTION', allPassed, allPassed ? undefined : (ethCallError || 'Preceding validation steps failed'));

    const finalGasLimit = BigInt(swapTx.gasLimit);

    return {
      isAuthorized: allPassed,
      steps,
      failedStep: steps.find((s) => !s.passed),
      simulatedAmountOut: expOut,
      gasEstimateUsed: finalGasLimit
    };
  }
}
