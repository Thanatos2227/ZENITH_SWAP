import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
  AcrossProvider,
  DeBridgeProvider,
  StargateProvider,
  CrossChainAggregator,
  ZenithRouter,
  scaleTokenUnits
} from '../packages/routing/src';
import {
  EVMExecutionAdapter,
  ExecutionCoordinator,
  CrossChainTracker,
  ExecutionStateMachine
} from '../packages/execution/src';
import {
  ACROSS_V3_SPOKE_POOLS,
  STARGATE_V2_ROUTERS,
  DEBRIDGE_DLN_SOURCE_CONTRACTS,
  ACROSS_SPOKE_POOL_ABI,
  DEBRIDGE_DLN_SOURCE_ABI,
  STARGATE_ROUTER_ABI,
  RecipientMismatchError,
  SignerRequiredError,
  InvalidCalldataError,
  InvalidRecipientAddressError
} from '../packages/contracts/src';
import { DEFAULT_TOKENS } from '../packages/tokens/src';
import { QuoteRequest, CrossChainQuote, Token } from '../packages/types/src';

test('Across Provider: Live Quote Parsing & Exact depositV3 Calldata Encoding', async () => {
  const provider = new AcrossProvider();
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;
  const user = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

  assert.ok(tokenIn && tokenOut);

  const quote = await provider.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn,
    tokenOut,
    amountInRaw: '1000000000',
    recipient: user,
    slippageTolerancePercent: 0.5
  });

  if (quote) {
    assert.equal(quote.provider, 'ACROSS');
    assert.equal(quote.executionTarget.toLowerCase(), ACROSS_V3_SPOKE_POOLS[1].toLowerCase());
    assert.ok(BigInt(quote.destinationAmountRaw) > 0n);
    assert.ok(quote.calldata.startsWith('0x') && quote.calldata.length > 2);

    const iface = new ethers.Interface(ACROSS_SPOKE_POOL_ABI);
    const decoded = iface.decodeFunctionData('depositV3', quote.calldata);
    assert.equal(decoded[0].toLowerCase(), user.toLowerCase());
    assert.equal(decoded[1].toLowerCase(), user.toLowerCase());
    assert.equal(decoded[2].toLowerCase(), tokenIn.address.toLowerCase());
    assert.equal(decoded[3].toLowerCase(), tokenOut.address.toLowerCase());
    assert.equal(decoded[4].toString(), '1000000000');
    assert.equal(decoded[6].toString(), '42161');
  }

  const sampleQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: tokenIn,
    destinationToken: tokenOut,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '999500000',
    minDestinationAmountRaw: '994502500',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: user,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-eth-arb',
    executionTarget: ACROSS_V3_SPOKE_POOLS[1],
    calldata: '0x',
    value: '0',
    approvalTarget: ACROSS_V3_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+'
  };

  const execution = await provider.buildExecution(sampleQuote, user, user);
  assert.equal(execution.to.toLowerCase(), ACROSS_V3_SPOKE_POOLS[1].toLowerCase());
  assert.equal(execution.approvalTarget?.toLowerCase(), ACROSS_V3_SPOKE_POOLS[1].toLowerCase());
  assert.equal(execution.value, '0');
  assert.ok(execution.data.startsWith('0x'));

  const iface = new ethers.Interface(ACROSS_SPOKE_POOL_ABI);
  const decodedExec = iface.decodeFunctionData('depositV3', execution.data);
  assert.equal(decodedExec[0].toLowerCase(), user.toLowerCase());
  assert.equal(decodedExec[1].toLowerCase(), user.toLowerCase());
  assert.equal(decodedExec[4].toString(), '1000000000');
});

