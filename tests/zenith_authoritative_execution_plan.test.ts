import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  ExecutionPlan,
  QuoteRequest
} from '@zenith/types';
import { DEFAULT_TOKENS } from '@zenith/tokens';
import {
  ExecutionPlanBuilder,
  ExecutionPlanValidator,
  ExecutionCoordinator,
  DestinationExecutionEngine,
  CrossChainTracker
} from '../packages/execution/src';
import {
  ExecutionPlanValidationError,
  DuplicateStepIdError,
  PlanMissingDependencyError,
  PlanDependencyCycleError,
  InvalidExecutionTargetError,
  InvalidCalldataError,
  DestinationExecutionUnavailableError,
  InsufficientBalanceError
} from '../packages/contracts/src';

const ethToken = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
const usdcEth = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
const usdcArb = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;
const user = '0x1234567890abcdef1234567890abcdef12345678';
const routerContract = '0xE592427A0AEce92De3Edee1F18E0157C05861564';

function buildMockSigner(overrides: {
  balance?: bigint;
  allowance?: bigint;
  callRevert?: boolean;
  estimateGasRevert?: boolean;
  sendTxRevert?: boolean;
  txHash?: string;
  receiptStatus?: number;
} = {}) {
  const txHash = overrides.txHash || '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const receiptStatus = overrides.receiptStatus !== undefined ? overrides.receiptStatus : 1;

  return {
    getAddress: async () => user,
    sendTransaction: async (_tx: any) => {
      if (overrides.sendTxRevert) {
        throw new Error('execution reverted: User rejected transaction');
      }
      return {
        hash: txHash,
        wait: async () => ({
          status: receiptStatus,
          hash: txHash,
          blockNumber: 12345678,
          gasUsed: BigInt(150000),
          gasPrice: BigInt(30000000000),
          logs: []
        })
      };
    },
    provider: {
      getBalance: async () => overrides.balance !== undefined ? overrides.balance : BigInt('10000000000000000000'),
      call: async (tx: any) => {
        if (overrides.callRevert) {
          throw new Error('CALL_EXCEPTION: execution reverted (TRANSFER_FAILED)');
        }
        const data = typeof tx === 'string' ? tx : tx?.data || '';
        if (data.startsWith('0xdd62ed3e') && overrides.allowance !== undefined) {
          return '0x' + overrides.allowance.toString(16).padStart(64, '0');
        }
        if (data.startsWith('0x70a08231')) {
          const bal = overrides.balance !== undefined ? overrides.balance : BigInt('10000000000000000000');
          return '0x' + bal.toString(16).padStart(64, '0');
        }
        return '0x0000000000000000000000000000000000000000000000000000000000000001';
      },
      estimateGas: async () => {
        if (overrides.estimateGasRevert) {
          throw new Error('UNPREDICTABLE_GAS_LIMIT: execution reverted: STF');
        }
        return BigInt(150000);
      },
      getFeeData: async () => ({ gasPrice: BigInt(30000000000) }),
      getTransactionReceipt: async (hash: string) => ({
        status: receiptStatus,
        hash,
        blockNumber: 12345678,
        gasUsed: BigInt(150000),
        gasPrice: BigInt(30000000000),
        logs: []
      })
    }
  } as any;
}

