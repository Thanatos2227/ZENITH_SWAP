import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ExecutionCoordinator,
  CrossChainTracker,
  EVMExecutionAdapter,
  ExecutionStateMachine,
  ActiveCrossChainOrder,
  ExecutionPlanBuilder
} from '../packages/execution/src';
import {
  CrossChainAggregator,
  AcrossProvider,
  DeBridgeProvider,
  StargateProvider,
  defaultAcrossProvider,
  defaultDeBridgeProvider,
  defaultStargateProvider
} from '../packages/routing/src';
import { defaultTokenService, DEFAULT_TOKENS } from '../packages/tokens/src';
import { defaultChainRegistry } from '../packages/chains/src';
import {
  SignerRequiredError,
  ZenithSimulationFailedError,
  InsufficientBalanceError,
  InvalidExecutionTargetError,
  InvalidTokenAddressError,
  ProviderUnavailableError,
  ExecutionUnavailableError,
  ACROSS_SPOKE_POOLS,
  DEBRIDGE_DLN_SOURCE,
  STARGATE_V2_ROUTERS
} from '../packages/contracts/src';
import { QuoteResponse, CrossChainQuote, SwapRoute } from '../packages/types/src';

const USER_ADDR = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const RECIPIENT_ADDR = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

test('A. Valid direct cross-chain route generates plan: Validation -> Approval -> Bridge Deposit', async () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const directQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000', // 1,000 USDC (6 decimals)
    destinationAmountRaw: '999500000',
    minDestinationAmountRaw: '994502500',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-eth-arb',
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+',
    isExecutable: true
  };

  const route: SwapRoute = {
    id: 'route-direct-across',
    routeType: 'CROSS_CHAIN',
    hops: [],
    gasCostUSD: 5,
    crossChainQuote: directQuote,
    isExecutable: true
  };

  const plan = ExecutionPlanBuilder.buildPlan({
    route,
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR
    }
  });

  assert.equal(plan.isExecutable, true);
  assert.equal(plan.routeType, 'CROSS_CHAIN_DIRECT');
  assert.equal(plan.steps.length, 6);
  assert.equal(plan.steps[0].type, 'VALIDATION');
  assert.equal(plan.steps[1].type, 'APPROVAL');
  assert.equal(plan.steps[1].targetAddress, usdcEth.address);
  assert.equal(plan.steps[1].approvalTarget, ACROSS_SPOKE_POOLS[1]);
  assert.equal(plan.steps[2].type, 'BRIDGE_DEPOSIT');
  assert.equal(plan.steps[2].targetAddress, ACROSS_SPOKE_POOLS[1]);
  assert.equal(plan.steps[3].type, 'BRIDGE_RELAY_WAIT');
  assert.equal(plan.steps[4].type, 'DESTINATION_VERIFY');
  assert.equal(plan.steps[5].type, 'SETTLEMENT_COMPLETE');
});

test('B. Provider quote failure rejects execution without synthetic bypass', async () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const failedQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '999500000',
    minDestinationAmountRaw: '994502500',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-eth-arb',
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+',
    isExecutable: false,
    unexecutableReason: 'PROVIDER_UNAVAILABLE'
  };

  await assert.rejects(
    async () => {
      await defaultAcrossProvider.buildExecution(failedQuote, USER_ADDR);
    },
    (err: any) => {
      assert.ok(err instanceof ProviderUnavailableError || err.message.includes('PROVIDER_UNAVAILABLE'));
      return true;
    }
  );
});

