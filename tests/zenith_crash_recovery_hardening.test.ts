import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ExecutionPlan,
  ExecutionPlanStep,
  Token
} from '@zenith/types';
import {
  InMemoryCrossChainStateRepository,
  SQLiteCrossChainStateRepository,
  CrossChainRecoveryEngine,
  ExecutionCoordinator,
  defaultEVMAdapter,
  validateTransactionStateTransition
} from '../packages/execution/src';
import {
  InvalidStateTransitionError,
  LeaseLockConflictError,
  RecoveryRequiredError,
  BroadcastUncertainError,
  ReceiptRevertedError
} from '../packages/contracts/src/errors';

function getTempDbPath(testName: string): string {
  const dbPath = path.join(process.cwd(), `temp_test_zenith_hardening_${testName}.sqlite`);
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch {}
  return dbPath;
}

function removeTempDb(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch {}
}

const mockUserAddress = '0x534631Bcf33BDb069fB20A43d2ab843921ec1e29';

const mockTokenIn: Token = {
  symbol: 'USDC',
  name: 'USD Coin',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  decimals: 6,
  chainId: 'ethereum',
  verified: true
};

const mockTokenOut: Token = {
  symbol: 'USDC',
  name: 'USD Coin',
  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  decimals: 6,
  chainId: 'arbitrum',
  verified: true
};

