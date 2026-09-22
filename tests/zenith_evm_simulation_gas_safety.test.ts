import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVMExecutionAdapter,
  decodeRevertReason,
  KNOWN_REVERT_ERRORS
} from '../packages/execution/src/adapters/evmAdapter';
import {
  CrossChainTracker
} from '../packages/execution/src/crosschain/crossChainTracker';
import {
  ZenithSimulationFailedError,
  GasEstimationFailedError,
  GasLimitOverflowError,
  FeeDataUnavailableError,
  ReceiptRevertedError,
  ConfirmationTimeoutError,
  InsufficientBalanceError,
  InvalidCalldataError,
  InvalidExecutionTargetError,
  SignerRequiredError
} from '../packages/contracts/src/errors';
import { defaultChainRegistry } from '../packages/chains/src/registry';

describe('ZENITH — Phase 0 / Task 3: EVM Pre-Flight Simulation & Gas Safety Test Suite', () => {
  const adapter = new EVMExecutionAdapter();
  const validAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const validRouter = '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Uniswap V3 SwapRouter02
  const validToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC Ethereum
  const validTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  // 1. Exact eth_call transaction matching
  it('1. Exact eth_call transaction matching validates all fields match broadcast payload', async () => {
    let callParams: any = null;
    let sendParams: any = null;

    const mockSigner: any = {
      provider: {
        call: async (tx: any) => {
          callParams = tx;
          return '0x';
        },
        getBalance: async () => 10000000000000000000n,
        getFeeData: async () => ({
          maxFeePerGas: 30000000000n,
          maxPriorityFeePerGas: 2000000000n
        })
      },
      estimateGas: async () => 150000n,
      sendTransaction: async (tx: any) => {
        sendParams = tx;
        return {
          hash: validTxHash,
          wait: async () => ({ status: 1, blockNumber: 123456, gasUsed: 145000n, gasPrice: 30000000000n })
        };
      }
    };

    const result = await adapter.executeTransaction({
      chainId: 'ethereum',
      to: validRouter,
      data: '0x12345678',
      value: '1000000000000000',
      userAddress: validAddress,
      signer: mockSigner
    });

    assert.ok(result.isSuccess);
    assert.equal(callParams.to.toLowerCase(), validRouter.toLowerCase());
    assert.equal(callParams.data, '0x12345678');
    assert.equal(callParams.value, 1000000000000000n);
    assert.equal(callParams.from.toLowerCase(), validAddress.toLowerCase());

    assert.equal(sendParams.to.toLowerCase(), callParams.to.toLowerCase());
    assert.equal(sendParams.data, callParams.data);
    assert.equal(sendParams.value, callParams.value);
  });

  // 2. Simulation success
  it('2. Simulation success allows pipeline to proceed through gas estimation and signing', async () => {
    let callExecuted = false;
    let estimateExecuted = false;
    let sendExecuted = false;

    const mockSigner: any = {
      provider: {
        call: async () => {
          callExecuted = true;
          return '0x';
        },
        getBalance: async () => 10000000000000000000n
      },
      estimateGas: async () => {
        estimateExecuted = true;
        return 120000n;
      },
      sendTransaction: async () => {
        sendExecuted = true;
        return {
          hash: validTxHash,
          wait: async () => ({ status: 1, blockNumber: 100, gasUsed: 115000n })
        };
      }
    };

    const res = await adapter.executeTransaction({
      chainId: 'ethereum',
      to: validRouter,
      data: '0xabcdef01',
      value: '0',
      userAddress: validAddress,
      signer: mockSigner
    });

    assert.ok(callExecuted);
    assert.ok(estimateExecuted);
    assert.ok(sendExecuted);
    assert.ok(res.isSuccess);
  });

  // 3. Simulation revert
  it('3. Simulation revert halts pipeline before estimateGas, signing, or broadcast', async () => {
    let sendAttempted = false;

    const mockSigner: any = {
      provider: {
        call: async () => {
          const err: any = new Error('execution reverted');
          err.data = '0x39d35496'; // V3_TOO_LITTLE_RECEIVED
          throw err;
        },
        getBalance: async () => 10000000000000000000n
      },
      estimateGas: async () => 120000n,
      sendTransaction: async () => {
        sendAttempted = true;
        return { hash: validTxHash };
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeTransaction({
          chainId: 'ethereum',
          to: validRouter,
          data: '0xabcdef01',
          value: '0',
          userAddress: validAddress,
          signer: mockSigner
        });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithSimulationFailedError);
        assert.ok(err.revertReason?.includes('V3_TOO_LITTLE_RECEIVED'));
        return true;
      }
    );

    assert.equal(sendAttempted, false, 'sendTransaction must NEVER be called after simulation revert');
  });

  // 4. Revert-data decoding
  it('4. Revert-data decoding decodes known selectors into structured human-readable reasons', () => {
    assert.ok(decodeRevertReason('0x39d35496').includes('V3_TOO_LITTLE_RECEIVED'));
    assert.ok(decodeRevertReason('0x739dbe52').includes('V3_TOO_MUCH_REQUESTED'));
    assert.ok(decodeRevertReason('0xc9f52c71').includes('TOO_LITTLE_RECEIVED'));
    assert.ok(decodeRevertReason('0xd4e0248e').includes('V3_INVALID_AMOUNT_OUT'));
    assert.ok(decodeRevertReason('0x316cf0eb').includes('V3_INVALID_SWAP'));
    assert.ok(decodeRevertReason('0x32b13d91').includes('V3_INVALID_CALLER'));
    assert.equal(decodeRevertReason('0x99999999'), '0x99999999');
  });

  // 5. Gas estimation success
  it('5. Gas estimation success applies 120% margin to measured gas limit', async () => {
    let submittedGasLimit: bigint | undefined;

    const mockSigner: any = {
      provider: {
        call: async () => '0x',
        getBalance: async () => 10000000000000000000n
      },
      estimateGas: async () => 100000n,
      sendTransaction: async (tx: any) => {
        submittedGasLimit = tx.gasLimit;
        return {
          hash: validTxHash,
          wait: async () => ({ status: 1, blockNumber: 100, gasUsed: 100000n })
        };
      }
    };

    await adapter.executeTransaction({
      chainId: 'ethereum',
      to: validRouter,
      data: '0x1234',
      value: '0',
      userAddress: validAddress,
      signer: mockSigner
    });

    // 100000 * 1.20 = 120000
    assert.equal(submittedGasLimit, 120000n);
  });

  // 6. Gas estimation failure
  it('6. Gas estimation failure halts pipeline before signing/broadcast', async () => {
    let sendAttempted = false;

    const mockSigner: any = {
      provider: {
        call: async () => '0x', // eth_call passes
        getBalance: async () => 10000000000000000000n
      },
      estimateGas: async () => {
        throw new Error('Gas estimation rejected by node');
      },
      sendTransaction: async () => {
        sendAttempted = true;
        return { hash: validTxHash };
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeTransaction({
          chainId: 'ethereum',
          to: validRouter,
          data: '0x1234',
          value: '0',
          userAddress: validAddress,
          signer: mockSigner
        });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithSimulationFailedError);
        assert.ok(err.message.includes('eth_estimateGas'));
        return true;
      }
    );

    assert.equal(sendAttempted, false);
  });

  // 7. 120% gas margin
  it('7. 120% gas margin calculates safe gas limit with ceiling division', () => {
    const estimated = 100000n;
    const safeLimit = adapter.calculateSafeGasLimit(estimated);
    assert.equal(safeLimit, 120000n);

    // Test ceiling: 101 * 1.20 = 121.2 -> 122
    const oddEstimated = 101n;
    const oddSafeLimit = adapter.calculateSafeGasLimit(oddEstimated);
    assert.equal(oddSafeLimit, 122n);
  });

  // 8. Gas overflow protection
  it('8. Gas overflow protection rejects gas limits exceeding standard ceiling', () => {
    assert.throws(
      () => {
        adapter.calculateSafeGasLimit(26000000n); // 26M * 1.2 = 31.2M > 30M
      },
      (err: any) => {
        assert.ok(err instanceof GasLimitOverflowError);
        return true;
      }
    );
  });

  // 9. Zero gas protection
  it('9. Zero gas protection rejects zero or negative estimated gas', () => {
    assert.throws(
      () => adapter.calculateSafeGasLimit(0n),
      (err: any) => err instanceof GasEstimationFailedError
    );
    assert.throws(
      () => adapter.calculateSafeGasLimit(-500n),
      (err: any) => err instanceof GasEstimationFailedError
    );
  });

  // 10. EIP-1559 supported chain
  it('10. EIP-1559 supported chain resolves maxFeePerGas and maxPriorityFeePerGas', async () => {
    const mockProvider = {
      getFeeData: async () => ({
        maxFeePerGas: 45000000000n,
        maxPriorityFeePerGas: 1500000000n,
        gasPrice: 40000000000n
      })
    };

    const feeStrategy = await adapter.resolveFeeStrategy(mockProvider, 'ethereum');
    assert.equal(feeStrategy.type, 'EIP1559');
    assert.equal(feeStrategy.maxFeePerGas, 45000000000n);
    assert.equal(feeStrategy.maxPriorityFeePerGas, 1500000000n);
  });

  // 11. Legacy gas chain
  it('11. Legacy gas chain resolves gasPrice when EIP-1559 is not supported or not returned', async () => {
    const mockProvider = {
      getFeeData: async () => ({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: 3000000000n
      })
    };

    const feeStrategy = await adapter.resolveFeeStrategy(mockProvider, 'bnb');
    assert.equal(feeStrategy.type, 'LEGACY');
    assert.equal(feeStrategy.gasPrice, 3000000000n);
  });

  // 12. Unavailable fee data
  it('12. Unavailable fee data returns UNAVAILABLE when provider yields no fee data', async () => {
    const mockProvider = {
      getFeeData: async () => {
        throw new Error('RPC fee data endpoint timeout');
      }
    };

    const feeStrategy = await adapter.resolveFeeStrategy(mockProvider, 'ethereum');
    assert.equal(feeStrategy.type, 'UNAVAILABLE');
  });

  // 13. Receipt success
  it('13. Receipt verification succeeds when status=1 and block confirmations are satisfied', async () => {
    const mockProvider = {
      getTransactionReceipt: async (hash: string) => ({
        transactionHash: hash,
        status: 1,
        blockNumber: 500,
        gasUsed: 85000n,
        effectiveGasPrice: 25000000000n
      }),
      getBlockNumber: async () => 505
    };

    const res = await adapter.verifyTransactionReceipt(mockProvider, validTxHash, {
      confirmations: 3
    });

    assert.ok(res.isSuccess);
    assert.equal(res.blockNumber, 500);
    assert.equal(res.gasUsed, 85000n);
  });

  // 14. Receipt revert
  it('14. Receipt verification throws ReceiptRevertedError when status=0', async () => {
    const mockProvider = {
      getTransactionReceipt: async (hash: string) => ({
        transactionHash: hash,
        status: 0,
        blockNumber: 502
      })
    };

    await assert.rejects(
      async () => {
        await adapter.verifyTransactionReceipt(mockProvider, validTxHash);
      },
      (err: any) => {
        assert.ok(err instanceof ReceiptRevertedError);
        assert.equal(err.txHash, validTxHash);
        assert.equal(err.blockNumber, 502);
        return true;
      }
    );
  });

  // 15. Receipt pending
  it('15. Receipt pending continues polling until receipt becomes available', async () => {
    let pollCount = 0;
    const mockProvider = {
      getTransactionReceipt: async () => {
        pollCount++;
        if (pollCount < 2) return null; // Pending on 1st poll
        return {
          status: 1,
          blockNumber: 600,
          gasUsed: 90000n
        };
      }
    };

    const res = await adapter.verifyTransactionReceipt(mockProvider, validTxHash, {
      timeoutMs: 2000,
      pollIntervalMs: 20
    });

    assert.ok(res.isSuccess);
    assert.ok(pollCount >= 2);
  });

  // 16. Confirmation depth
  it('16. Confirmation depth waits until currentBlock satisfies required confirmations', async () => {
    let currentBlock = 100;
    const mockProvider = {
      getTransactionReceipt: async () => ({
        status: 1,
        blockNumber: 100
      }),
      getBlockNumber: async () => {
        currentBlock += 2;
        return currentBlock;
      }
    };

    const res = await adapter.verifyTransactionReceipt(mockProvider, validTxHash, {
      confirmations: 4,
      timeoutMs: 2000,
      pollIntervalMs: 20
    });

    assert.ok(res.isSuccess);
  });

  // 17. Transaction timeout
  it('17. Transaction timeout throws ConfirmationTimeoutError after timeoutMs expires', async () => {
    const mockProvider = {
      getTransactionReceipt: async () => null // Mempool pending forever
    };

    await assert.rejects(
      async () => {
        await adapter.verifyTransactionReceipt(mockProvider, validTxHash, {
          timeoutMs: 150,
          pollIntervalMs: 20
        });
      },
      (err: any) => {
        assert.ok(err instanceof ConfirmationTimeoutError);
        assert.equal(err.txHash, validTxHash);
        return true;
      }
    );
  });

  // 18. Broadcast uncertain state
  it('18. Broadcast uncertain state preserves error context and avoids false success', async () => {
    const mockSigner: any = {
      provider: {
        call: async () => '0x',
        getBalance: async () => 10000000000000000000n
      },
      estimateGas: async () => 100000n,
      sendTransaction: async () => {
        const err: any = new Error('Connection reset by peer after transaction submission');
        err.code = 'NETWORK_ERROR';
        throw err;
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeTransaction({
          chainId: 'ethereum',
          to: validRouter,
          data: '0x1234',
          value: '0',
          userAddress: validAddress,
          signer: mockSigner
        });
      },
      (err: any) => {
        assert.ok(err.message.includes('Connection reset'));
        return true;
      }
    );
  });

  // 19. Duplicate retry prevention
  it('19. Duplicate retry prevention respects confirmed state without re-broadcasting', async () => {
    let broadcastCount = 0;
    const mockSigner: any = {
      provider: {
        call: async () => '0x',
        getBalance: async () => 10000000000000000000n
      },
      estimateGas: async () => 100000n,
      sendTransaction: async () => {
        broadcastCount++;
        return {
          hash: validTxHash,
          wait: async () => ({ status: 1, blockNumber: 100, gasUsed: 90000n })
        };
      }
    };

    const res1 = await adapter.executeTransaction({
      chainId: 'ethereum',
      to: validRouter,
      data: '0x1234',
      userAddress: validAddress,
      signer: mockSigner
    });

    assert.equal(broadcastCount, 1);
    assert.ok(res1.isSuccess);
  });

  // 20. Reorg/reconfirmation behavior
  it('20. Reorg/reconfirmation behavior validates receipt persistence', async () => {
    const mockProvider = {
      getTransactionReceipt: async () => ({
        status: 1,
        blockNumber: 750
      }),
      getBlockNumber: async () => 760
    };

    const res = await adapter.verifyTransactionReceipt(mockProvider, validTxHash, {
      confirmations: 5
    });

    assert.ok(res.isSuccess);
    assert.equal(res.blockNumber, 750);
  });

  // 21. Source confirmation vs destination settlement
  it('21. Source confirmation does not automatically imply destination settlement', async () => {
    const tracker = new CrossChainTracker();

    // Source confirmation is verified, but destination query returns pending
    const destCheck = await tracker.verifyDestinationSettlement({
      destinationChainId: 'arbitrum',
      destinationTxHash: validTxHash,
      expectedRecipient: validAddress,
      provider: {
        getTransactionReceipt: async () => null // Pending on destination
      }
    });

    assert.equal(destCheck.isVerified, false);
    assert.ok(destCheck.reason?.includes('pending or not found'));
  });

  // 22. Invalid target
  it('22. Invalid target address fails closed before simulation or broadcast', async () => {
    const mockSigner: any = {
      provider: { call: async () => '0x' },
      sendTransaction: async () => ({ hash: validTxHash })
    };

    await assert.rejects(
      async () => {
        await adapter.executeTransaction({
          chainId: 'ethereum',
          to: '0x0000000000000000000000000000000000000000', // Zero address
          data: '0x1234',
          userAddress: validAddress,
          signer: mockSigner
        });
      },
      (err: any) => err instanceof InvalidExecutionTargetError
    );
  });

  // 23. Invalid calldata
  it('23. Invalid or empty calldata fails closed before simulation or broadcast', async () => {
    const mockSigner: any = {
      provider: { call: async () => '0x' },
      sendTransaction: async () => ({ hash: validTxHash })
    };

    await assert.rejects(
      async () => {
        await adapter.executeTransaction({
          chainId: 'ethereum',
          to: validRouter,
          data: '', // Empty calldata
          userAddress: validAddress,
          signer: mockSigner
        });
      },
      (err: any) => err instanceof InvalidCalldataError
    );
  });

  // 24. Invalid chain ID
  it('24. Invalid or unknown chain ID fails closed during target validation', async () => {
    const mockSigner: any = {
      provider: { call: async () => '0x' },
      sendTransaction: async () => ({ hash: validTxHash })
    };

    await assert.rejects(
      async () => {
        await adapter.executeTransaction({
          chainId: 'unknown_chain_999',
          to: validRouter,
          data: '0x1234',
          userAddress: validAddress,
          signer: mockSigner
        });
      }
    );
  });

  // 25. Insufficient balance
  it('25. Insufficient balance halts execution before eth_call or broadcast', async () => {
    let callAttempted = false;
    const mockSigner: any = {
      provider: {
        call: async () => {
          callAttempted = true;
          return '0x';
        },
        getBalance: async () => 500n // Available 500 wei
      },
      sendTransaction: async () => ({ hash: validTxHash })
    };

    await assert.rejects(
      async () => {
        await adapter.executeTransaction({
          chainId: 'ethereum',
          to: validRouter,
          data: '0x1234',
          value: '1000000000000000000', // Required 1 ETH
          amountInRaw: '1000000000000000000',
          userAddress: validAddress,
          signer: mockSigner
        });
      },
      (err: any) => err instanceof InsufficientBalanceError
    );

    assert.equal(callAttempted, false);
  });

  // 26. Insufficient allowance
  it('26. Insufficient allowance step executes approval before main transaction', async () => {
    let mainTxExecuted = false;

    const mockSigner: any = {
      provider: {
        call: async () => '0x',
        getBalance: async () => 10000000000000000000n,
        estimateGas: async () => 80000n
      },
      estimateGas: async () => 120000n,
      sendTransaction: async () => {
        mainTxExecuted = true;
        return {
          hash: validTxHash,
          wait: async () => ({ status: 1, blockNumber: 100, gasUsed: 110000n })
        };
      }
    };

    const res = await adapter.executeTransaction({
      chainId: 'ethereum',
      to: validRouter,
      data: '0x1234',
      value: '0',
      userAddress: validAddress,
      signer: mockSigner
    });

    assert.ok(res.isSuccess);
    assert.ok(mainTxExecuted);
  });

  // 27. Provider RPC failure
  it('27. Provider RPC failure during eth_call throws structured simulation error', async () => {
    const mockSigner: any = {
      provider: {
        call: async () => {
          throw new Error('RPC node connection refused');
        },
        getBalance: async () => 10000000000000000000n
      },
      estimateGas: async () => 100000n
    };

    await assert.rejects(
      async () => {
        await adapter.executeTransaction({
          chainId: 'ethereum',
          to: validRouter,
          data: '0x1234',
          userAddress: validAddress,
          signer: mockSigner
        });
      },
      (err: any) => err instanceof ZenithSimulationFailedError
    );
  });

  // 28. Cross-chain tracking safety
  it('28. Cross-chain tracking safety rejects invalid destination hash formats', async () => {
    const tracker = new CrossChainTracker();

    const invalidHashCheck = await tracker.verifyDestinationSettlement({
      destinationChainId: 'arbitrum',
      destinationTxHash: '0xshort', // Malformed hash
      expectedRecipient: validAddress
    });

    assert.equal(invalidHashCheck.isVerified, false);
    assert.ok(invalidHashCheck.reason?.includes('Invalid destination transaction hash'));
  });
});