test('C. Invalid bridge target contract is strictly rejected during adapter execution', async () => {
  const adapter = new EVMExecutionAdapter();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const fakeTarget = '0x1234567890123456789012345678901234567890';
  const invalidQuoteResponse: any = {
    requestId: 'req-invalid-target',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR
    },
    amountInRaw: '1000000000',
    amountOutRaw: '999500000',
    minimumReceivedRaw: '994502500',
    amountInFormatted: '1000',
    amountOutFormatted: '999.5',
    priceImpact: { percentage: 0 },
    protocolFee: { feeUSD: 0 },
    bestRoute: {
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 5,
      crossChainQuote: {
        provider: 'ACROSS',
        providerName: 'Across Protocol V3',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        sourceToken: usdcEth,
        destinationToken: usdcArb,
        sourceAmountRaw: '1000000000',
        destinationAmountRaw: '999500000',
        minDestinationAmountRaw: '994502500',
        bridgeFeeUSD: 0.5,
        relayerFee: '0.05%',
        gasEstimateUSD: 5,
        recipient: USER_ADDR,
        executionTarget: fakeTarget, // INVALID TARGET!
        calldata: '0x1234',
        value: '0',
        approvalTarget: fakeTarget,
        quoteTimestamp: Date.now(),
        isExecutable: true
      },
      execution: {
        to: fakeTarget,
        data: '0x1234',
        value: '0',
        approvalTarget: fakeTarget,
        requiredAllowanceRaw: '1000000000'
      }
    }
  };

  const mockSigner = {
    getAddress: async () => USER_ADDR,
    provider: {
      call: async () => '0x'
    }
  };

  await assert.rejects(
    async () => {
      await adapter.executeSwap({
        quote: invalidQuoteResponse,
        userAddress: USER_ADDR,
        signer: mockSigner as any
      });
    },
    (err: any) => {
      assert.ok(err instanceof InvalidExecutionTargetError);
      return true;
    }
  );
});

test('D. Invalid token address fails token validation closed', () => {
  assert.throws(() => {
    ExecutionPlanBuilder.buildPlan({
      route: {
        id: 'route-invalid-token',
        routeType: 'DIRECT',
        hops: [],
        gasCostUSD: 1
      },
      request: {
        sourceChainId: 'ethereum',
        destinationChainId: 'ethereum',
        tokenIn: {
          address: 'invalid-address-format',
          chainId: 'ethereum',
          name: 'Fake Token',
          symbol: 'FAKE',
          decimals: 18
        },
        tokenOut: DEFAULT_TOKENS[0],
        amountInRaw: '1000000000000000000'
      }
    });
  }, /Invalid EVM address format/);
});

test('E. Insufficient balance throws InsufficientBalanceError before simulation', async () => {
  const adapter = new EVMExecutionAdapter();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quoteResponse: any = {
    requestId: 'req-bal',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      amountInRaw: '1000000000', // 1,000 USDC
      userWalletAddress: USER_ADDR
    },
    amountInRaw: '1000000000',
    amountOutRaw: '999500000',
    minimumReceivedRaw: '994502500',
    amountInFormatted: '1000',
    amountOutFormatted: '999.5',
    priceImpact: { percentage: 0 },
    protocolFee: { feeUSD: 0 },
    bestRoute: {
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 5,
      crossChainQuote: {
        provider: 'ACROSS',
        providerName: 'Across Protocol V3',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        sourceToken: usdcEth,
        destinationToken: usdcArb,
        sourceAmountRaw: '1000000000',
        destinationAmountRaw: '999500000',
        minDestinationAmountRaw: '994502500',
        bridgeFeeUSD: 0.5,
        relayerFee: '0.05%',
        gasEstimateUSD: 5,
        recipient: USER_ADDR,
        executionTarget: ACROSS_SPOKE_POOLS[1],
        calldata: '0x1234',
        value: '0',
        approvalTarget: ACROSS_SPOKE_POOLS[1],
        quoteTimestamp: Date.now(),
        isExecutable: true
      },
      execution: {
        to: ACROSS_SPOKE_POOLS[1],
        data: '0x1234',
        value: '0',
        approvalTarget: ACROSS_SPOKE_POOLS[1],
        requiredAllowanceRaw: '1000000000'
      }
    }
  };

  // Signer returns balanceOf = 50 USDC (50_000_000 raw), less than 1,000 USDC required
  const mockSigner = {
    getAddress: async () => USER_ADDR,
    provider: {
      call: async (tx: any) => {
        // balanceOf call returns 50 USDC
        return '0x0000000000000000000000000000000000000000000000000000000002faf080';
      }
    }
  };

  await assert.rejects(
    async () => {
      await adapter.executeSwap({
        quote: quoteResponse,
        userAddress: USER_ADDR,
        signer: mockSigner as any
      });
    },
    (err: any) => {
      assert.ok(err instanceof InsufficientBalanceError || err.message.includes('Insufficient balance'));
      return true;
    }
  );
});