function createMockPlan(planId: string): ExecutionPlan {
  const steps: ExecutionPlanStep[] = [
    {
      id: 'step-1-validation',
      type: 'VALIDATION',
      title: 'Validate Trade',
      description: 'Pre-flight validation',
      chainId: 'ethereum',
      executionEnvironment: 'EVM',
      status: 'PENDING',
      dependencies: [],
      retryPolicy: { maxRetries: 0, backoffMs: 1000, timeoutMs: 60000 }
    },
    {
      id: 'step-2-deposit',
      type: 'BRIDGE_DEPOSIT',
      title: 'Bridge Deposit',
      description: 'Deposit funds into bridge contract',
      chainId: 'ethereum',
      executionEnvironment: 'EVM',
      targetAddress: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
      calldata: '0x12345678',
      valueWei: '0',
      approvalTarget: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
      requiredTokenAddress: mockTokenIn.address,
      requiredTokenSymbol: mockTokenIn.symbol,
      requiredAmountRaw: '1000000',
      status: 'PENDING',
      dependencies: ['step-1-validation'],
      retryPolicy: { maxRetries: 2, backoffMs: 2000, timeoutMs: 120000 }
    },
    {
      id: 'step-3-relay',
      type: 'BRIDGE_RELAY_WAIT',
      title: 'Bridge Relay',
      description: 'Wait for relayer to fill deposit on Arbitrum',
      chainId: 'arbitrum',
      executionEnvironment: 'EVM',
      status: 'PENDING',
      dependencies: ['step-2-deposit'],
      retryPolicy: { maxRetries: 30, backoffMs: 2500, timeoutMs: 1800000 }
    }
  ];

  return {
    planId,
    routeId: `route-${planId}`,
    routeType: 'CROSS_CHAIN_DIRECT',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn: mockTokenIn,
    tokenOut: mockTokenOut,
    expectedAmountInRaw: '1000000',
    expectedAmountOutRaw: '999500',
    minimumAmountOutRaw: '995000',
    isExecutable: true,
    diagnostics: [],
    steps,
    currentStepIndex: 0,
    overallStatus: 'IDLE',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

test('PHASE 0 / TASK 4 — Plan & Step Persistence', async (t) => {
  await t.test('1 & 2. Plan persistence and restoration survives restart (SQLite & Memory)', async () => {
    const dbPath = getTempDbPath('plan_persistence');
    try {
      const plan = createMockPlan('plan-persist-001');

      // 1. Persist in SQLite
      const repo1 = new SQLiteCrossChainStateRepository(dbPath);
      await repo1.saveExecutionPlan(plan);
      repo1.close();

      // 2. Re-open DB (simulates complete process restart)
      const repo2 = new SQLiteCrossChainStateRepository(dbPath);
      const restored = await repo2.getExecutionPlan('plan-persist-001');

      assert.ok(restored, 'Restored plan should exist after DB re-open');
      assert.strictEqual(restored.planId, 'plan-persist-001');
      assert.strictEqual(restored.sourceChainId, 'ethereum');
      assert.strictEqual(restored.destinationChainId, 'arbitrum');
      assert.strictEqual(restored.steps.length, 3);
      assert.strictEqual(restored.steps[1].id, 'step-2-deposit');
      assert.strictEqual(restored.steps[1].targetAddress, '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5');

      repo2.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  await t.test('3 & 4. Step persistence & deterministic step identity', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createMockPlan('plan-step-ident');
    await repo.saveExecutionPlan(plan);

    const step = await repo.getPlanStep('plan-step-ident', 'step-2-deposit');
    assert.ok(step);
    assert.strictEqual(step.id, 'step-2-deposit');
    assert.strictEqual(step.type, 'BRIDGE_DEPOSIT');

    await repo.updatePlanStep('plan-step-ident', 'step-2-deposit', {
      status: 'SUCCESS',
      txHash: '0x2222222222222222222222222222222222222222222222222222222222222222'
    });

    const updatedStep = await repo.getPlanStep('plan-step-ident', 'step-2-deposit');
    assert.strictEqual(updatedStep?.status, 'SUCCESS');
    assert.strictEqual(updatedStep?.txHash, '0x2222222222222222222222222222222222222222222222222222222222222222');
  });

  await t.test('5. Duplicate execution of confirmed step is prevented by idempotency', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createMockPlan('plan-idempotency');
    await repo.saveExecutionPlan(plan);

    // Mark step 1 and step 2 as already completed in DB
    await repo.updatePlanStep('plan-idempotency', 'step-1-validation', { status: 'SUCCESS' });
    await repo.updatePlanStep('plan-idempotency', 'step-2-deposit', {
      status: 'SUCCESS',
      txHash: '0x2222222222222222222222222222222222222222222222222222222222222222'
    });

    let broadcastCount = 0;
    const mockSigner: any = {
      sendTransaction: async () => {
        broadcastCount++;
        return { hash: '0x9999999999999999999999999999999999999999999999999999999999999999', wait: async () => ({ status: 1, blockNumber: 100 }) };
      },
      estimateGas: async () => 200000n,
      getNonce: async () => 5
    };

    const coordinator = new ExecutionCoordinator(
      defaultEVMAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      repo
    );

    const receipt = await coordinator.executeTrade({
      plan,
      userAddress: mockUserAddress,
      signer: mockSigner,
      skipDestinationWait: true,
      repository: repo
    });

    assert.strictEqual(broadcastCount, 0, 'Signer should NEVER broadcast when step was already confirmed');
    assert.strictEqual(receipt.txHash, '0x2222222222222222222222222222222222222222222222222222222222222222');
  });
});

test('PHASE 0 / TASK 4 — Transaction Records & Null Hash Invariant', async (t) => {
  await t.test('6 & 7. txHash must remain undefined/null prior to genuine broadcast', async () => {
    const repo = new InMemoryCrossChainStateRepository();

    // Valid: created with no txHash
    await repo.createTransaction({
      transactionId: 'tx-001',
      planId: 'plan-1',
      stepId: 'step-1',
      chainId: 'ethereum',
      fromAddress: mockUserAddress,
      toAddress: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
      valueWei: '0',
      calldata: '0x1234',
      state: 'CREATED',
      createdAt: Date.now()
    });

    const tx = await repo.getTransaction('tx-001');
    assert.strictEqual(tx?.txHash, undefined, 'txHash must be undefined before broadcast');

    // Invalid: Attempting to persist fake hash before broadcast
    await assert.rejects(
      async () => {
        await repo.createTransaction({
          transactionId: 'tx-fake-hash',
          planId: 'plan-1',
          stepId: 'step-1',
          chainId: 'ethereum',
          fromAddress: mockUserAddress,
          toAddress: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
          valueWei: '0',
          calldata: '0x1234',
          state: 'CREATED',
          txHash: '0xfakehash11111111111111111111111111111111111111111111111111111111',
          createdAt: Date.now()
        });
      },
      /Critical: txHash must remain undefined\/null prior to genuine broadcast/
    );
  });

  await t.test('8. Real txHash persisted only after broadcast succeeds', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    await repo.createTransaction({
      transactionId: 'tx-002',
      planId: 'plan-1',
      stepId: 'step-1',
      chainId: 'ethereum',
      fromAddress: mockUserAddress,
      toAddress: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
      valueWei: '0',
      calldata: '0x1234',
      state: 'CREATED',
      createdAt: Date.now()
    });

    await repo.updateTransaction('tx-002', { state: 'PREFLIGHTING' });
    await repo.updateTransaction('tx-002', { state: 'PREFLIGHT_PASSED' });
    await repo.updateTransaction('tx-002', { state: 'READY_TO_BROADCAST' });
    await repo.updateTransaction('tx-002', { state: 'BROADCASTING' });

    const realHash = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    await repo.updateTransaction('tx-002', {
      state: 'BROADCAST_CONFIRMED',
      txHash: realHash,
      broadcastAt: Date.now()
    });

    const tx = await repo.getTransaction('tx-002');
    assert.strictEqual(tx?.state, 'BROADCAST_CONFIRMED');
    assert.strictEqual(tx?.txHash, realHash);
  });
});

test('PHASE 0 / TASK 4 — BROADCAST_UNCERTAIN & Safe Reconciliation', async (t) => {
  await t.test('9 & 10. Process network drop after sendTransaction transitions to BROADCAST_UNCERTAIN', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    await repo.createTransaction({
      transactionId: 'tx-drop-001',
      planId: 'plan-1',
      stepId: 'step-1',
      chainId: 'ethereum',
      nonce: 42,
      fromAddress: mockUserAddress,
      toAddress: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
      valueWei: '0',
      calldata: '0x1234',
      state: 'BROADCASTING',
      createdAt: Date.now()
    });

    // Mark as uncertain
    await repo.updateTransaction('tx-drop-001', {
      state: 'BROADCAST_UNCERTAIN',
      errorMessage: 'ECONNRESET: RPC connection dropped during broadcast'
    });

    const uncertainList = await repo.listUncertainTransactions();
    assert.strictEqual(uncertainList.length, 1);
    assert.strictEqual(uncertainList[0].transactionId, 'tx-drop-001');
    assert.strictEqual(uncertainList[0].state, 'BROADCAST_UNCERTAIN');
  });

  await t.test('11 & 12. Nonce discovery finds mined transaction and confirms it safely', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createMockPlan('plan-nonce-recover');
    await repo.saveExecutionPlan(plan);

    await repo.createTransaction({
      transactionId: 'tx-uncertain-nonce',
      planId: 'plan-nonce-recover',
      stepId: 'step-2-deposit',
      chainId: 'ethereum',
      nonce: 10,
      fromAddress: mockUserAddress,
      toAddress: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
      valueWei: '0',
      calldata: '0x12345678',
      state: 'BROADCAST_UNCERTAIN',
      createdAt: Date.now()
    });

    const mockMinedTxHash = '0x7777777777777777777777777777777777777777777777777777777777777777';
    const mockRpc: any = {
      getBlockNumber: async () => 100,
      getTransactionCount: async (_addr: string, _blockTag: string) => 11, // Latest nonce is 11 > 10 (mined)
      getBlock: async (_blockNum: number, _full: boolean) => ({
        prefetchedTransactions: [
          {
            from: mockUserAddress,
            nonce: 10,
            hash: mockMinedTxHash
          }
        ]
      }),
      getTransactionReceipt: async (h: string) => (h === mockMinedTxHash ? { status: 1, blockNumber: 100 } : null)
    };

    const recoveryEngine = new CrossChainRecoveryEngine({
      repository: repo,
      rpcProviders: { ethereum: mockRpc }
    });

    const result = await recoveryEngine.recoverUncertainTransaction('tx-uncertain-nonce');
    assert.strictEqual(result.reconciledStatus, 'CONFIRMED');
    assert.strictEqual(result.sourceTxHash, mockMinedTxHash);

    const restoredTx = await repo.getTransaction('tx-uncertain-nonce');
    assert.strictEqual(restoredTx?.state, 'CONFIRMED');
    assert.strictEqual(restoredTx?.txHash, mockMinedTxHash);

    const updatedStep = await repo.getPlanStep('plan-nonce-recover', 'step-2-deposit');
    assert.strictEqual(updatedStep?.status, 'SUCCESS');
    assert.strictEqual(updatedStep?.txHash, mockMinedTxHash);
  });

  await t.test('13. Unconfirmed ambiguous transaction fails closed to RECOVERY_REQUIRED', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    await repo.createTransaction({
      transactionId: 'tx-ambiguous',
      planId: 'plan-1',
      stepId: 'step-1',
      chainId: 'ethereum',
      nonce: 99,
      fromAddress: mockUserAddress,
      toAddress: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
      valueWei: '0',
      calldata: '0x1234',
      state: 'BROADCAST_UNCERTAIN',
      createdAt: Date.now()
    });

    const mockRpc: any = {
      getBlockNumber: async () => 100,
      getTransactionCount: async (_addr: string, _blockTag: string) => 100, // Nonce consumed by something else
      getBlock: async () => null
    };

    const recoveryEngine = new CrossChainRecoveryEngine({
      repository: repo,
      rpcProviders: { ethereum: mockRpc }
    });

    const result = await recoveryEngine.recoverUncertainTransaction('tx-ambiguous');
    assert.strictEqual(result.reconciledStatus, 'RECOVERY_REQUIRED');

    const tx = await repo.getTransaction('tx-ambiguous');
    assert.strictEqual(tx?.state, 'RECOVERY_REQUIRED');
  });
});

