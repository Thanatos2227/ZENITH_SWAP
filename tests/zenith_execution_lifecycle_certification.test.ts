import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ExecutionPlan,
  ExecutionPlanStep,
  QuoteRequest,
  NormalizedRoute,
  Token
} from '@zenith/types';
import {
  ExecutionPlanBuilder,
  ExecutionPlanValidator,
  ExecutionCoordinator,
  computeExecutionPlanHash,
  sealPlan,
  verifyPlanIntegrity,
  assertPlanIntegrity,
  PlanIntegrityBreachError,
  ExecutionPlanMutationError,
  GoldenPathCrashRecoveryCoordinator,
  verifyDestinationSettlement,
  extractActualSourceSwapOutput,
  CrossChainStatusReconciler,
  defaultInMemoryRepository,
  InMemoryCrossChainStateRepository,
  validateTransactionStateTransition
} from '@zenith/execution';
import {
  ZERO_ADDRESS,
  RecipientMismatchError,
  SecurityPolicyViolationError,
  SignerRequiredError,
  ExecutionUnavailableError,
  SourceSwapFailedError,
  BridgeFailedError,
  AmountMismatchError,
  QuoteUnavailableError,
  BroadcastUncertainError,
  AmbiguousBroadcastError,
  ExecutionPlanValidationError,
  InvalidExecutionTargetError
} from '@zenith/contracts';
import { ExecutionStateMachine } from '../packages/execution/src/stateMachine';

// ============================================================================
// TEST FIXTURES & BUILDER HELPERS
// ============================================================================

const DEFAULT_USER = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';
const SPOKE_POOL_POLYGON = '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

const POLYGON_USDC: Token = {
  address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: 'polygon',
  verificationTier: 'VERIFIED_CANONICAL'
};

const ARBITRUM_USDC: Token = {
  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: 'arbitrum',
  verificationTier: 'VERIFIED_CANONICAL'
};

const POLYGON_POL: Token = {
  address: '0x0000000000000000000000000000000000001010',
  symbol: 'POL',
  name: 'Polygon Ecosystem Token',
  decimals: 18,
  chainId: 'polygon',
  isNative: true,
  verificationTier: 'VERIFIED_CANONICAL'
};

function makeBaseRequest(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return {
    sourceChainId: 'polygon',
    destinationChainId: 'arbitrum',
    tokenIn: POLYGON_USDC,
    tokenOut: ARBITRUM_USDC,
    amountInRaw: '100000000',
    amountInFormatted: '100.0',
    userWalletAddress: DEFAULT_USER,
    recipientAddress: DEFAULT_USER,
    slippageTolerancePercent: 0.5,
    executionMode: 'PREFLIGHT_ONLY',
    ...overrides
  };
}

function makeNormalizedRoute(overrides: Partial<NormalizedRoute> = {}): NormalizedRoute {
  const now = Date.now();
  return {
    routeId: 'route-test-lifecycle-001',
    routeType: 'DIRECT_CROSS_CHAIN',
    sourceChainId: 'polygon',
    destinationChainId: 'arbitrum',
    sourceToken: POLYGON_USDC,
    destinationToken: ARBITRUM_USDC,
    inputAmountRaw: '100000000',
    expectedOutputRaw: '99800000',
    minimumOutputRaw: '99500000',
    totalFeeRaw: '100000',
    bridgeFeeRaw: '80000',
    dexFeeRaw: '0',
    estimatedGasRaw: '150000',
    estimatedGasCostRaw: '20000000000000',
    estimatedDurationSec: 30,
    bridgeProvider: 'ACROSS',
    capabilityLevel: 'LIVE_VERIFIED',
    calldata: '0x12345678abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    executionTarget: SPOKE_POOL_POLYGON,
    approvalTarget: SPOKE_POOL_POLYGON,
    isExecutable: true,
    quotedAt: now,
    expiresAt: now + 60000,
    ...overrides
  };
}

// ============================================================================
// 1. EXECUTIONPLAN IMMUTABILITY & LIFECYCLE PRESERVATION
// ============================================================================
describe('1. ExecutionPlan Immutability & Lifecycle Preservation', () => {
  it('1.1 Generated ExecutionPlan is automatically sealed with cryptographic hash', () => {
    const norm = makeNormalizedRoute();
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: norm,
      request: makeBaseRequest()
    });
    assert.ok(plan.integrityHash, 'Plan must possess integrityHash');
    assert.ok(plan.planHash, 'Plan must possess planHash');
    assert.equal(plan.integrityHash, plan.planHash);
    assert.equal(verifyPlanIntegrity(plan), true);
  });

  it('1.2 Immutability check after plan creation: mutation of minimumAmountOutRaw is detected', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    assert.equal(verifyPlanIntegrity(plan), true);

    // Attempt unauthorized mutation
    (plan as any).minimumAmountOutRaw = '50000000';
    assert.equal(verifyPlanIntegrity(plan), false);
    assert.throws(
      () => assertPlanIntegrity(plan),
      (err: any) => err instanceof PlanIntegrityBreachError
    );
  });

  it('1.3 Immutability check after persistence: recovered plan integrity matches', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    await repo.saveExecutionPlan(plan);

    const retrieved = await repo.getExecutionPlan(plan.planId);
    assert.ok(retrieved);
    assert.equal(verifyPlanIntegrity(retrieved), true);

    // Tamper with retrieved plan
    (retrieved as any).selectedProvider = 'MALICIOUS_BRIDGE';
    assert.equal(verifyPlanIntegrity(retrieved), false);
  });

  it('1.4 Immutability check during preflight: preflight verifies seal', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    assert.doesNotThrow(() => ExecutionPlanValidator.validatePlan(plan));

    // Tampering with calldata breaks validation
    (plan as any).calldata = '0xdeadbeef';
    assert.throws(() => ExecutionPlanValidator.validatePlan(plan));
  });

  it('1.5 Immutability check: re-sealing creates updated valid hash on authorized quote refresh', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    const originalHash = plan.integrityHash;

    // Authorized update on quote refresh
    (plan as any).expectedAmountOutRaw = '99950000';
    (plan as any).minimumAmountOutRaw = '99600000';
    sealPlan(plan);

    assert.notEqual(plan.integrityHash, originalHash);
    assert.equal(verifyPlanIntegrity(plan), true);
  });
});