test('F. Insufficient allowance triggers approve() transaction and verifies receipt', async () => {
  const adapter = new EVMExecutionAdapter();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quoteResponse: any = {
    requestId: 'req-allow',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR
    },
    amountInRaw: '1000000000',
    amountOutRaw: '999500000',
    minimumReceivedRaw: '994502500',
    amountInFormatted: '1000',
    amountOutFormatted: '999.5',
    priceImpact: { percentage: 0 },
    protocolFee: { feeUSD: 0 },
    bestRoute: {
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 5,
      crossChainQuote: {
        provider: 'ACROSS',
        providerName: 'Across Protocol V3',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        sourceToken: usdcEth,
        destinationToken: usdcArb,
        sourceAmountRaw: '1000000000',
        destinationAmountRaw: '999500000',
        minDestinationAmountRaw: '994502500',
        bridgeFeeUSD: 0.5,
        relayerFee: '0.05%',
        gasEstimateUSD: 5,
        recipient: USER_ADDR,
        executionTarget: ACROSS_SPOKE_POOLS[1],
        calldata: '0x1234',
        value: '0',
        approvalTarget: ACROSS_SPOKE_POOLS[1],
        quoteTimestamp: Date.now(),
        isExecutable: true
      },
      execution: {
        to: ACROSS_SPOKE_POOLS[1],
        data: '0x1234',
        value: '0',
        approvalTarget: ACROSS_SPOKE_POOLS[1],
        requiredAllowanceRaw: '1000000000'
      }
    }
  };

  let allowanceCheckCount = 0;
  let approvedBroadcasted = false;

  const mockSigner = {
    getAddress: async () => USER_ADDR,
    estimateGas: async () => 150000n,
    sendTransaction: async (tx: any) => {
      approvedBroadcasted = true;
      return {
        hash: '0xapprove1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        wait: async () => ({ status: 1, blockNumber: 100, logs: [] })
      };
    },
    provider: {
      call: async () => {
        allowanceCheckCount++;
        // 1st call: balanceOf = 2,000 USDC
        // 2nd call: allowance = 0
        // 3rd call: verified allowance = 1,000 USDC
        if (allowanceCheckCount === 1) {
          return '0x0000000000000000000000000000000000000000000000000000000077359400';
        }
        if (allowanceCheckCount === 2) {
          return '0x0000000000000000000000000000000000000000000000000000000000000000';
        }
        return '0x000000000000000000000000000000000000000000000000000000003b9aca00';
      },
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 100, logs: [] })
    }
  };

  const statuses: string[] = [];
  const res = await adapter.executeSwap({
    quote: quoteResponse,
    userAddress: USER_ADDR,
    signer: mockSigner as any,
    onStatusChange: (s) => statuses.push(s)
  });

  assert.ok(approvedBroadcasted, 'Approve transaction must be broadcasted');
  assert.ok(statuses.includes('APPROVING'), 'APPROVING status emitted');
  assert.ok(statuses.includes('APPROVED'), 'APPROVED status emitted');
  assert.equal(res.isSuccess, true);
});

test('G. eth_call simulation revert prevents transaction dispatch', async () => {
  const adapter = new EVMExecutionAdapter();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quoteResponse: any = {
    requestId: 'req-sim-revert',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR
    },
    amountInRaw: '1000000000',
    amountOutRaw: '999500000',
    minimumReceivedRaw: '994502500',
    amountInFormatted: '1000',
    amountOutFormatted: '999.5',
    priceImpact: { percentage: 0 },
    protocolFee: { feeUSD: 0 },
    bestRoute: {
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 5,
      crossChainQuote: {
        provider: 'ACROSS',
        providerName: 'Across Protocol V3',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        sourceToken: usdcEth,
        destinationToken: usdcArb,
        sourceAmountRaw: '1000000000',
        destinationAmountRaw: '999500000',
        minDestinationAmountRaw: '994502500',
        bridgeFeeUSD: 0.5,
        relayerFee: '0.05%',
        gasEstimateUSD: 5,
        recipient: USER_ADDR,
        executionTarget: ACROSS_SPOKE_POOLS[1],
        calldata: '0x1234',
        value: '0',
        approvalTarget: ACROSS_SPOKE_POOLS[1],
        quoteTimestamp: Date.now(),
        isExecutable: true
      },
      execution: {
        to: ACROSS_SPOKE_POOLS[1],
        data: '0x1234',
        value: '0',
        approvalTarget: ACROSS_SPOKE_POOLS[1],
        requiredAllowanceRaw: '1000000000'
      }
    }
  };

  let txSent = false;
  const mockSigner = {
    getAddress: async () => USER_ADDR,
    sendTransaction: async () => {
      txSent = true;
      return { hash: '0xsent' };
    },
    provider: {
      call: async (tx: any) => {
        // If it's the main execution simulation call, simulate revert
        if (tx.to?.toLowerCase() === ACROSS_SPOKE_POOLS[1].toLowerCase()) {
          throw new Error('execution reverted: SpokePool: fill deadline passed');
        }
        // Balance & allowance calls
        return '0x000000000000000000000000000000000000000000000000000000003b9aca00';
      }
    }
  };

  await assert.rejects(
    async () => {
      await adapter.executeSwap({
        quote: quoteResponse,
        userAddress: USER_ADDR,
        signer: mockSigner as any
      });
    },
    (err: any) => {
      assert.ok(err instanceof ZenithSimulationFailedError);
      return true;
    }
  );

  assert.equal(txSent, false, 'Transaction must NOT be dispatched when eth_call reverts');
});