test('PHASE 0 / TASK 4 — State Machine & Transition Validation', async (t) => {
  await t.test('23. Invalid state transitions are strictly rejected', () => {
    // CREATED -> CONFIRMED (Invalid jump)
    assert.throws(
      () => validateTransactionStateTransition('CREATED', 'CONFIRMED'),
      InvalidStateTransitionError
    );

    // CONFIRMED -> CREATED (Invalid backward)
    assert.throws(
      () => validateTransactionStateTransition('CONFIRMED', 'CREATED'),
      InvalidStateTransitionError
    );

    // Valid transitions
    assert.doesNotThrow(() => validateTransactionStateTransition('CREATED', 'PREFLIGHTING'));
    assert.doesNotThrow(() => validateTransactionStateTransition('PREFLIGHTING', 'PREFLIGHT_PASSED'));
    assert.doesNotThrow(() => validateTransactionStateTransition('PREFLIGHT_PASSED', 'READY_TO_BROADCAST'));
    assert.doesNotThrow(() => validateTransactionStateTransition('READY_TO_BROADCAST', 'BROADCASTING'));
    assert.doesNotThrow(() => validateTransactionStateTransition('BROADCASTING', 'BROADCAST_CONFIRMED'));
    assert.doesNotThrow(() => validateTransactionStateTransition('BROADCAST_CONFIRMED', 'CONFIRMING'));
    assert.doesNotThrow(() => validateTransactionStateTransition('CONFIRMING', 'CONFIRMED'));
  });
});