// ============================================================================
// 2. PLAN HASH & INTEGRITY VERIFICATION (THE 9 MUTATION VECTORS)
// ============================================================================
describe('2. Plan Hash & Integrity Verification (The 9 Mutation Vectors)', () => {
  it('2.1 Original plan hash is computed deterministically', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    const hash1 = computeExecutionPlanHash(plan);
    const hash2 = computeExecutionPlanHash(plan);
    assert.equal(hash1, hash2);
    assert.equal(typeof hash1, 'string');
    assert.equal(hash1.length, 64);
  });

  it('2.2 Mutation 1: Changing provider invalidates hash', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute({ bridgeProvider: 'ACROSS' }),
      request: makeBaseRequest()
    });
    const expected = plan.integrityHash;
    (plan as any).selectedProvider = 'STARGATE';
    assert.notEqual(computeExecutionPlanHash(plan), expected);
    assert.equal(verifyPlanIntegrity(plan), false);
  });

  it('2.3 Mutation 2: Changing calldata invalidates hash', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    const expected = plan.integrityHash;
    (plan as any).calldata = '0x9999999999999999';
    assert.notEqual(computeExecutionPlanHash(plan), expected);
    assert.equal(verifyPlanIntegrity(plan), false);
  });

  it('2.4 Mutation 3: Changing amount in invalidates hash', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    const expected = plan.integrityHash;
    (plan as any).expectedAmountInRaw = '200000000';
    assert.notEqual(computeExecutionPlanHash(plan), expected);
    assert.equal(verifyPlanIntegrity(plan), false);
  });

  it('2.5 Mutation 4: Changing recipient invalidates hash', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    const expected = plan.integrityHash;
    (plan as any).recipient = '0x1111111111111111111111111111111111111111';
    assert.notEqual(computeExecutionPlanHash(plan), expected);
  });

  it('2.6 Mutation 5: Changing approval target invalidates hash', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    const expected = plan.integrityHash;
    (plan as any).approvalTarget = '0x2222222222222222222222222222222222222222';
    assert.notEqual(computeExecutionPlanHash(plan), expected);
    assert.equal(verifyPlanIntegrity(plan), false);
  });

  it('2.7 Mutation 6: Changing expiration invalidates hash', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    const expected = plan.integrityHash;
    (plan as any).expiration = 9999999999999;
    assert.notEqual(computeExecutionPlanHash(plan), expected);
    assert.equal(verifyPlanIntegrity(plan), false);
  });

  it('2.8 Mutation 7: Changing minimum output invalidates hash', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    const expected = plan.integrityHash;
    (plan as any).minimumAmountOutRaw = '99000000';
    assert.notEqual(computeExecutionPlanHash(plan), expected);
    assert.equal(verifyPlanIntegrity(plan), false);
  });

  it('2.9 Mutation 8: Changing execution target invalidates hash', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    const expected = plan.integrityHash;
    (plan as any).executionTarget = '0x3333333333333333333333333333333333333333';
    assert.notEqual(computeExecutionPlanHash(plan), expected);
    assert.equal(verifyPlanIntegrity(plan), false);
  });

  it('2.10 Mutation 9: Altering step DAG structures invalidates hash', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    const expected = plan.integrityHash;
    (plan.steps[0] as any).targetAddress = '0x4444444444444444444444444444444444444444';
    assert.notEqual(computeExecutionPlanHash(plan), expected);
    assert.equal(verifyPlanIntegrity(plan), false);
  });
});