test('H. eth_estimateGas failure prevents transaction dispatch', async () => {
  const adapter = new EVMExecutionAdapter();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quoteResponse: any = {
    requestId: 'req-gas-fail',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR
    },
    amountInRaw: '1000000000',
    amountOutRaw: '999500000',
    minimumReceivedRaw: '994502500',
    amountInFormatted: '1000',
    amountOutFormatted: '999.5',
    priceImpact: { percentage: 0 },
    protocolFee: { feeUSD: 0 },
    bestRoute: {
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 5,
      crossChainQuote: {
        provider: 'ACROSS',
        providerName: 'Across Protocol V3',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        sourceToken: usdcEth,
        destinationToken: usdcArb,
        sourceAmountRaw: '1000000000',
        destinationAmountRaw: '999500000',
        minDestinationAmountRaw: '994502500',
        bridgeFeeUSD: 0.5,
        relayerFee: '0.05%',
        gasEstimateUSD: 5,
        recipient: USER_ADDR,
        executionTarget: ACROSS_SPOKE_POOLS[1],
        calldata: '0x1234',
        value: '0',
        approvalTarget: ACROSS_SPOKE_POOLS[1],
        quoteTimestamp: Date.now(),
        isExecutable: true
      },
      execution: {
        to: ACROSS_SPOKE_POOLS[1],
        data: '0x1234',
        value: '0',
        approvalTarget: ACROSS_SPOKE_POOLS[1],
        requiredAllowanceRaw: '1000000000'
      }
    }
  };

  let txSent = false;
  const mockSigner = {
    getAddress: async () => USER_ADDR,
    estimateGas: async () => {
      throw new Error('execution reverted: gas estimation failed');
    },
    sendTransaction: async () => {
      txSent = true;
      return { hash: '0xsent' };
    },
    provider: {
      call: async () => '0x000000000000000000000000000000000000000000000000000000003b9aca00'
    }
  };

  await assert.rejects(
    async () => {
      await adapter.executeSwap({
        quote: quoteResponse,
        userAddress: USER_ADDR,
        signer: mockSigner as any
      });
    },
    (err: any) => {
      assert.ok(err instanceof ZenithSimulationFailedError);
      return true;
    }
  );

  assert.equal(txSent, false, 'Transaction must NOT be dispatched when gas estimation fails');
});

test('I. Successful source transaction sets status to BRIDGE_IN_FLIGHT (not settled)', async () => {
  const coordinator = new ExecutionCoordinator();
  const stateMachine = new ExecutionStateMachine();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quoteResponse: any = {
    requestId: 'req-inflight',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR
    },
    amountInRaw: '1000000000',
    amountOutRaw: '999500000',
    minimumReceivedRaw: '994502500',
    amountInFormatted: '1000',
    amountOutFormatted: '999.5',
    priceImpact: { percentage: 0 },
    protocolFee: { feeUSD: 0 },
    bestRoute: {
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 5,
      crossChainQuote: {
        provider: 'ACROSS',
        providerName: 'Across Protocol V3',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        sourceToken: usdcEth,
        destinationToken: usdcArb,
        sourceAmountRaw: '1000000000',
        destinationAmountRaw: '999500000',
        minDestinationAmountRaw: '994502500',
        bridgeFeeUSD: 0.5,
        relayerFee: '0.05%',
        gasEstimateUSD: 5,
        recipient: USER_ADDR,
        executionTarget: ACROSS_SPOKE_POOLS[1],
        calldata: '0x1234',
        value: '0',
        approvalTarget: ACROSS_SPOKE_POOLS[1],
        quoteTimestamp: Date.now(),
        isExecutable: true
      },
      execution: {
        to: ACROSS_SPOKE_POOLS[1],
        data: '0x1234',
        value: '0',
        approvalTarget: ACROSS_SPOKE_POOLS[1],
        requiredAllowanceRaw: '1000000000'
      }
    }
  };

  const mockSigner = {
    getAddress: async () => USER_ADDR,
    estimateGas: async () => 150000n,
    sendTransaction: async () => ({
      hash: '0xsource_tx_1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      wait: async () => ({ status: 1, blockNumber: 1234567 })
    }),
    provider: {
      call: async () => '0x000000000000000000000000000000000000000000000000000000003b9aca00',
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 1234567 })
    }
  };

  const receipt = await coordinator.executeTrade({
    quote: quoteResponse,
    userAddress: USER_ADDR,
    signer: mockSigner as any,
    stateMachine,
    skipDestinationWait: true
  });

  assert.equal(receipt.status, 'BRIDGE_IN_FLIGHT');
  assert.equal(receipt.bridgeDetails?.destinationVerified, false);
  assert.equal(receipt.txHash, '0xsource_tx_1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
});