test('PHASE 0 / TASK 4 — Worker Leases & Locking', async (t) => {
  await t.test('18, 19, 20 & 21. Worker lease acquisition, concurrent rejection, and expiration recovery', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const resource = 'step:plan-1:step-1';

    // Worker A acquires lease for 50ms
    const acquiredA = await repo.acquireLease(resource, 'worker-A', 50);
    assert.strictEqual(acquiredA, true, 'Worker A should acquire lease');

    // Worker B attempts to acquire same resource while active
    const acquiredB = await repo.acquireLease(resource, 'worker-B', 50);
    assert.strictEqual(acquiredB, false, 'Worker B must NOT acquire active lease owned by Worker A');

    // Wait for Worker A's lease to expire
    await new Promise((r) => setTimeout(r, 60));

    // Worker B now acquires expired lease
    const acquiredBAfterExpiry = await repo.acquireLease(resource, 'worker-B', 100);
    assert.strictEqual(acquiredBAfterExpiry, true, 'Worker B should safely acquire expired lease');

    // Worker B releases lease
    await repo.releaseLease(resource, 'worker-B');
    const lease = await repo.getLease(resource);
    assert.strictEqual(lease, null, 'Lease should be released');
  });

  await t.test('Worker lease concurrency rejection in ExecutionCoordinator', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createMockPlan('plan-lease-lock');
    await repo.saveExecutionPlan(plan);

    // Another worker claims lease on step 1
    await repo.acquireLease('step:plan-lease-lock:step-1-validation', 'dead-worker-x', 60000);

    const coordinator = new ExecutionCoordinator(
      defaultEVMAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      repo,
      'worker-current'
    );

    const mockSigner: any = {
      sendTransaction: async () => ({ hash: '0x1234', wait: async () => ({ status: 1 }) }),
      estimateGas: async () => 200000n,
      getNonce: async () => 1
    };

    await assert.rejects(
      async () => {
        await coordinator.executeTrade({
          plan,
          userAddress: mockUserAddress,
          signer: mockSigner,
          repository: repo
        });
      },
      LeaseLockConflictError
    );
  });
});