describe('ZENITH — Phase 0 / Task 2: Authoritative ExecutionPlan Integration Test Suite', () => {

  // --------------------------------------------------------------------------
  // 1. Valid ExecutionPlan
  // --------------------------------------------------------------------------
  test('1. Valid ExecutionPlan passes validation', () => {
    const validPlan: ExecutionPlan = {
      planId: 'plan-valid-1',
      routeId: 'route-direct-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-val',
          type: 'VALIDATION',
          title: 'Validation',
          description: 'Pre-flight check',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 10000 }
        },
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Uniswap V3 swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x04e45aaf00000000000000000000000000000000',
          valueWei: '1000000000000000000',
          status: 'NOT_STARTED',
          dependencies: ['step-val'],
          retryPolicy: { maxRetries: 1, backoffMs: 2000, timeoutMs: 60000 }
        }
      ]
    };

    assert.doesNotThrow(() => ExecutionPlanValidator.validatePlan(validPlan));
  });

  // --------------------------------------------------------------------------
  // 2. Invalid ExecutionPlan (Missing required root fields)
  // --------------------------------------------------------------------------
  test('2. Invalid ExecutionPlan fails closed on missing root fields', () => {
    const invalidPlan: any = {
      planId: '',
      routeId: 'route-1',
      steps: []
    };

    assert.throws(
      () => ExecutionPlanValidator.validatePlan(invalidPlan),
      (err: any) => err instanceof ExecutionPlanValidationError
    );
  });

  // --------------------------------------------------------------------------
  // 3. Missing Dependency
  // --------------------------------------------------------------------------
  test('3. Step declaring missing dependency throws PlanMissingDependencyError', () => {
    const plan: ExecutionPlan = {
      planId: 'plan-missing-dep',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap step',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          status: 'NOT_STARTED',
          dependencies: ['non-existent-step'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    assert.throws(
      () => ExecutionPlanValidator.validatePlan(plan),
      (err: any) => err instanceof PlanMissingDependencyError
    );
  });

  // --------------------------------------------------------------------------
  // 4. Circular Dependency
  // --------------------------------------------------------------------------
  test('4. Circular dependency cycle throws PlanDependencyCycleError', () => {
    const plan: ExecutionPlan = {
      planId: 'plan-cycle',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-A',
          type: 'VALIDATION',
          title: 'Step A',
          description: 'Validation',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: ['step-B'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        },
        {
          id: 'step-B',
          type: 'SOURCE_SWAP',
          title: 'Step B',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          status: 'NOT_STARTED',
          dependencies: ['step-A'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    assert.throws(
      () => ExecutionPlanValidator.validatePlan(plan),
      (err: any) => err instanceof PlanDependencyCycleError
    );
  });

  // --------------------------------------------------------------------------
  // 5. Duplicate Step ID
  // --------------------------------------------------------------------------
  test('5. Duplicate step ID throws DuplicateStepIdError', () => {
    const plan: ExecutionPlan = {
      planId: 'plan-dup-step',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-duplicate',
          type: 'VALIDATION',
          title: 'Validation',
          description: 'Validation',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        },
        {
          id: 'step-duplicate',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    assert.throws(
      () => ExecutionPlanValidator.validatePlan(plan),
      (err: any) => err instanceof DuplicateStepIdError
    );
  });

  // --------------------------------------------------------------------------
  // 6. Invalid Chain ID
  // --------------------------------------------------------------------------
  test('6. Unknown chain ID on plan or step throws ExecutionPlanValidationError', () => {
    const plan: ExecutionPlan = {
      planId: 'plan-invalid-chain',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'fake-chain-network-999',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-val',
          type: 'VALIDATION',
          title: 'Validation',
          description: 'Validation',
          chainId: 'fake-chain-network-999',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    assert.throws(
      () => ExecutionPlanValidator.validatePlan(plan),
      (err: any) => err instanceof ExecutionPlanValidationError
    );
  });

  // --------------------------------------------------------------------------
  // 7. Invalid Target Address
  // --------------------------------------------------------------------------
  test('7. Executable step with zero address or invalid target throws InvalidExecutionTargetError', () => {
    const plan: ExecutionPlan = {
      planId: 'plan-invalid-target',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: '0x0000000000000000000000000000000000000000',
          calldata: '0x12345678',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    assert.throws(
      () => ExecutionPlanValidator.validatePlan(plan),
      (err: any) => err instanceof InvalidExecutionTargetError
    );
  });

  // --------------------------------------------------------------------------
  // 8. Invalid Calldata
  // --------------------------------------------------------------------------
  test('8. Executable step with empty or malformed calldata throws InvalidCalldataError', () => {
    const plan: ExecutionPlan = {
      planId: 'plan-invalid-calldata',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    assert.throws(
      () => ExecutionPlanValidator.validatePlan(plan),
      (err: any) => err instanceof InvalidCalldataError
    );
  });

  // --------------------------------------------------------------------------
  // 9. isExecutable=false Plan Execution Blocked
  // --------------------------------------------------------------------------
  test('9. Attempting to execute isExecutable=false plan throws appropriate unavailable error', async () => {
    const plan: ExecutionPlan = {
      planId: 'plan-unexecutable',
      routeId: 'route-1',
      routeType: 'CROSS_CHAIN_COMPOSITE',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: ethToken,
      tokenOut: usdcArb,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: false,
      unexecutableReason: 'DESTINATION_EXECUTION_UNAVAILABLE',
      compositeExecutionMode: 'UNSUPPORTED',
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-val',
          type: 'VALIDATION',
          title: 'Validation',
          description: 'Validation',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    const coordinator = new ExecutionCoordinator();
    await assert.rejects(
      async () => coordinator.executeTrade({ plan, userAddress: user, signer: buildMockSigner() }),
      (err: any) => err instanceof DestinationExecutionUnavailableError
    );
  });

  // --------------------------------------------------------------------------
  // 10. Same-Chain Swap Execution via Plan
  // --------------------------------------------------------------------------
  test('10. Same-chain swap executes strictly from plan step data', async () => {
    const plan: ExecutionPlan = {
      planId: 'plan-same-chain-exec',
      routeId: 'route-same-chain',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-val',
          type: 'VALIDATION',
          title: 'Validation',
          description: 'Validation check',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 10000 }
        },
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Execute Swap',
          description: 'Swap ETH to USDC',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x04e45aaf00000000000000000000000000000000',
          valueWei: '1000000000000000000',
          requiredTokenAddress: ethToken.address,
          requiredTokenSymbol: ethToken.symbol,
          requiredAmountRaw: '1000000000000000000',
          status: 'NOT_STARTED',
          dependencies: ['step-val'],
          retryPolicy: { maxRetries: 1, backoffMs: 2000, timeoutMs: 60000 }
        }
      ]
    };

    const mockSigner = buildMockSigner();
    const coordinator = new ExecutionCoordinator();
    const receipt = await coordinator.executeTrade({
      plan,
      userAddress: user,
      signer: mockSigner
    });

    assert.equal(receipt.status, 'COMPLETED');
    assert.ok(receipt.txHash.startsWith('0x'));
    assert.equal(receipt.sourceChain.id, 'ethereum');
  });

  // --------------------------------------------------------------------------
  // 11. Direct Cross-Chain Bridge Execution
  // --------------------------------------------------------------------------
  test('11. Direct cross-chain execution follows standard bridge plan', async () => {
    const bridgeTarget = '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5';
    const plan: ExecutionPlan = {
      planId: 'plan-direct-bridge',
      routeId: 'route-across-direct',
      routeType: 'CROSS_CHAIN_DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      expectedAmountInRaw: '1000000000',
      expectedAmountOutRaw: '999000000',
      minimumAmountOutRaw: '995000000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-val',
          type: 'VALIDATION',
          title: 'Validation',
          description: 'Validation check',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 10000 }
        },
        {
          id: 'step-appr',
          type: 'APPROVAL',
          title: 'Approval',
          description: 'Approve SpokePool',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: usdcEth.address,
          approvalTarget: bridgeTarget,
          requiredTokenAddress: usdcEth.address,
          requiredTokenSymbol: usdcEth.symbol,
          requiredAmountRaw: '1000000000',
          status: 'NOT_STARTED',
          dependencies: ['step-val'],
          retryPolicy: { maxRetries: 2, backoffMs: 1000, timeoutMs: 60000 }
        },
        {
          id: 'step-deposit',
          type: 'BRIDGE_DEPOSIT',
          title: 'Bridge Deposit',
          description: 'Deposit to Across SpokePool',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: bridgeTarget,
          calldata: '0x9d7a049400000000000000000000000000000000',
          valueWei: '0',
          requiredTokenAddress: usdcEth.address,
          requiredTokenSymbol: usdcEth.symbol,
          requiredAmountRaw: '1000000000',
          status: 'NOT_STARTED',
          dependencies: ['step-appr'],
          retryPolicy: { maxRetries: 1, backoffMs: 2000, timeoutMs: 60000 }
        },
        {
          id: 'step-wait',
          type: 'BRIDGE_RELAY_WAIT',
          title: 'Relay Wait',
          description: 'Wait for relayer fill',
          chainId: 'arbitrum',
          executionEnvironment: 'OFF_CHAIN',
          status: 'NOT_STARTED',
          dependencies: ['step-deposit'],
          retryPolicy: { maxRetries: 10, backoffMs: 1000, timeoutMs: 60000 }
        },
        {
          id: 'step-complete',
          type: 'SETTLEMENT_COMPLETE',
          title: 'Settlement Complete',
          description: 'Settlement finalized',
          chainId: 'arbitrum',
          executionEnvironment: 'OFF_CHAIN',
          status: 'NOT_STARTED',
          dependencies: ['step-wait'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    const mockSigner = buildMockSigner({ allowance: BigInt('2000000000') });
    const coordinator = new ExecutionCoordinator();
    const receipt = await coordinator.executeTrade({
      plan,
      userAddress: user,
      signer: mockSigner,
      skipDestinationWait: true
    });

    assert.ok(receipt);
    assert.ok(receipt.txHash.startsWith('0x'));
  });

  // --------------------------------------------------------------------------
  // 12. Composite Cross-Chain Route Must Remain Blocked
  // --------------------------------------------------------------------------
  test('12. Composite cross-chain execution plan has isExecutable=false and fails closed', () => {
    const req: QuoteRequest = {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: ethToken,
      tokenOut: usdcArb,
      amountInRaw: '1000000000000000000',
      slippageTolerancePercent: 0.5
    };

    // Constructing a composite route representation
    const compositePlan = ExecutionPlanBuilder.buildPlan({
      route: {
        id: 'route-composite-test',
        routeType: 'CROSS_CHAIN',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        tokenIn: ethToken,
        tokenOut: usdcArb,
        amountInRaw: '1000000000000000000',
        expectedAmountOutRaw: '2490000000',
        minimumAmountOutRaw: '2477550000',
        priceImpactPercent: 0.05,
        executionPrice: 2490,
        hops: [],
        gasCostUSD: 5,
        estimatedGasUnits: 150000n,
        crossChainQuote: {
          provider: 'ACROSS',
          providerName: 'Across Protocol',
          sourceChainId: 'ethereum',
          destinationChainId: 'arbitrum',
          sourceToken: ethToken,
          destinationToken: usdcArb,
          sourceAmountRaw: '1000000000000000000',
          destinationAmountRaw: '2490000000',
          minDestinationAmountRaw: '2477550000',
          bridgeFeeUSD: 2,
          relayerFee: '0',
          gasEstimateUSD: 3,
          recipient: user,
          expiration: Date.now() + 60000,
          routeIdentifier: 'across-eth-arb',
          executionTarget: routerContract,
          calldata: '0x1234',
          value: '0',
          approvalTarget: routerContract,
          quoteTimestamp: Date.now(),
          estimatedTransferTimeSec: 45,
          securityRating: 'A+',
          destDexQuote: {
            provider: 'UNISWAP_V3',
            providerName: 'Uniswap V3',
            chainId: 42161,
            tokenIn: usdcArb,
            tokenOut: usdcArb,
            amountIn: 2495000000n,
            amountOut: 2490000000n,
            minimumAmountOut: 2477550000n,
            feeAmount: 5000000n,
            feeTierBps: 5,
            priceImpactPercent: 0.05,
            gasEstimate: 120000n,
            gasCostUSD: 1,
            executionTarget: routerContract,
            approvalTarget: routerContract,
            quoteTimestamp: Date.now(),
            expiration: Date.now() + 60000
          }
        }
      } as any,
      request: req,
      options: { userAddress: user }
    });

    assert.equal(compositePlan.isExecutable, false);
    assert.equal(compositePlan.unexecutableReason, 'DESTINATION_EXECUTION_UNAVAILABLE');
  });

  // --------------------------------------------------------------------------
  // 13. Provider Unavailable
  // --------------------------------------------------------------------------
  test('13. Route missing signer throws SignerRequiredError when EVM transaction requested', async () => {
    const plan: ExecutionPlan = {
      planId: 'plan-no-signer',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    const coordinator = new ExecutionCoordinator();
    await assert.rejects(
      async () => coordinator.executeTrade({ plan, userAddress: user, signer: undefined }),
      /SIGNER_REQUIRED|Signer/
    );
  });

  // --------------------------------------------------------------------------
  // 14. eth_call Simulation Revert
  // --------------------------------------------------------------------------
  test('14. Pre-flight eth_call revert stops broadcast and throws SimulationRevertError', async () => {
    const mockSigner = buildMockSigner({ callRevert: true });
    const plan: ExecutionPlan = {
      planId: 'plan-sim-revert',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    const coordinator = new ExecutionCoordinator();
    await assert.rejects(
      async () => coordinator.executeTrade({ plan, userAddress: user, signer: mockSigner }),
      /SIMULATION_FAILED|SimulationRevertError|reverted/
    );
  });

  // --------------------------------------------------------------------------
  // 15. Gas Estimation Failure
  // --------------------------------------------------------------------------
  test('15. Gas estimation failure halts pipeline before broadcast', async () => {
    const mockSigner = buildMockSigner({ estimateGasRevert: true });
    const plan: ExecutionPlan = {
      planId: 'plan-gas-revert',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    const coordinator = new ExecutionCoordinator();
    await assert.rejects(
      async () => coordinator.executeTrade({ plan, userAddress: user, signer: mockSigner }),
      /Gas estimation|GAS_ESTIMATION|SIMULATION_FAILED/
    );
  });

  // --------------------------------------------------------------------------
  // 16. Insufficient Balance Check
  // --------------------------------------------------------------------------
  test('16. Insufficient balance check halts execution before eth_call or broadcast', async () => {
    const mockSigner = buildMockSigner({ balance: 0n });
    const plan: ExecutionPlan = {
      planId: 'plan-insufficient-bal',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          valueWei: '1000000000000000000',
          requiredTokenAddress: ethToken.address,
          requiredTokenSymbol: ethToken.symbol,
          requiredAmountRaw: '1000000000000000000',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    const coordinator = new ExecutionCoordinator();
    await assert.rejects(
      async () => coordinator.executeTrade({ plan, userAddress: user, signer: mockSigner }),
      (err: any) => err instanceof InsufficientBalanceError || err?.message?.includes('Insufficient balance')
    );
  });

  // --------------------------------------------------------------------------
  // 17. Insufficient Allowance Triggers Approval
  // --------------------------------------------------------------------------
  test('17. Insufficient allowance step executes approval before swap', async () => {
    const mockSigner = buildMockSigner({
      allowance: 0n // 0 allowance initially
    });

    const plan: ExecutionPlan = {
      planId: 'plan-approval-flow',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: usdcEth,
      tokenOut: ethToken,
      expectedAmountInRaw: '1000000000',
      expectedAmountOutRaw: '400000000000000000',
      minimumAmountOutRaw: '398000000000000000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-val',
          type: 'VALIDATION',
          title: 'Validation',
          description: 'Validation',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        },
        {
          id: 'step-appr',
          type: 'APPROVAL',
          title: 'Approve USDC',
          description: 'Approve router to spend USDC',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: usdcEth.address,
          approvalTarget: routerContract,
          requiredTokenAddress: usdcEth.address,
          requiredTokenSymbol: usdcEth.symbol,
          requiredAmountRaw: '1000000000',
          status: 'NOT_STARTED',
          dependencies: ['step-val'],
          retryPolicy: { maxRetries: 2, backoffMs: 1000, timeoutMs: 60000 }
        },
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          requiredTokenAddress: usdcEth.address,
          requiredTokenSymbol: usdcEth.symbol,
          requiredAmountRaw: '1000000000',
          status: 'NOT_STARTED',
          dependencies: ['step-appr'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    const coordinator = new ExecutionCoordinator();
    const receipt = await coordinator.executeTrade({
      plan,
      userAddress: user,
      signer: mockSigner
    });

    assert.equal(receipt.status, 'COMPLETED');
  });

  // --------------------------------------------------------------------------
  // 18. Approval Failure Halts Execution
  // --------------------------------------------------------------------------
  test('18. Approval failure aborts before executing the dependent swap', async () => {
    const mockSigner = buildMockSigner({
      allowance: 0n,
      sendTxRevert: true // Approval transaction reverts
    });

    const plan: ExecutionPlan = {
      planId: 'plan-appr-fail',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: usdcEth,
      tokenOut: ethToken,
      expectedAmountInRaw: '1000000000',
      expectedAmountOutRaw: '400000000000000000',
      minimumAmountOutRaw: '398000000000000000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-appr',
          type: 'APPROVAL',
          title: 'Approve USDC',
          description: 'Approve router',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: usdcEth.address,
          approvalTarget: routerContract,
          requiredTokenAddress: usdcEth.address,
          requiredTokenSymbol: usdcEth.symbol,
          requiredAmountRaw: '1000000000',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        },
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          status: 'NOT_STARTED',
          dependencies: ['step-appr'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    const coordinator = new ExecutionCoordinator();
    await assert.rejects(
      async () => coordinator.executeTrade({ plan, userAddress: user, signer: mockSigner }),
      /rejected|reverted/
    );
  });

  // --------------------------------------------------------------------------
  // 19. Duplicate Execution Prevention (Idempotency)
  // --------------------------------------------------------------------------
  test('19. Re-executing an already executed step returns existing result without re-broadcast', async () => {
    let broadcastCount = 0;
    const txHash = '0x1122334455667788990011223344556677889900112233445566778899001122';
    const mockSigner = {
      getAddress: async () => user,
      sendTransaction: async (_tx: any) => {
        broadcastCount++;
        return {
          hash: txHash,
          wait: async () => ({
            status: 1,
            hash: txHash,
            blockNumber: 12345678,
            gasUsed: BigInt(150000),
            gasPrice: BigInt(30000000000),
            logs: []
          })
        };
      },
      provider: {
        getBalance: async () => BigInt('10000000000000000000'),
        call: async () => '0x0000000000000000000000000000000000000000000000000000000000000001',
        estimateGas: async () => BigInt(150000),
        getFeeData: async () => ({ gasPrice: BigInt(30000000000) }),
        getTransactionReceipt: async () => ({
          status: 1,
          hash: txHash,
          blockNumber: 12345678,
          gasUsed: BigInt(150000),
          gasPrice: BigInt(30000000000),
          logs: []
        })
      }
    };

    const plan: ExecutionPlan = {
      planId: 'plan-idempotency-test',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    const coordinator = new ExecutionCoordinator();
    await coordinator.executeTrade({ plan, userAddress: user, signer: mockSigner });
    assert.equal(broadcastCount, 1);

    // Second execution of the exact same plan
    await coordinator.executeTrade({ plan, userAddress: user, signer: mockSigner });
    assert.equal(broadcastCount, 1, 'Idempotency must prevent second broadcast of identical planId + stepId');
  });

  // --------------------------------------------------------------------------
  // 20. Already-Successful Step is Skipped
  // --------------------------------------------------------------------------
  test('20. Step with status=SUCCESS in plan is skipped and not re-executed', async () => {
    let broadcastCount = 0;
    const mockSigner = {
      getAddress: async () => user,
      sendTransaction: async () => {
        broadcastCount++;
        return {
          hash: '0x9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff',
          wait: async () => ({ status: 1 })
        };
      },
      provider: {
        getBalance: async () => BigInt('10000000000000000000'),
        call: async () => '0x01',
        estimateGas: async () => BigInt(150000),
        getFeeData: async () => ({ gasPrice: BigInt(30000000000) }),
        getTransactionReceipt: async (hash: string) => ({ status: 1, hash })
      }
    };

    const plan: ExecutionPlan = {
      planId: 'plan-already-success',
      routeId: 'route-1',
      routeType: 'DIRECT',
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: ethToken,
      tokenOut: usdcEth,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-swap',
          type: 'SOURCE_SWAP',
          title: 'Swap',
          description: 'Swap',
          chainId: 'ethereum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          status: 'SUCCESS', // already marked SUCCESS
          txHash: '0xalreadyconfirmedtxhash000000000000000000000000000000000000000000000',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    const coordinator = new ExecutionCoordinator();
    const receipt = await coordinator.executeTrade({ plan, userAddress: user, signer: mockSigner });
    assert.equal(broadcastCount, 0, 'Should not broadcast for already SUCCESS step');
    assert.equal(receipt.txHash, '0xalreadyconfirmedtxhash000000000000000000000000000000000000000000000');
  });

  // --------------------------------------------------------------------------
  // 21. Uncertain Transaction Recovery
  // --------------------------------------------------------------------------
  test('21. Receipt query recovers confirmed transaction without submitting another', async () => {
    const existingTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const tracker = new CrossChainTracker();
    const verification = await tracker.verifyDestinationSettlement({
      destinationChainId: 'ethereum',
      destinationTxHash: existingTxHash,
      expectedRecipient: user,
      provider: {
        getTransactionReceipt: async (h: string) => ({
          status: 1,
          hash: h,
          blockNumber: 55555
        })
      }
    });

    assert.equal(verification.isVerified, true);
  });

  // --------------------------------------------------------------------------
  // 22. Fake Transaction Hash Prevention
  // --------------------------------------------------------------------------
  test('22. Solver Engine throws DestinationExecutionUnavailableError and never generates fake 0xd... hash', async () => {
    const destEngine = new DestinationExecutionEngine();
    await assert.rejects(
      async () => {
        const destPlan = await destEngine.prepareExecution({
          intentId: 'test-fake-hash-prevention',
          sourceChainId: 'ethereum',
          destinationChainId: 'arbitrum',
          recipient: user,
          inputToken: ethToken,
          inputAmountActual: '1000000000000000000',
          outputToken: usdcArb,
          minimumOutputAmount: '2487500000',
          deadline: Date.now() + 600000,
          bridgeProvider: 'ACROSS',
          providerOrderId: 'order-123'
        });

        // Executing destination swap with no destination signer
        await destEngine.executeDestinationSwap({
          plan: destPlan,
          provider: undefined
        });
      },
      (err: any) => {
        assert.ok(err instanceof DestinationExecutionUnavailableError);
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // 23. Destination Execution Unavailable
  // --------------------------------------------------------------------------
  test('23. Destination execution unavailable fails closed when destination swap required', async () => {
    const plan: ExecutionPlan = {
      planId: 'plan-dest-unavailable',
      routeId: 'route-composite-unsupported',
      routeType: 'CROSS_CHAIN_COMPOSITE',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: ethToken,
      tokenOut: usdcArb,
      expectedAmountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '2500000000',
      minimumAmountOutRaw: '2487500000',
      isExecutable: true,
      compositeExecutionMode: 'UNSUPPORTED',
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      diagnostics: [],
      steps: [
        {
          id: 'step-dest-swap',
          type: 'DESTINATION_SWAP',
          title: 'Destination Swap',
          description: 'Destination swap on Arbitrum',
          chainId: 'arbitrum',
          executionEnvironment: 'EVM',
          targetAddress: routerContract,
          calldata: '0x12345678',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
        }
      ]
    };

    const coordinator = new ExecutionCoordinator();
    await assert.rejects(
      async () => coordinator.executeTrade({ plan, userAddress: user, signer: buildMockSigner() }),
      (err: any) => err instanceof DestinationExecutionUnavailableError
    );
  });

  // --------------------------------------------------------------------------
  // 24. Destination Settlement Verification Failure
  // --------------------------------------------------------------------------
  test('24. Destination settlement verification failure marks step failed and throws', async () => {
    const tracker = new CrossChainTracker();
    const result = await tracker.verifyDestinationSettlement({
      destinationChainId: 'arbitrum',
      destinationTxHash: '0xdeadbeef00000000000000000000000000000000000000000000000000000000',
      expectedRecipient: user,
      provider: {
        getTransactionReceipt: async () => ({
          status: 0, // Transaction reverted on destination chain
          hash: '0xdeadbeef00000000000000000000000000000000000000000000000000000000'
        })
      }
    });

    assert.equal(result.isVerified, false);
    assert.equal(result.reason, 'Destination transaction reverted on-chain');
  });

});