test('J. Provider reports destination fill: State transitions to DESTINATION_FILLED -> SETTLED', async () => {
  const tracker = new CrossChainTracker();
  const stateMachine = new ExecutionStateMachine();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '999500000',
    minDestinationAmountRaw: '994502500',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    isExecutable: true
  };

  const activeOrder: ActiveCrossChainOrder = {
    orderId: 'order-fill-test',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0xsource123',
    provider: 'ACROSS',
    recipient: USER_ADDR,
    quote,
    status: 'FULFILLING',
    createdAt: Date.now(),
    lastUpdated: Date.now()
  };

  // Mock provider getStatus to return filled on 2nd poll
  let pollCount = 0;
  const mockProvider = {
    id: 'ACROSS',
    getStatus: async () => {
      pollCount++;
      if (pollCount >= 2) {
        return {
          state: 'DESTINATION_FILLED',
          sourceTxHash: '0xsource123',
          destinationTxHash: '0xdestfill456',
          isComplete: true,
          isFailed: false,
          timestamp: Date.now()
        };
      }
      return {
        state: 'FULFILLING',
        sourceTxHash: '0xsource123',
        isComplete: false,
        isFailed: false,
        timestamp: Date.now()
      };
    }
  };

  (tracker as any).aggregator = {
    getProvider: () => mockProvider
  };

  // Mock destination verification
  tracker.verifyDestinationSettlement = async () => ({
    isVerified: true,
    receipt: { status: 1 }
  });

  const states: string[] = [];
  const res = await tracker.trackUntilSettled({
    order: activeOrder,
    stateMachine,
    pollIntervalMs: 10,
    maxPollDurationMs: 1000,
    onStateChange: (s) => states.push(s)
  });

  assert.equal(res.isSuccess, true);
  assert.equal(res.destinationTxHash, '0xdestfill456');
  assert.ok(states.includes('DESTINATION_FILLED'));
  assert.ok(states.includes('SETTLED'));
});

test('K. Provider reports failure: State transitions to FAILED', async () => {
  const tracker = new CrossChainTracker();
  const stateMachine = new ExecutionStateMachine();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const activeOrder: ActiveCrossChainOrder = {
    orderId: 'order-fail-test',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0xsource123',
    provider: 'ACROSS',
    recipient: USER_ADDR,
    quote: {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceToken: usdcEth,
      destinationToken: usdcArb,
      sourceAmountRaw: '1000000000',
      destinationAmountRaw: '999500000',
      minDestinationAmountRaw: '994502500',
      bridgeFeeUSD: 0.5,
      recipient: USER_ADDR,
      executionTarget: ACROSS_SPOKE_POOLS[1],
      calldata: '0x1234',
      value: '0',
      quoteTimestamp: Date.now(),
      isExecutable: true
    },
    status: 'FULFILLING',
    createdAt: Date.now(),
    lastUpdated: Date.now()
  };

  const mockProvider = {
    id: 'ACROSS',
    getStatus: async () => ({
      state: 'FAILED',
      sourceTxHash: '0xsource123',
      isComplete: false,
      isFailed: true,
      errorMessage: 'Relayer failed to fill deposit before deadline',
      timestamp: Date.now()
    })
  };

  (tracker as any).aggregator = {
    getProvider: () => mockProvider
  };

  const states: string[] = [];
  const res = await tracker.trackUntilSettled({
    order: activeOrder,
    stateMachine,
    pollIntervalMs: 10,
    maxPollDurationMs: 500,
    onStateChange: (s) => states.push(s)
  });

  assert.equal(res.isSuccess, false);
  assert.ok(states.includes('FAILED'));
  assert.equal(stateMachine.getStatus(), 'FAILED');
});