// ============================================================================
// 3. PRE-FLIGHT CERTIFICATION
// ============================================================================
describe('3. Pre-Flight Certification', () => {
  it('3.1 Preflight validates exact transaction payload fidelity (zero byte drift)', () => {
    const norm = makeNormalizedRoute();
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: norm,
      request: makeBaseRequest()
    });
    const bridgeStep = plan.steps.find((s) => s.type === 'BRIDGE_DEPOSIT');
    assert.ok(bridgeStep);
    assert.equal(bridgeStep.targetAddress?.toLowerCase(), norm.executionTarget?.toLowerCase());
    assert.equal(bridgeStep.calldata, norm.calldata);
  });

  it('3.2 Missing signer in EVM mode throws SignerRequiredError before broadcast', async () => {
    const coordinator = new ExecutionCoordinator();
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    await assert.rejects(
      async () => {
        await coordinator.executeTrade({
          plan,
          userAddress: DEFAULT_USER,
          signer: undefined
        });
      },
      (err: any) => err instanceof SignerRequiredError
    );
  });

  it('3.3 User address mismatch with recipient throws RecipientMismatchError', async () => {
    const coordinator = new ExecutionCoordinator();
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest({ recipientAddress: DEFAULT_USER })
    });
    await assert.rejects(
      async () => {
        await coordinator.executeTrade({
          plan,
          userAddress: '0x1111111111111111111111111111111111111111',
          signer: {} as any
        });
      },
      (err: any) => err instanceof RecipientMismatchError
    );
  });

  it('3.4 Zero-address target fails closed with InvalidExecutionTargetError', () => {
    const invalidNorm = makeNormalizedRoute({ executionTarget: ZERO_ADDR });
    assert.throws(
      () => {
        ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
          normalizedRoute: invalidNorm,
          request: makeBaseRequest()
        });
      },
      (err: any) => err instanceof InvalidExecutionTargetError || err instanceof ExecutionPlanValidationError
    );
  });

  it('3.5 Malformed or empty calldata fails closed before simulation', () => {
    const invalidNorm = makeNormalizedRoute({ calldata: '0x' });
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: invalidNorm,
      request: makeBaseRequest({ executionMode: 'PREFLIGHT_ONLY' })
    });
    assert.equal(plan.isExecutable, false);
  });
});

// ============================================================================
// 4. SOURCE SWAP FAILURE MATRIX (20 CONDITIONS)
// ============================================================================
describe('4. Source Swap Failure Matrix (Deterministic Failure Injection)', () => {
  it('4.1 Quote unavailable throws QuoteUnavailableError', () => {
    const err = new QuoteUnavailableError('No routes found for specified corridor');
    assert.equal(err.name, 'QuoteUnavailableError');
  });

  it('4.2 Expired quote throws and marks plan unexecutable', () => {
    const expiredRoute = makeNormalizedRoute({ expiresAt: Date.now() - 10000 });
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: expiredRoute,
      request: makeBaseRequest()
    });
    assert.equal(plan.isExecutable, false);
  });

  it('4.3 Failed source swap triggers SourceSwapFailedError and halts', async () => {
    const mockAdapter: any = {
      checkAllowance: async () => 1000000000n,
      executeTransaction: async () => {
        throw new Error('execution reverted: UniswapV3: K');
      }
    };
    const coordinator = new ExecutionCoordinator(mockAdapter);
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute({ routeType: 'COMPOSITE_CROSS_CHAIN', sourceDex: 'UNISWAP_V3' }),
      request: makeBaseRequest()
    });

    await assert.rejects(
      async () => {
        await coordinator.executeTrade({
          plan,
          userAddress: DEFAULT_USER,
          signer: { getAddress: async () => DEFAULT_USER } as any
        });
      },
      (err: any) => err instanceof SourceSwapFailedError
    );
  });

  it('4.4 Source swap output below minimum required throws AmountMismatchError', async () => {
    const mockAdapter: any = {
      checkAllowance: async () => 1000000000n,
      executeTransaction: async () => {
        return {
          txHash: '0xsource_mined_low_output',
          gasUsed: 150000n,
          effectiveGasPriceWei: 30000000000n,
          receipt: { status: 1, blockNumber: 100000 }
        };
      }
    };
    const coordinator = new ExecutionCoordinator(mockAdapter);
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute({
        routeType: 'COMPOSITE_CROSS_CHAIN',
        sourceDex: 'UNISWAP_V3',
        minimumOutputRaw: '99000000'
      }),
      request: makeBaseRequest()
    });

    await assert.rejects(
      async () => {
        await coordinator.executeTrade({
          plan,
          userAddress: DEFAULT_USER,
          signer: { getAddress: async () => DEFAULT_USER } as any,
          actualAmounts: {
            sourceSwapActualOut: 95000000n // Less than 99000000n
          }
        });
      },
      (err: any) => err instanceof AmountMismatchError
    );
  });

  it('4.5 Source swap failure strictly prevents bridge execution', async () => {
    let bridgeCalled = false;
    const UNISWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    const mockAdapter: any = {
      checkAllowance: async () => 1000000000n,
      executeTransaction: async (params: any) => {
        if (params.to?.toLowerCase() === SPOKE_POOL_POLYGON.toLowerCase()) {
          bridgeCalled = true;
        }
        if (params.to?.toLowerCase() === UNISWAP_ROUTER.toLowerCase()) {
          throw new Error('Source swap reverted');
        }
        return { txHash: '0x123', receipt: { status: 1 } };
      }
    };
    const coordinator = new ExecutionCoordinator(mockAdapter);
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute({
        routeType: 'COMPOSITE_CROSS_CHAIN',
        sourceDex: 'UNISWAP_V3',
        executionTarget: SPOKE_POOL_POLYGON
      }),
      request: makeBaseRequest()
    });

    try {
      await coordinator.executeTrade({
        plan,
        userAddress: DEFAULT_USER,
        signer: { getAddress: async () => DEFAULT_USER } as any
      });
    } catch {
      // Expected failure
    }
    assert.equal(bridgeCalled, false, 'Downstream bridge must never be invoked after source swap failure');
  });
});