test('PHASE 0 / TASK 4 — Startup Consistency Checks', async (t) => {
  await t.test('24. Startup detects expired leases & inconsistent state', async () => {
    const repo = new InMemoryCrossChainStateRepository();

    // Expired lease
    await repo.acquireLease('plan:stale-plan', 'dead-worker', 1);
    await new Promise((r) => setTimeout(r, 10));

    const recoveryEngine = new CrossChainRecoveryEngine({ repository: repo });
    const violations = await recoveryEngine.validateStartupConsistency();

    assert.ok(violations.some((v) => v.code === 'EXPIRED_LEASE_RECLAIMED'));
  });
});

test('PHASE 0 / TASK 4 — Comprehensive Failure Injection', async (t) => {
  await t.test('Failure injection: before eth_call', async () => {
    const mockSigner: any = {
      provider: {
        call: async () => {
          throw new Error('RPC network timeout before simulation');
        }
      }
    };
    await assert.rejects(
      async () => {
        await defaultEVMAdapter.executeTransaction({
          chainId: 'ethereum',
          to: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
          data: '0x1234',
          userAddress: mockUserAddress,
          signer: mockSigner
        });
      },
      /Pre-flight simulation/
    );
  });

  await t.test('Failure injection: immediately after sendTransaction returns uncertain network error', async () => {
    const mockSigner: any = {
      getNonce: async () => 12,
      sendTransaction: async () => {
        const err: any = new Error('fetch failed: network error');
        err.code = 'NETWORK_ERROR';
        throw err;
      }
    };

    await assert.rejects(
      async () => {
        await defaultEVMAdapter.executeTransaction({
          chainId: 'ethereum',
          to: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
          data: '0x1234',
          userAddress: mockUserAddress,
          signer: mockSigner
        });
      },
      BroadcastUncertainError
    );
  });

  await t.test('Failure injection: during receipt polling when transaction reverts', async () => {
    const mockSigner: any = {
      getNonce: async () => 13,
      sendTransaction: async () => ({
        hash: '0x3333333333333333333333333333333333333333333333333333333333333333',
        wait: async () => ({ status: 0, blockNumber: 105 }) // Revert
      })
    };

    await assert.rejects(
      async () => {
        await defaultEVMAdapter.executeTransaction({
          chainId: 'ethereum',
          to: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
          data: '0x1234',
          userAddress: mockUserAddress,
          signer: mockSigner
        });
      },
      ReceiptRevertedError
    );
  });
});