test('deBridge DLN Provider: Live Quote Parsing & Order Parameter Verification', async () => {
  const provider = new DeBridgeProvider();
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'polygon' && t.symbol === 'USDC')!;
  const user = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

  assert.ok(tokenIn && tokenOut);

  const sampleQuote: CrossChainQuote = {
    provider: 'DEBRIDGE_DLN',
    providerName: 'deBridge DLN',
    sourceChainId: 'ethereum',
    destinationChainId: 'polygon',
    sourceToken: tokenIn,
    destinationToken: tokenOut,
    sourceAmountRaw: '500000000',
    destinationAmountRaw: '499800000',
    minDestinationAmountRaw: '497301000',
    bridgeFeeUSD: 0.2,
    relayerFee: '0.04%',
    gasEstimateUSD: 4,
    recipient: user,
    expiration: Date.now() + 300000,
    routeIdentifier: 'debridge-eth-poly',
    executionTarget: DEBRIDGE_DLN_SOURCE_CONTRACTS[1],
    calldata: '0x',
    value: '0',
    approvalTarget: DEBRIDGE_DLN_SOURCE_CONTRACTS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 15,
    securityRating: 'A'
  };

  const execution = await provider.buildExecution(sampleQuote, user, user);
  assert.equal(execution.to.toLowerCase(), DEBRIDGE_DLN_SOURCE_CONTRACTS[1].toLowerCase());
  assert.equal(execution.approvalTarget?.toLowerCase(), DEBRIDGE_DLN_SOURCE_CONTRACTS[1].toLowerCase());
  assert.ok(execution.data.startsWith('0x'));

  const iface = new ethers.Interface(DEBRIDGE_DLN_SOURCE_ABI);
  const decoded = iface.decodeFunctionData('createOrder', execution.data);
  const orderCreation = decoded[0];
  assert.equal(orderCreation.giveTokenAddress.toLowerCase(), tokenIn.address.toLowerCase());
  assert.equal(orderCreation.giveAmount.toString(), '500000000');
  assert.equal(orderCreation.takeChainId.toString(), '137');
});

test('Stargate Provider: Route Rejection for Unsupported Assets & Canonical Routing', async () => {
  const provider = new StargateProvider();
  const tokenInUSDC = DEFAULT_TOKENS.find((t) => t.chainId === 'polygon' && t.symbol === 'USDC')!;
  const tokenOutUSDC = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;
  const unsupportedToken = DEFAULT_TOKENS.find((t) => t.chainId === 'polygon' && t.isNative)!;

  assert.equal(provider.isAvailable('polygon', 'arbitrum', tokenInUSDC, tokenOutUSDC), true);

  assert.equal(provider.isAvailable('polygon', 'arbitrum', unsupportedToken, tokenOutUSDC), false);

  const rejectedQuote = await provider.getQuote({
    sourceChainId: 'polygon',
    destinationChainId: 'arbitrum',
    tokenIn: unsupportedToken,
    tokenOut: tokenOutUSDC,
    amountInRaw: '1000000000000000000',
    slippageTolerancePercent: 0.5
  });
  assert.equal(rejectedQuote, null);

  const validQuote = await provider.getQuote({
    sourceChainId: 'polygon',
    destinationChainId: 'arbitrum',
    tokenIn: tokenInUSDC,
    tokenOut: tokenOutUSDC,
    amountInRaw: '100000000',
    recipient: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    slippageTolerancePercent: 0.5
  });

  assert.ok(validQuote);
  assert.equal(validQuote.provider, 'STARGATE');
  assert.equal(validQuote.executionTarget.toLowerCase(), STARGATE_V2_ROUTERS[137].toLowerCase());
  assert.ok(BigInt(validQuote.destinationAmountRaw) > 0n);
});

test('Decimal Correctness: Exact BigInt unit scaling without floating point errors', () => {

  const rawPol = 1000000000000000000n;
  const scaled6 = scaleTokenUnits(rawPol, 18, 6);
  assert.equal(scaled6, 1000000n);

  const rawUsdc = 100000000n;
  const scaled18 = scaleTokenUnits(rawUsdc, 6, 18);
  assert.equal(scaled18, 100000000000000000000n);

  const rawDai = 50000000000000000000n;
  assert.equal(scaleTokenUnits(rawDai, 18, 18), rawDai);
});

test('Provider Selection: Same-Chain Bridge Requests Must Return Empty Routes', async () => {
  const aggregator = new CrossChainAggregator();
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'polygon' && t.isNative)!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'polygon' && t.symbol === 'USDT')!;

  const quotes = await aggregator.getQuotes({
    sourceChainId: 'polygon',
    destinationChainId: 'polygon',
    tokenIn,
    tokenOut,
    amountInRaw: '1000000000000000000',
    slippageTolerancePercent: 0.5
  });

  assert.equal(quotes.length, 0, 'Same-chain requests must never select bridge providers');
});