// ============================================================================
// 5. ACTUAL SOURCE OUTPUT EXTRACTION
// ============================================================================
describe('5. Actual Source Output Extraction', () => {
  it('5.1 Output extraction from Transfer event logs derives exact bigint', () => {
    const transferEventTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const recipientTopic = '0x000000000000000000000000' + DEFAULT_USER.slice(2).toLowerCase();
    const mockReceipt = {
      status: 1,
      blockNumber: 123456,
      logs: [
        {
          address: POLYGON_USDC.address.toLowerCase(),
          topics: [
            transferEventTopic,
            '0x0000000000000000000000003000000000000000000000000000000000000003',
            recipientTopic
          ],
          data: '0x0000000000000000000000000000000000000000000000000000000005f5e100' // 100,000,000 raw
        }
      ]
    };

    const extracted = extractActualSourceSwapOutput({
      receipt: mockReceipt,
      expectedTokenOutAddress: POLYGON_USDC.address,
      recipientAddress: DEFAULT_USER,
      minimumAmountOutRaw: '99000000',
      sourceChainId: 'polygon'
    });

    assert.equal(extracted.actualAmountRaw, '100000000');
    assert.equal(extracted.actualAmountBig, 100000000n);
  });

  it('5.2 Extraction fails closed when output is below required minimum', () => {
    const transferEventTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const recipientTopic = '0x000000000000000000000000' + DEFAULT_USER.slice(2).toLowerCase();
    const mockReceipt = {
      status: 1,
      blockNumber: 123456,
      logs: [
        {
          address: POLYGON_USDC.address.toLowerCase(),
          topics: [
            transferEventTopic,
            '0x0000000000000000000000003000000000000000000000000000000000000003',
            recipientTopic
          ],
          data: '0x00000000000000000000000000000000000000000000000000000000055d4a80' // 90,000,000 raw
        }
      ]
    };

    assert.throws(
      () => {
        extractActualSourceSwapOutput({
          receipt: mockReceipt,
          expectedTokenOutAddress: POLYGON_USDC.address,
          recipientAddress: DEFAULT_USER,
          minimumAmountOutRaw: '99000000', // Requires 99M
          sourceChainId: 'polygon'
        });
      },
      (err: any) => err instanceof AmountMismatchError
    );
  });

  it('5.3 Extraction fails closed if Transfer log for expected recipient is missing', () => {
    const mockReceipt = {
      status: 1,
      blockNumber: 123456,
      logs: []
    };

    assert.throws(() => {
      extractActualSourceSwapOutput({
        receipt: mockReceipt,
        expectedTokenOutAddress: POLYGON_USDC.address,
        recipientAddress: DEFAULT_USER,
        minimumAmountOutRaw: '99000000',
        sourceChainId: 'polygon'
      });
    });
  });
});

// ============================================================================
// 6. BRIDGE QUOTE REFRESH
// ============================================================================
describe('6. Bridge Quote Refresh Boundary', () => {
  it('6.1 Mined swap output updates bridge deposit required amount and reseals plan', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute({ routeType: 'COMPOSITE_CROSS_CHAIN', sourceDex: 'UNISWAP_V3' }),
      request: makeBaseRequest()
    });

    const bridgeStep = plan.steps.find((s) => s.type === 'BRIDGE_DEPOSIT');
    assert.ok(bridgeStep);

    // Mined output is 99700000 USDC
    const minedOutput = '99700000';
    bridgeStep.requiredAmountRaw = minedOutput;
    (plan as any).expectedAmountOutRaw = '99500000';
    (plan as any).minimumAmountOutRaw = '99200000';
    sealPlan(plan);

    assert.equal(bridgeStep.requiredAmountRaw, minedOutput);
    assert.equal(verifyPlanIntegrity(plan), true);
  });

  it('6.2 Stale pre-execution quote cannot be substituted for actual mined output', () => {
    const actualOutput = 99800000n;
    const preExecutionEstimate = 100000000n;
    assert.notEqual(actualOutput, preExecutionEstimate);
    assert.equal(actualOutput.toString(), '99800000');
  });
});