test('L. Provider reports refund: State transitions to REFUND_PENDING / REFUNDED', async () => {
  const tracker = new CrossChainTracker();
  const stateMachine = new ExecutionStateMachine();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const activeOrder: ActiveCrossChainOrder = {
    orderId: 'order-refund-test',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0xsource123',
    provider: 'ACROSS',
    recipient: USER_ADDR,
    quote: {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceToken: usdcEth,
      destinationToken: usdcArb,
      sourceAmountRaw: '1000000000',
      destinationAmountRaw: '999500000',
      minDestinationAmountRaw: '994502500',
      bridgeFeeUSD: 0.5,
      recipient: USER_ADDR,
      executionTarget: ACROSS_SPOKE_POOLS[1],
      calldata: '0x1234',
      value: '0',
      quoteTimestamp: Date.now(),
      isExecutable: true
    },
    status: 'FULFILLING',
    createdAt: Date.now(),
    lastUpdated: Date.now()
  };

  const mockProvider = {
    id: 'ACROSS',
    getStatus: async () => ({
      state: 'REFUND_PENDING',
      sourceTxHash: '0xsource123',
      isComplete: false,
      isFailed: true,
      errorMessage: 'Across deposit expired: tokens returned to depositor',
      timestamp: Date.now()
    })
  };

  (tracker as any).aggregator = {
    getProvider: () => mockProvider
  };

  const states: string[] = [];
  const res = await tracker.trackUntilSettled({
    order: activeOrder,
    stateMachine,
    pollIntervalMs: 10,
    maxPollDurationMs: 500,
    onStateChange: (s) => states.push(s)
  });

  assert.equal(res.isSuccess, false);
  assert.equal(res.isRefunded, true);
  assert.ok(states.includes('REFUND_PENDING'));
});

test('M. Tracking timeout transitions to TRACKING_TIMEOUT and retains identifiers', async () => {
  const tracker = new CrossChainTracker();
  const stateMachine = new ExecutionStateMachine();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const activeOrder: ActiveCrossChainOrder = {
    orderId: 'order-timeout-test',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0xsource123',
    provider: 'ACROSS',
    recipient: USER_ADDR,
    quote: {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceToken: usdcEth,
      destinationToken: usdcArb,
      sourceAmountRaw: '1000000000',
      destinationAmountRaw: '999500000',
      minDestinationAmountRaw: '994502500',
      bridgeFeeUSD: 0.5,
      recipient: USER_ADDR,
      executionTarget: ACROSS_SPOKE_POOLS[1],
      calldata: '0x1234',
      value: '0',
      quoteTimestamp: Date.now(),
      isExecutable: true
    },
    status: 'FULFILLING',
    createdAt: Date.now(),
    lastUpdated: Date.now()
  };

  // Provider consistently reports FULFILLING
  const mockProvider = {
    id: 'ACROSS',
    getStatus: async () => ({
      state: 'FULFILLING',
      sourceTxHash: '0xsource123',
      isComplete: false,
      isFailed: false,
      timestamp: Date.now()
    })
  };

  (tracker as any).aggregator = {
    getProvider: () => mockProvider
  };

  const states: string[] = [];
  const res = await tracker.trackUntilSettled({
    order: activeOrder,
    stateMachine,
    pollIntervalMs: 20,
    maxPollDurationMs: 100, // Short timeout for test
    onStateChange: (s) => states.push(s)
  });

  assert.equal(res.isSuccess, false);
  assert.equal(res.isTimeout, true);
  assert.ok(states.includes('TRACKING_TIMEOUT'));
  assert.equal(stateMachine.getStatus(), 'TRACKING_TIMEOUT');

  const storedOrder = tracker.getOrder('order-timeout-test');
  assert.ok(storedOrder);
  assert.equal(storedOrder?.status, 'TRACKING_TIMEOUT');
  assert.equal(storedOrder?.sourceTxHash, '0xsource123');
});