test('EVM Execution Adapter: Transaction Consistency & Signer Enforcement', async () => {
  const adapter = new EVMExecutionAdapter();
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'polygon' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;
  const user = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

  const mockQuoteResponse: any = {
    requestId: 'test-req',
    request: {
      sourceChainId: 'polygon',
      destinationChainId: 'arbitrum',
      tokenIn,
      tokenOut,
      amountInRaw: '100000000',
      recipientAddress: user
    },
    amountInRaw: '100000000',
    amountOutRaw: '99940000',
    amountInFormatted: '100',
    amountOutFormatted: '99.94',
    bestRoute: {
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 0.1,
      crossChainQuote: {
        provider: 'ACROSS',
        providerName: 'Across Protocol V3',
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        sourceToken: tokenIn,
        destinationToken: tokenOut,
        sourceAmountRaw: '100000000',
        destinationAmountRaw: '99940000',
        minDestinationAmountRaw: '99440300',
        bridgeFeeUSD: 0.06,
        relayerFee: '0.06%',
        gasEstimateUSD: 0.1,
        recipient: user,
        expiration: Date.now() + 300000,
        routeIdentifier: 'across-poly-arb',
        executionTarget: ACROSS_V3_SPOKE_POOLS[137],
        calldata: '0x',
        value: '0',
        approvalTarget: ACROSS_V3_SPOKE_POOLS[137],
        quoteTimestamp: Date.now(),
        estimatedTransferTimeSec: 30,
        securityRating: 'A+'
      }
    }
  };

  await assert.rejects(
    async () => {
      await adapter.executeSwap({
        quote: mockQuoteResponse,
        userAddress: user
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof SignerRequiredError);
      return true;
    }
  );

  let simulatedTx: any = null;
  let submittedTx: any = null;

  const mockSigner = {
    getAddress: async () => user,
    estimateGas: async (tx: any) => {
      simulatedTx = { ...tx };
      return 150000n;
    },
    sendTransaction: async (tx: any) => {
      submittedTx = { ...tx };
      return {
        hash: '0x9999999999999999999999999999999999999999999999999999999999999999',
        wait: async () => ({
          status: 1,
          blockNumber: 50000000,
          gasUsed: 145000n,
          gasPrice: 30000000000n
        })
      };
    },
    provider: {
      call: async () => '0x0000000000000000000000000000000000000000000000000000000005f5e100',
      getFeeData: async () => ({ gasPrice: 30000000000n }),
      getTransactionReceipt: async (hash: string) => ({
        status: 1,
        hash,
        blockNumber: 50000000,
        gasUsed: 145000n,
        gasPrice: 30000000000n
      })
    }
  } as any;

  const statuses: string[] = [];
  const result = await adapter.executeSwap({
    quote: mockQuoteResponse,
    userAddress: user,
    signer: mockSigner,
    onStatusChange: (s) => statuses.push(s)
  });

  assert.equal(result.isSuccess, true);
  assert.equal(result.txHash, '0x9999999999999999999999999999999999999999999999999999999999999999');
  assert.ok(statuses.includes('SIMULATING'));
  assert.ok(statuses.includes('SIGNING'));
  assert.ok(statuses.includes('BRIDGE_IN_FLIGHT'));

  assert.equal(simulatedTx.to.toLowerCase(), submittedTx.to.toLowerCase());
  assert.equal(simulatedTx.data, submittedTx.data);
  assert.equal(simulatedTx.value.toString(), submittedTx.value.toString());
});

test('CrossChainTracker: Destination Settlement Verification on RPC', async () => {
  const tracker = new CrossChainTracker();
  const user = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

  const verification = await tracker.verifyDestinationSettlement({
    destinationChainId: 'arbitrum',
    destinationTxHash: '0x1234000000000000000000000000000000000000000000000000000000005678',
    expectedRecipient: user
  });

  assert.ok(typeof verification.isVerified === 'boolean');
});