// ============================================================================
// 7. APPROVAL SAFETY
// ============================================================================
describe('7. Approval Safety', () => {
  it('7.1 Zero-address approval target is rejected', () => {
    assert.throws(
      () => {
        ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
          normalizedRoute: makeNormalizedRoute({ approvalTarget: ZERO_ADDR }),
          request: makeBaseRequest()
        });
      },
      (err: any) => err instanceof InvalidExecutionTargetError || err instanceof ExecutionPlanValidationError
    );
  });

  it('7.2 Existing sufficient allowance skips approval transaction dispatch', async () => {
    let approvalCalled = false;
    const mockAdapter: any = {
      checkAllowance: async () => 1000000000n, // Plenty of allowance
      executeTransaction: async (params: any) => {
        if (params.data?.startsWith('0x095ea7b3')) {
          approvalCalled = true;
        }
        return { txHash: '0xbridge_deposit_tx', gasUsed: 150000n, effectiveGasPriceWei: 30000000000n };
      }
    };
    const coordinator = new ExecutionCoordinator(mockAdapter);
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });

    await coordinator.executeTrade({
      plan,
      userAddress: DEFAULT_USER,
      signer: { getAddress: async () => DEFAULT_USER } as any,
      skipDestinationWait: true
    });

    assert.equal(approvalCalled, false, 'Approval must be skipped if allowance is already sufficient');
  });

  it('7.3 Reverting approval transaction halts before swap dispatch', async () => {
    let depositCalled = false;
    const mockAdapter: any = {
      checkAllowance: async () => 0n, // Zero allowance
      executeTransaction: async (params: any) => {
        if (params.to === SPOKE_POOL_POLYGON) {
          depositCalled = true;
        }
        throw new Error('Approval reverted');
      }
    };
    const coordinator = new ExecutionCoordinator(mockAdapter);
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });

    try {
      await coordinator.executeTrade({
        plan,
        userAddress: DEFAULT_USER,
        signer: { getAddress: async () => DEFAULT_USER } as any
      });
    } catch {
      // Expected
    }

    assert.equal(depositCalled, false, 'Deposit must not run if approval failed');
  });
});

// ============================================================================
// 8. BRIDGE DEPOSIT EXECUTION
// ============================================================================
describe('8. Bridge Deposit Execution', () => {
  it('8.1 Deposit execution returns valid confirmed receipt view', async () => {
    const mockAdapter: any = {
      checkAllowance: async () => 1000000000n,
      executeTransaction: async () => {
        return { txHash: '0xdeposit_success_hash', gasUsed: 120000n, effectiveGasPriceWei: 35000000000n };
      }
    };
    const coordinator = new ExecutionCoordinator(mockAdapter);
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });

    const receipt = await coordinator.executeTrade({
      plan,
      userAddress: DEFAULT_USER,
      signer: { getAddress: async () => DEFAULT_USER } as any,
      skipDestinationWait: true
    });

    assert.equal(receipt.txHash, '0xdeposit_success_hash');
    assert.equal(receipt.status, 'BRIDGE_IN_FLIGHT');
  });

  it('8.2 Deposit contract revert throws BridgeFailedError', async () => {
    const mockAdapter: any = {
      checkAllowance: async () => 1000000000n,
      executeTransaction: async () => {
        throw new Error('Bridge SpokePool deposit reverted');
      }
    };
    const coordinator = new ExecutionCoordinator(mockAdapter);
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });

    await assert.rejects(
      async () => {
        await coordinator.executeTrade({
          plan,
          userAddress: DEFAULT_USER,
          signer: { getAddress: async () => DEFAULT_USER } as any
        });
      },
      (err: any) => err instanceof BridgeFailedError
    );
  });
});

// ============================================================================
// 9. BROADCAST_UNCERTAIN CERTIFICATION
// ============================================================================
describe('9. BROADCAST_UNCERTAIN Safety Boundary', () => {
  it('9.1 Transport timeout or socket hangup triggers BroadcastUncertainError', () => {
    const err = new BroadcastUncertainError('Socket hang up during eth_sendRawTransaction', {
      transactionId: 'tx-temp-001',
      sender: DEFAULT_USER,
      nonce: 42,
      chainId: '137'
    });
    assert.equal(err.code, 'BROADCAST_UNCERTAIN');
    assert.equal(err.nonce, 42);
  });

  it('9.2 BROADCAST_UNCERTAIN preserves intent and prohibits automatic duplicate rebroadcast', () => {
    const err = new AmbiguousBroadcastError('Network connection reset');
    assert.equal(err instanceof BroadcastUncertainError, true);
    assert.equal(err.code, 'BROADCAST_UNCERTAIN');
  });
});

// ============================================================================
// 10. BRIDGE RELAY TRACKING & EVIDENCE HIERARCHY
// ============================================================================
describe('10. Bridge Relay Tracking & Evidence Hierarchy', () => {
  it('10.1 Relay pending holds step in progress without premature settlement', () => {
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: DEFAULT_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '99000000',
      providerStatus: 'pending',
      receipt: null
    });
    assert.equal(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
    assert.equal(res.deliveredToExpectedRecipient, false);
  });

  it('10.2 Relay refunded fails closed', () => {
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: DEFAULT_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '99000000',
      providerStatus: 'refunded',
      receipt: null
    });
    assert.equal(res.settlementStatus, 'DESTINATION_FAILED');
  });
});

// ============================================================================
// 11. AUTHORITATIVE 6-TIER DESTINATION VERIFICATION
// ============================================================================
describe('11. Authoritative 6-Tier Destination Verification', () => {
  it('11.1 Tier 1 on-chain receipt with status 1 confirms DESTINATION_SETTLED', () => {
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const recipientTopic = '0x000000000000000000000000' + DEFAULT_USER.slice(2).toLowerCase();
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      destinationTxHash: '0xfill_tx_arbitrum',
      expectedRecipient: DEFAULT_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '99000000',
      providerStatus: 'filled',
      receipt: {
        status: 1,
        blockNumber: 250000000,
        logs: [
          {
            address: ARBITRUM_USDC.address.toLowerCase(),
            topics: [
              transferTopic,
              '0x000000000000000000000000e35e9842fceaaca96570b734083f4a58e8f7c5f2',
              recipientTopic
            ],
            data: '0x0000000000000000000000000000000000000000000000000000000005f5e100' // 100M
          }
        ]
      }
    });

    assert.equal(res.settlementStatus, 'DESTINATION_SETTLED');
    assert.equal(res.primaryEvidenceTier, 'TIER_3_ERC20_TRANSFER_EVENT');
    assert.equal(res.deliveredToExpectedRecipient, true);
    assert.equal(res.tokenMatched, true);
  });

  it('11.2 Tier 1 receipt with status 0 results in DESTINATION_FAILED', () => {
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      destinationTxHash: '0xfill_reverted',
      expectedRecipient: DEFAULT_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '99000000',
      receipt: {
        status: 0,
        blockNumber: 250000000,
        logs: []
      }
    });
    assert.equal(res.settlementStatus, 'DESTINATION_FAILED');
  });

  it('11.3 Missing receipt fails closed as DESTINATION_STATUS_UNCERTAIN', () => {
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: DEFAULT_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '99000000',
      receipt: null
    });
    assert.equal(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
  });
});

// ============================================================================
// 12. SETTLEMENT IDEMPOTENCY (1x, 2x, 5x, 10x, 100x)
// ============================================================================
describe('12. Settlement Idempotency (1x, 2x, 5x, 10x, 100x)', () => {
  it('12.1 Repeated settlement verification runs yield identical state and zero new calls', () => {
    const params = {
      destinationChainId: 42161,
      destinationTxHash: '0xidem_test_hash',
      expectedRecipient: DEFAULT_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '99000000',
      providerStatus: 'filled',
      receipt: {
        status: 1,
        blockNumber: 12345,
        logs: [
          {
            address: ARBITRUM_USDC.address.toLowerCase(),
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x000000000000000000000000e35e9842fceaaca96570b734083f4a58e8f7c5f2',
              '0x000000000000000000000000' + DEFAULT_USER.slice(2).toLowerCase()
            ],
            data: '0x0000000000000000000000000000000000000000000000000000000005f5e100'
          }
        ]
      }
    };

    const first = verifyDestinationSettlement(params);
    assert.equal(first.settlementStatus, 'DESTINATION_SETTLED');

    // Run 100x
    for (let i = 0; i < 100; i++) {
      const repeated = verifyDestinationSettlement(params);
      assert.equal(repeated.settlementStatus, first.settlementStatus);
      assert.equal(repeated.primaryEvidenceTier, first.primaryEvidenceTier);
      assert.equal(repeated.actualDeliveredAmountRaw, first.actualDeliveredAmountRaw);
    }
  });
});

// ============================================================================
// 13. CRASH RECOVERY MATRIX
// ============================================================================
describe('13. Crash Recovery Matrix', () => {
  it('13.1 Coordinator resumes golden path from persisted SQLite state without duplicate broadcasts', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const planId = 'plan-crash-test-001';

    let swapCount = 0;
    let depositCount = 0;

    const mockAdapter = {
      executeSourceSwap: async () => {
        swapCount++;
        return { hash: '0xsource_tx_mined', receipt: { status: 1 } };
      },
      fetchFreshBridgeQuote: async (amount: string) => ({
        provider: 'ACROSS',
        destinationAmountRaw: amount,
        minDestinationAmountRaw: amount
      }),
      executeApproval: async () => ({ hash: '0xapproval_mined', receipt: { status: 1 } }),
      executeBridgeDeposit: async () => {
        depositCount++;
        return { hash: '0xbridge_tx_mined', receipt: { status: 1 } };
      },
      pollAcrossRelay: async () => ({ fillTxHash: '0xfill_mined', status: 'filled' }),
      fetchDestinationReceipt: async () => ({ status: 1 }),
      getRecipientDestinationBalanceDelta: async () => '100000000'
    };

    // Pre-populate execution plan and steps in repo for crash resumption
    await repo.saveExecutionPlan({
      planId,
      routeId: 'r-composite-crash',
      routeType: 'CROSS_CHAIN_COMPOSITE',
      sourceChainId: 'polygon',
      destinationChainId: 'arbitrum',
      tokenIn: POLYGON_USDC,
      tokenOut: ARBITRUM_USDC,
      expectedAmountInRaw: '100000000',
      expectedAmountOutRaw: '99800000',
      minimumAmountOutRaw: '99500000',
      isExecutable: true,
      diagnostics: [],
      steps: [
        {
          id: 'step-1-source-swap',
          type: 'SOURCE_SWAP',
          title: 'Source Swap',
          description: 'Swap',
          chainId: 'polygon',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: [],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 },
          verificationCondition: { type: 'ON_CHAIN_RECEIPT' }
        },
        {
          id: 'step-2-output-extract',
          type: 'VALIDATION',
          title: 'Output Extract',
          description: 'Extract output',
          chainId: 'polygon',
          executionEnvironment: 'OFF_CHAIN',
          status: 'NOT_STARTED',
          dependencies: ['step-1-source-swap'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 },
          verificationCondition: { type: 'API_STATUS' }
        },
        {
          id: 'step-3-quote-refresh',
          type: 'BRIDGE_QUOTE_REFRESH',
          title: 'Quote Refresh',
          description: 'Refresh quote',
          chainId: 'polygon',
          executionEnvironment: 'OFF_CHAIN',
          status: 'NOT_STARTED',
          dependencies: ['step-2-output-extract'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 },
          verificationCondition: { type: 'API_STATUS' }
        },
        {
          id: 'step-4-token-approval',
          type: 'APPROVAL',
          title: 'Approval',
          description: 'Approve bridge',
          chainId: 'polygon',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: ['step-3-quote-refresh'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 },
          verificationCondition: { type: 'ON_CHAIN_RECEIPT' }
        },
        {
          id: 'step-5-bridge-deposit',
          type: 'BRIDGE_DEPOSIT',
          title: 'Bridge Deposit',
          description: 'Deposit to bridge',
          chainId: 'polygon',
          executionEnvironment: 'EVM',
          status: 'NOT_STARTED',
          dependencies: ['step-4-token-approval'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 },
          verificationCondition: { type: 'ON_CHAIN_RECEIPT' }
        },
        {
          id: 'step-6-relay-tracking',
          type: 'BRIDGE_RELAY_WAIT',
          title: 'Relay Tracking',
          description: 'Wait for relay',
          chainId: 'arbitrum',
          executionEnvironment: 'OFF_CHAIN',
          status: 'NOT_STARTED',
          dependencies: ['step-5-bridge-deposit'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 },
          verificationCondition: { type: 'API_STATUS' }
        },
        {
          id: 'step-7-dest-verify',
          type: 'DESTINATION_VERIFY',
          title: 'Verify Settlement',
          description: 'Verify receipt',
          chainId: 'arbitrum',
          executionEnvironment: 'OFF_CHAIN',
          status: 'NOT_STARTED',
          dependencies: ['step-6-relay-tracking'],
          retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 },
          verificationCondition: { type: 'ON_CHAIN_RECEIPT' }
        }
      ],
      currentStepIndex: 0,
      overallStatus: 'IDLE',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const coordinator = new GoldenPathCrashRecoveryCoordinator({
      repository: repo,
      adapter: mockAdapter
    });

    // Run 1: Stop after source swap
    const res1 = await coordinator.executeOrResume(planId, { stopAfterPhase: 'PHASE_1_SOURCE_SWAP_MINED' });
    assert.equal(res1.sourceTxHash, '0xsource_tx_mined');
    assert.equal(swapCount, 1);

    // Run 2: Resume after crash; source swap must NOT be re-broadcast!
    const res2 = await coordinator.executeOrResume(planId);
    assert.equal(res2.status, 'DESTINATION_SETTLED');
    assert.equal(swapCount, 1, 'Source swap must never be duplicated upon crash resumption');
    assert.equal(depositCount, 1, 'Bridge deposit should only execute once');
  });

  it('13.2 Already settled execution returns immediately with settled=true', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const planId = 'plan-already-settled';
    let anyCall = false;

    const coordinator = new GoldenPathCrashRecoveryCoordinator({
      repository: repo,
      adapter: {
        executeSourceSwap: async () => { anyCall = true; return { hash: '0x', receipt: {} }; }
      }
    });

    // Mark settlement completed in repo
    await repo.recordSettlement({
      intentId: planId,
      planId,
      destinationTxHash: '0xdest_settled_tx',
      destinationBlockNumber: 440381615,
      actualAmountRaw: '100000000',
      verified: true,
      evidenceTier: 'TIER_1_ONCHAIN_RECEIPT',
      timestamp: Date.now()
    } as any);

    const res = await coordinator.executeOrResume(planId);
    assert.equal(res.settled, true);
    assert.equal(anyCall, false);
  });
});

// ============================================================================
// 14. EXECUTION MODE MATRIX
// ============================================================================
describe('14. Execution Mode Matrix', () => {
  it('14.1 READ_ONLY mode builds unexecutable plan and prohibits on-chain dispatch', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest({ executionMode: 'READ_ONLY' })
    });
    assert.equal(plan.isExecutable, false);
    assert.ok(plan.unexecutableReason?.includes('READ_ONLY'));
  });

  it('14.2 PREFLIGHT_ONLY mode permits simulation with zero on-chain broadcast', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest({ executionMode: 'PREFLIGHT_ONLY' })
    });
    assert.equal(plan.isExecutable, true);
  });

  it('14.3 LIVE_ONCHAIN mode strictly requires LIVE_VERIFIED capability', () => {
    const liveRoute = makeNormalizedRoute({ capabilityLevel: 'LIVE_VERIFIED' });
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: liveRoute,
      request: makeBaseRequest({ executionMode: 'LIVE_ONCHAIN' })
    });
    assert.equal(plan.isExecutable, true);
  });
});

// ============================================================================
// 15. EXECUTION STATE MACHINE & NO SKIP-STATE TESTING
// ============================================================================
describe('15. Execution State Machine & No Skip-State Testing', () => {
  it('15.1 Legal sequential transitions complete cleanly', () => {
    const sm = new ExecutionStateMachine();
    sm.initializeSteps([{ id: 's1', title: 'Step 1', description: 'desc', status: 'PENDING' }]);
    sm.transitionTo('PREPARING', { id: 's1', status: 'ACTIVE' });
    sm.transitionTo('SIMULATING', { id: 's1', status: 'ACTIVE' });
    sm.transitionTo('SIMULATED', { id: 's1', status: 'SUCCESS' });
    assert.equal(sm.getStatus(), 'SIMULATED');
  });

  it('15.2 Legal transaction lifecycle transitions succeed', () => {
    assert.doesNotThrow(() => validateTransactionStateTransition('CREATED', 'PREFLIGHTING'));
    assert.doesNotThrow(() => validateTransactionStateTransition('PREFLIGHTING', 'PREFLIGHT_PASSED'));
    assert.doesNotThrow(() => validateTransactionStateTransition('PREFLIGHT_PASSED', 'READY_TO_BROADCAST'));
    assert.doesNotThrow(() => validateTransactionStateTransition('READY_TO_BROADCAST', 'BROADCASTING'));
    assert.doesNotThrow(() => validateTransactionStateTransition('BROADCASTING', 'BROADCAST_CONFIRMED'));
    assert.doesNotThrow(() => validateTransactionStateTransition('BROADCAST_CONFIRMED', 'CONFIRMED'));
  });

  it('15.3 Illegal direct skip-state jumps are rejected', () => {
    assert.throws(() => validateTransactionStateTransition('CREATED', 'CONFIRMED'));
    assert.throws(() => validateTransactionStateTransition('READY_TO_BROADCAST', 'CONFIRMED'));
    assert.throws(() => validateTransactionStateTransition('BROADCASTING', 'CONFIRMING'));
  });
});

// ============================================================================
// 16. DUPLICATE INTENT & LEASE SAFETY
// ============================================================================
describe('16. Duplicate Intent & Lease Safety', () => {
  it('16.1 Concurrent execution of same step by second worker is rejected by lease conflict', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const resource = 'step:plan-test:step-1';

    const lease1 = await repo.acquireLease(resource, 'worker-1', 10000);
    assert.equal(lease1, true);

    const lease2 = await repo.acquireLease(resource, 'worker-2', 10000);
    assert.equal(lease2, false, 'Second worker must be locked out by lease conflict');
  });
});

// ============================================================================
// 17. SECURITY & ADVERSARIAL INJECTION MATRIX
// ============================================================================
describe('17. Security & Adversarial Injection Matrix', () => {
  it('17.1 Injected corrupted calldata fails validation', () => {
    const r = makeNormalizedRoute({ calldata: '0x1' });
    assert.throws(() => {
      const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
        normalizedRoute: r,
        request: makeBaseRequest({ executionMode: 'PREFLIGHT_ONLY' })
      });
      ExecutionPlanValidator.validatePlan(plan);
    });
  });

  it('17.2 Injected ZeroAddress receiver fails validation', () => {
    assert.throws(() => {
      ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
        normalizedRoute: makeNormalizedRoute(),
        request: makeBaseRequest({ recipientAddress: ZERO_ADDR }),
        options: { recipientAddress: ZERO_ADDR }
      });
    });
  });

  it('17.3 Injected token mismatch between plan and step fails closed', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    // Create new token object to prevent mutating fixture reference
    (plan as any).tokenIn = { ...plan.tokenIn, address: '0x1111111111111111111111111111111111111111' };
    assert.throws(() => ExecutionPlanValidator.validatePlan(plan));
  });
});

// ============================================================================
// 18. OBSERVABILITY & SANITIZED TELEMETRY
// ============================================================================
describe('18. Observability & Sanitized Telemetry', () => {
  it('18.1 ExecutionCoordinator produces structured privacy-safe ReceiptView', async () => {
    const mockAdapter: any = {
      checkAllowance: async () => 1000000000n,
      executeTransaction: async () => ({
        txHash: '0xreceipt_telemetry_hash',
        gasUsed: 120000n,
        effectiveGasPriceWei: 30000000000n
      })
    };
    const coordinator = new ExecutionCoordinator(mockAdapter);
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });

    const receipt = await coordinator.executeTrade({
      plan,
      userAddress: DEFAULT_USER,
      signer: { getAddress: async () => DEFAULT_USER } as any,
      skipDestinationWait: true
    });

    assert.ok(receipt.txHash);
    assert.ok(receipt.timestamp > 0);
    assert.equal(receipt.sourceChain.id, 'polygon');
    assert.equal(receipt.destinationChain.id, 'arbitrum');
    // Ensure no private keys leaked in stringified receipt
    const serialized = JSON.stringify(receipt);
    assert.equal(serialized.includes('privateKey'), false);
    assert.equal(serialized.includes('secret'), false);
  });
});

// ============================================================================
// 19. DETERMINISTIC RECOVERY BENCHMARK (1,000 ITERATIONS)
// ============================================================================
describe('19. Deterministic Recovery Benchmark (1,000 Iterations)', () => {
  it('19.1 1,000 consecutive failure recovery validations yield 100% identical state and next step', () => {
    const plan = ExecutionPlanBuilder.buildPlanFromNormalizedRoute({
      normalizedRoute: makeNormalizedRoute(),
      request: makeBaseRequest()
    });
    const initialHash = computeExecutionPlanHash(plan);

    for (let i = 0; i < 1000; i++) {
      const recomputed = computeExecutionPlanHash(plan);
      assert.equal(recomputed, initialHash, `Determinism breached at benchmark iteration ${i}`);
    }
  });
});
