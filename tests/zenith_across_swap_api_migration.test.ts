import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AcrossProvider, defaultAcrossProvider } from '../packages/routing/src/crosschain/providers/acrossProvider';
import { CrossChainAggregator, ZenithRouter } from '../packages/routing/src';
import { defaultTokenService } from '../packages/tokens/src';
import { defaultChainRegistry } from '../packages/chains/src';
import { ExecutionPlanBuilder, ExecutionCoordinator, ExecutionPlanValidator, sealPlan, assertPlanIntegrity } from '../packages/execution/src';
import { QuoteRequest, CrossChainQuote, Token, DEXQuote } from '../packages/types/src';
import { ProviderUnavailableError, ExecutionUnavailableError, DestinationExecutionUnavailableError } from '../packages/contracts/src';

const USER_ADDR = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const RECIPIENT_ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const SPOKE_POOL_ARB = '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A';
const MOCK_API_KEY = 'test_across_api_key_secret_12345';
const MOCK_INTEGRATOR_ID = '0x0001';

describe('ZENITH — Across Protocol Production /swap/approval API Migration Test Suite', () => {
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  const usdcBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'USDC')!;
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;

  it('1. Authenticated /swap/approval request includes Authorization Bearer header', async () => {
    let capturedHeaders: HeadersInit | undefined = undefined;
    let capturedUrl: string | undefined = undefined;

    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({
        swapTx: {
          to: SPOKE_POOL_ARB,
          data: '0x7b9392320000000000000000000000008ba1f109551bd432803012645ac136ddd64dba72',
          value: '0',
          chainId: 42161
        },
        outputAmount: '999500000',
        minOutputAmount: '994502500',
        quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300,
        totalRelayFee: { total: '500000', pct: '0.0005' },
        estimatedFillTimeSec: 25
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const provider = new AcrossProvider({
      apiKey: MOCK_API_KEY,
      integratorId: MOCK_INTEGRATOR_ID,
      fetchFn: mockFetch
    });

    const quote = await provider.getQuote({
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: usdcArb,
      tokenOut: usdcBase,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    });

    assert.ok(quote);
    assert.equal(quote.isExecutable, true);
    assert.ok(capturedHeaders);
    assert.equal((capturedHeaders as any)['Authorization'], `Bearer ${MOCK_API_KEY}`);
    assert.equal((capturedHeaders as any)['Accept'], 'application/json');
    assert.ok(capturedUrl?.startsWith('https://app.across.to/api/swap/approval'));
  });

  it('2. Required query parameters are strictly populated (originChainId, destinationChainId, inputToken, outputToken, amount, tradeType, depositor, recipient, integratorId)', async () => {
    let capturedUrl: string | undefined = undefined;

    const mockFetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({
        swapTx: {
          to: SPOKE_POOL_ARB,
          data: '0x7b9392320000000000000000000000008ba1f109551bd432803012645ac136ddd64dba72',
          value: '0',
          chainId: 42161
        },
        outputAmount: '999500000',
        minOutputAmount: '994502500',
        quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300,
        totalRelayFee: { total: '500000', pct: '0.0005' },
        estimatedFillTimeSec: 20
      }), { status: 200 });
    }) as any;

    const provider = new AcrossProvider({
      apiKey: MOCK_API_KEY,
      integratorId: MOCK_INTEGRATOR_ID,
      fetchFn: mockFetch
    });

    await provider.getQuote({
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: usdcArb,
      tokenOut: usdcBase,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    });

    assert.ok(capturedUrl);
    const parsed = new URL(capturedUrl);
    assert.equal(parsed.searchParams.get('originChainId'), '42161');
    assert.equal(parsed.searchParams.get('destinationChainId'), '8453');
    assert.equal(parsed.searchParams.get('inputToken')?.toLowerCase(), usdcArb.address.toLowerCase());
    assert.equal(parsed.searchParams.get('outputToken')?.toLowerCase(), usdcBase.address.toLowerCase());
    assert.equal(parsed.searchParams.get('amount'), '1000000000');
    assert.equal(parsed.searchParams.get('tradeType'), 'exactInput');
    assert.equal(parsed.searchParams.get('depositor')?.toLowerCase(), USER_ADDR.toLowerCase());
    assert.equal(parsed.searchParams.get('recipient')?.toLowerCase(), RECIPIENT_ADDR.toLowerCase());
    assert.equal(parsed.searchParams.get('integratorId'), MOCK_INTEGRATOR_ID);
  });

  it('3. Missing API key fails closed without making unauthenticated production network call', async () => {
    let fetchCalled = false;
    const mockFetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as any;

    // Isolate environment
    const prevKey = process.env.ACROSS_API_KEY;
    const prevZenithKey = process.env.ZENITH_ACROSS_API_KEY;
    delete process.env.ACROSS_API_KEY;
    delete process.env.ZENITH_ACROSS_API_KEY;

    try {
      const provider = new AcrossProvider({
        apiKey: undefined,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false, 'Quote must be marked non-executable when API key is missing');
      assert.equal(quote.calldata, '0x');
      assert.ok(quote.unexecutableReason?.includes('ACROSS_AUTH_REQUIRED') || quote.unexecutableReason?.includes('API_AUTH_REQUIRED'));
      assert.equal(fetchCalled, false, 'Must NOT perform unauthenticated production request');
    } finally {
      if (prevKey) process.env.ACROSS_API_KEY = prevKey;
      if (prevZenithKey) process.env.ZENITH_ACROSS_API_KEY = prevZenithKey;
    }
  });

  it('4. Missing Integrator ID fails closed without making production request', async () => {
    let fetchCalled = false;
    const mockFetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as any;

    const prevInt = process.env.ACROSS_INTEGRATOR_ID;
    const prevZenithInt = process.env.ZENITH_ACROSS_INTEGRATOR_ID;
    delete process.env.ACROSS_INTEGRATOR_ID;
    delete process.env.ZENITH_ACROSS_INTEGRATOR_ID;

    try {
      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: undefined,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.calldata, '0x');
      assert.equal(fetchCalled, false);
    } finally {
      if (prevInt) process.env.ACROSS_INTEGRATOR_ID = prevInt;
      if (prevZenithInt) process.env.ZENITH_ACROSS_INTEGRATOR_ID = prevZenithInt;
    }
  });

  it('5. Malformed swapTx in Across response is rejected and marked unexecutable', async () => {
    const mockFetch = (async () => {
      return new Response(JSON.stringify({
        swapTx: null, // missing swapTx
        outputAmount: '999500000',
        quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300
      }), { status: 200 });
    }) as any;

    const provider = new AcrossProvider({
      apiKey: MOCK_API_KEY,
      integratorId: MOCK_INTEGRATOR_ID,
      fetchFn: mockFetch
    });

    const quote = await provider.getQuote({
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: usdcArb,
      tokenOut: usdcBase,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    });

    assert.ok(quote);
    assert.equal(quote.isExecutable, false);
    assert.equal(quote.calldata, '0x');
    assert.ok(quote.unexecutableReason?.includes('EXECUTION_DATA_UNAVAILABLE') || quote.unexecutableReason?.includes('MALFORMED'));
  });

  it('6. Expired quote is rejected and marked QUOTE_EXPIRED', async () => {
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 100; // in the past

    const mockFetch = (async () => {
      return new Response(JSON.stringify({
        swapTx: {
          to: SPOKE_POOL_ARB,
          data: '0x7b9392320000000000000000000000008ba1f109551bd432803012645ac136ddd64dba72',
          value: '0',
          chainId: 42161
        },
        outputAmount: '999500000',
        quoteExpiryTimestamp: expiredTimestamp
      }), { status: 200 });
    }) as any;

    const provider = new AcrossProvider({
      apiKey: MOCK_API_KEY,
      integratorId: MOCK_INTEGRATOR_ID,
      fetchFn: mockFetch
    });

    const quote = await provider.getQuote({
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: usdcArb,
      tokenOut: usdcBase,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    });

    assert.ok(quote);
    assert.equal(quote.isExecutable, false);
    assert.ok(quote.unexecutableReason?.includes('QUOTE_EXPIRED') || quote.unexecutableReason?.includes('EXPIRED'));
  });

  it('7. Valid swapTx is parsed directly without manual depositV3 calldata re-encoding', async () => {
    const authenticSwapCalldata = '0x7b939232aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

    const mockFetch = (async () => {
      return new Response(JSON.stringify({
        swapTx: {
          to: SPOKE_POOL_ARB,
          data: authenticSwapCalldata,
          value: '0',
          chainId: 42161
        },
        outputAmount: '999500000',
        minOutputAmount: '994502500',
        quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300,
        totalRelayFee: { total: '500000', pct: '0.0005' },
        estimatedFillTimeSec: 25
      }), { status: 200 });
    }) as any;

    const provider = new AcrossProvider({
      apiKey: MOCK_API_KEY,
      integratorId: MOCK_INTEGRATOR_ID,
      fetchFn: mockFetch
    });

    const quote = await provider.getQuote({
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: usdcArb,
      tokenOut: usdcBase,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    });

    assert.ok(quote);
    assert.equal(quote.isExecutable, true);
    assert.equal(quote.calldata, authenticSwapCalldata, 'Must use swapTx.data directly');
    assert.equal(quote.executionTarget, SPOKE_POOL_ARB, 'Must use swapTx.to directly');

    const exec = await provider.buildExecution(quote, USER_ADDR);
    assert.equal(exec.data, authenticSwapCalldata);
    assert.equal(exec.to, SPOKE_POOL_ARB);
  });

  it('8. Returned approval transactions (approvalTxns) are parsed and set as approval target', async () => {
    const customSpender = '0x1111111111111111111111111111111111111111';
    const approvalCalldata = '0x095ea7b30000000000000000000000001111111111111111111111111111111111111111ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    const mockFetch = (async () => {
      return new Response(JSON.stringify({
        swapTx: {
          to: SPOKE_POOL_ARB,
          data: '0x7b9392320000000000000000000000008ba1f109551bd432803012645ac136ddd64dba72',
          value: '0',
          chainId: 42161
        },
        approvalTxns: [
          {
            to: usdcArb.address,
            data: approvalCalldata,
            value: '0',
            chainId: 42161,
            tokenAddress: usdcArb.address,
            spender: customSpender,
            amount: '1000000000'
          }
        ],
        outputAmount: '999500000',
        quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300
      }), { status: 200 });
    }) as any;

    const provider = new AcrossProvider({
      apiKey: MOCK_API_KEY,
      integratorId: MOCK_INTEGRATOR_ID,
      fetchFn: mockFetch
    });

    const quote = await provider.getQuote({
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: usdcArb,
      tokenOut: usdcBase,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    });

    assert.ok(quote);
    assert.equal(quote.approvalTarget, customSpender);
    assert.equal((quote as any).approvalTxns?.length, 1);
  });

  it('9. HTTP 401/403 maps to API_AUTH_REQUIRED and fails closed', async () => {
    const mockFetch = (async () => {
      return new Response(JSON.stringify({ message: 'Invalid API key provided' }), { status: 401 });
    }) as any;

    const provider = new AcrossProvider({
      apiKey: 'invalid_key',
      integratorId: MOCK_INTEGRATOR_ID,
      fetchFn: mockFetch
    });

    const quote = await provider.getQuote({
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: usdcArb,
      tokenOut: usdcBase,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    });

    assert.ok(quote);
    assert.equal(quote.isExecutable, false);
    assert.ok(quote.unexecutableReason?.includes('API_AUTH_REQUIRED') || quote.unexecutableReason?.includes('AUTH'));
  });

  it('10. HTTP 429 maps to RATE_LIMITED and fails closed', async () => {
    const mockFetch = (async () => {
      return new Response(JSON.stringify({ message: 'Rate limit exceeded' }), { status: 429 });
    }) as any;

    const provider = new AcrossProvider({
      apiKey: MOCK_API_KEY,
      integratorId: MOCK_INTEGRATOR_ID,
      fetchFn: mockFetch
    });

    const quote = await provider.getQuote({
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: usdcArb,
      tokenOut: usdcBase,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    });

    assert.ok(quote);
    assert.equal(quote.isExecutable, false);
    assert.equal(quote.unexecutableReason, 'RATE_LIMITED');
  });

  it('11. Direct same-token bridge ExecutionPlan is constructed accurately from Swap API quote', async () => {
    const authenticSwapCalldata = '0x7b939232aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

    const mockFetch = (async () => {
      return new Response(JSON.stringify({
        swapTx: {
          to: SPOKE_POOL_ARB,
          data: authenticSwapCalldata,
          value: '0',
          chainId: 42161
        },
        outputAmount: '999500000',
        minOutputAmount: '994502500',
        quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300,
        totalRelayFee: { total: '500000', pct: '0.0005' },
        estimatedFillTimeSec: 25
      }), { status: 200 });
    }) as any;

    const provider = new AcrossProvider({
      apiKey: MOCK_API_KEY,
      integratorId: MOCK_INTEGRATOR_ID,
      fetchFn: mockFetch
    });

    const aggregator = new CrossChainAggregator([provider]);
    const quotes = await aggregator.getQuotes({
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: usdcArb,
      tokenOut: usdcBase,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    });

    assert.ok(quotes.length > 0);
    const quote = quotes[0];
    assert.equal(quote.isExecutable, true);

    const plan = ExecutionPlanBuilder.buildPlan({
      route: {
        id: 'route-direct-across',
        routeType: 'CROSS_CHAIN',
        hops: [],
        crossChainQuote: quote,
        isExecutable: true,
        gasCostUSD: 0.05,
        estimatedGasUnits: 200000n
      },
      request: {
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      }
    });

    assert.ok(plan);
    assert.equal(plan.isExecutable, true);
    assert.equal(plan.routeType, 'CROSS_CHAIN_DIRECT');
    ExecutionPlanValidator.validatePlan(plan);

    const bridgeDeposit = plan.steps.find((s) => s.type === 'BRIDGE_DEPOSIT')!;
    assert.ok(bridgeDeposit);
    assert.equal(bridgeDeposit.targetAddress, SPOKE_POOL_ARB);
    assert.equal(bridgeDeposit.calldata, authenticSwapCalldata);
  });

  it('12. Composite Route (ETH Arb -> Across -> BRETT Base) integrates Swap API quote and maintains dynamic amount propagation', async () => {
    const capturedBridgeAmounts: string[] = [];

    const mockFetch = (async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      const amt = parsed.searchParams.get('amount');
      if (amt) capturedBridgeAmounts.push(amt);
      return new Response(JSON.stringify({
        swapTx: {
          to: SPOKE_POOL_ARB,
          data: '0x7b9392320000000000000000000000008ba1f109551bd432803012645ac136ddd64dba72',
          value: '0',
          chainId: 42161
        },
        outputAmount: '2496876718', // ~2,496.87 USDC on Base
        minOutputAmount: '2490000000',
        quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300,
        totalRelayFee: { total: '1248750', pct: '0.0005' },
        estimatedFillTimeSec: 25
      }), { status: 200 });
    }) as any;

    const acrossProvider = new AcrossProvider({
      apiKey: MOCK_API_KEY,
      integratorId: MOCK_INTEGRATOR_ID,
      fetchFn: mockFetch
    });

    const aggregator = new CrossChainAggregator([acrossProvider]);

    const routes = await aggregator.findConnectorBridgeQuotes({
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: ethArb,
      tokenOut: brettBase,
      amountInRaw: '1000000000000000000', // 1 ETH
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    });

    assert.ok(routes.length > 0);
    const usdcCompositeRoute = routes.find((r) => (r as any).sourceConnectorToken?.symbol === 'USDC');
    assert.ok(usdcCompositeRoute, 'Must find USDC connector route');
    assert.ok(usdcCompositeRoute.sourceDexQuote, 'Must contain source DEX quote');
    assert.ok(usdcCompositeRoute.underlyingBridgeQuote, 'Must contain underlying bridge quote');
    assert.ok(usdcCompositeRoute.destDexQuote, 'Must contain destination DEX quote');

    // Dynamic amount propagation: source DEX amountOut was passed as bridge request amount
    const expectedSrcDexOut = usdcCompositeRoute.sourceDexQuote.amountOut.toString();
    assert.ok(capturedBridgeAmounts.includes(expectedSrcDexOut), `Expected bridge amounts ${JSON.stringify(capturedBridgeAmounts)} to contain source DEX output ${expectedSrcDexOut}`);
  });

  it('13. Deposit status tracking queries Across deposit/status API accurately', async () => {
    let capturedUrl: string | undefined = undefined;

    const mockFetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({
        status: 'filled',
        fillTx: '0x9999999999999999999999999999999999999999999999999999999999999999',
        depositId: '12345',
        originChainId: 42161,
        destinationChainId: 8453
      }), { status: 200 });
    }) as any;

    const provider = new AcrossProvider({
      fetchFn: mockFetch
    });

    const mockQuote: CrossChainQuote = {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      sourceToken: usdcArb,
      destinationToken: usdcBase,
      sourceAmountRaw: '1000000000',
      destinationAmountRaw: '999500000',
      minDestinationAmountRaw: '994500000',
      bridgeFeeUSD: 0.5,
      relayerFee: '0.05%',
      gasEstimateUSD: 0.05,
      recipient: USER_ADDR,
      expiration: Date.now() + 300000,
      routeIdentifier: 'test-across',
      executionTarget: SPOKE_POOL_ARB,
      calldata: '0x1234',
      value: '0',
      approvalTarget: SPOKE_POOL_ARB,
      quoteTimestamp: Date.now(),
      estimatedTransferTimeSec: 25,
      securityRating: 'A+'
    };

    const status = await provider.getStatus('0x1111111111111111111111111111111111111111111111111111111111111111', mockQuote);
    assert.equal(status.state, 'DESTINATION_FILLED');
    assert.equal(status.destinationTxHash, '0x9999999999999999999999999999999999999999999999999999999999999999');
    assert.ok(capturedUrl?.includes('/deposit/status?originChainId=42161&depositTxHash=0x1111111111111111111111111111111111111111111111111111111111111111'));
  });

  it('14. Security: No secrets are exposed in error messages, diagnostics or endpoint logs', async () => {
    let loggedEndpoint = '';
    const mockFetch = (async () => {
      return new Response('Unauthorized', { status: 401 });
    }) as any;

    const secretKey = 'super_confidential_across_api_token_xyz987';
    const provider = new AcrossProvider({
      apiKey: secretKey,
      integratorId: '0x0001',
      fetchFn: mockFetch
    });

    const quote = await provider.getQuote({
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: usdcArb,
      tokenOut: usdcBase,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    });

    assert.ok(quote);
    const diag = quote.diagnostics?.[0];
    assert.ok(diag);
    assert.ok(!diag.message.includes(secretKey), 'Must not leak API key in diagnostic message');
    assert.ok(!quote.unexecutableReason?.includes(secretKey), 'Must not leak API key in unexecutableReason');
  });

  describe('ZENITH — Phase 3: Adversarial Regression Tests for Across Execution Gates', () => {
    // --- DEPOSITOR AND RECIPIENT GATES ---
    it('15. Adversarial: Missing depositor fails closed with ACROSS_DEPOSITOR_REQUIRED without network call', async () => {
      let fetchCalled = false;
      const mockFetch = (async () => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'ACROSS_DEPOSITOR_REQUIRED');
      assert.equal(fetchCalled, false, 'Must not dispatch network call when depositor is missing');
    });

    it('16. Adversarial: Zero-address depositor is rejected fail-closed without network call', async () => {
      let fetchCalled = false;
      const mockFetch = (async () => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: '0x0000000000000000000000000000000000000000',
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'ACROSS_DEPOSITOR_REQUIRED');
      assert.equal(fetchCalled, false, 'Must not dispatch network call for zero-address depositor');
    });

    it('17. Adversarial: SpokePool contract address as depositor is rejected fail-closed without network call', async () => {
      let fetchCalled = false;
      const mockFetch = (async () => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: SPOKE_POOL_ARB,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'ACROSS_DEPOSITOR_REQUIRED');
      assert.equal(fetchCalled, false, 'Must not substitute SpokePool contract as user depositor');
    });

    it('18. Adversarial: Missing recipient fails closed with ACROSS_RECIPIENT_REQUIRED without network call', async () => {
      let fetchCalled = false;
      const mockFetch = (async () => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'ACROSS_RECIPIENT_REQUIRED');
      assert.equal(fetchCalled, false, 'Must not dispatch network call when recipient is missing');
    });

    it('19. Adversarial: Zero-address recipient is rejected fail-closed without network call', async () => {
      let fetchCalled = false;
      const mockFetch = (async () => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: '0x0000000000000000000000000000000000000000'
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'ACROSS_RECIPIENT_REQUIRED');
      assert.equal(fetchCalled, false);
    });

    it('20. Adversarial: SpokePool contract address as recipient is rejected fail-closed without network call', async () => {
      let fetchCalled = false;
      const mockFetch = (async () => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: SPOKE_POOL_ARB
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'ACROSS_RECIPIENT_REQUIRED');
      assert.equal(fetchCalled, false, 'Must not allow contract address as destination recipient');
    });

    it('21. Valid depositor and recipient are preserved and passed strictly in request', async () => {
      let capturedUrl = '';
      const mockFetch = (async (url: any) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify({
          swapTx: {
            to: SPOKE_POOL_ARB,
            data: '0x7b9392320000000000000000000000008ba1f109551bd432803012645ac136ddd64dba72',
            value: '0',
            chainId: 42161
          },
          outputAmount: '999500000',
          quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300
        }), { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, true);
      const url = new URL(capturedUrl);
      assert.equal(url.searchParams.get('depositor')?.toLowerCase(), USER_ADDR.toLowerCase());
      assert.equal(url.searchParams.get('recipient')?.toLowerCase(), RECIPIENT_ADDR.toLowerCase());
    });

    // --- INTEGRATOR ID VALIDATION ---
    it('22. Adversarial: zenith_swap integrator ID fails closed with ACROSS_INVALID_INTEGRATOR_ID without network call', async () => {
      let fetchCalled = false;
      const mockFetch = (async () => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: 'zenith_swap',
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'ACROSS_INVALID_INTEGRATOR_ID');
      assert.equal(fetchCalled, false, 'Must not dispatch network call for zenith_swap integratorId');
    });

    it('23. Adversarial: Missing 0x prefix (0001) is rejected fail-closed without network call', async () => {
      let fetchCalled = false;
      const mockFetch = (async () => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: '0001',
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'ACROSS_INVALID_INTEGRATOR_ID');
      assert.equal(fetchCalled, false);
    });

    it('24. Adversarial: Wrong length (0x1, 0x12345) and non-hex (0xzzzz) are rejected fail-closed without network call', async () => {
      const invalidIds = ['0x1', '0x12', '0x123', '0x12345', '0xdeadbeef', '0xzzzz', '0xGG01'];

      for (const invalidId of invalidIds) {
        let fetchCalled = false;
        const mockFetch = (async () => {
          fetchCalled = true;
          return new Response('{}', { status: 200 });
        }) as any;

        const provider = new AcrossProvider({
          apiKey: MOCK_API_KEY,
          integratorId: invalidId,
          fetchFn: mockFetch
        });

        const quote = await provider.getQuote({
          sourceChainId: 'arbitrum',
          destinationChainId: 'base',
          tokenIn: usdcArb,
          tokenOut: usdcBase,
          amountInRaw: '1000000000',
          userWalletAddress: USER_ADDR,
          recipientAddress: RECIPIENT_ADDR
        });

        assert.ok(quote);
        assert.equal(quote.isExecutable, false, `Expected ${invalidId} to produce non-executable quote`);
        assert.equal(quote.unexecutableReason, 'ACROSS_INVALID_INTEGRATOR_ID');
        assert.equal(fetchCalled, false, `Expected zero network calls for invalid id: ${invalidId}`);
      }
    });

    // --- APPROVAL TRANSACTION SEQUENCE & PLAN INTEGRATION ---
    it('25. Multi-transaction approvalTxns sequence is parsed into explicit ordered plan steps', async () => {
      const tokenAddress = usdcArb.address;
      const spender1 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
      const spender2 = SPOKE_POOL_ARB;
      const calldata1 = '0x095ea7b3000000000000000000000000000000000022d473030f116ddee9f6b43ac78ba30000000000000000000000000000000000000000000000000000000000000000';
      const calldata2 = '0x095ea7b3000000000000000000000000e35e9842fceaca96570b734083f4a58e8f7c5f2affffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      const mockFetch = (async () => {
        return new Response(JSON.stringify({
          swapTx: {
            to: SPOKE_POOL_ARB,
            data: '0x7b9392320000000000000000000000008ba1f109551bd432803012645ac136ddd64dba72',
            value: '0',
            chainId: 42161
          },
          approvalTxns: [
            {
              to: tokenAddress,
              data: calldata1,
              value: '0',
              chainId: 42161,
              tokenAddress,
              spender: spender1,
              amount: '0'
            },
            {
              to: tokenAddress,
              data: calldata2,
              value: '0',
              chainId: 42161,
              tokenAddress,
              spender: spender2,
              amount: '1000000000'
            }
          ],
          outputAmount: '999500000',
          minOutputAmount: '994502500',
          quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300,
          totalRelayFee: { total: '500000', pct: '0.0005' },
          estimatedFillTimeSec: 25
        }), { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, true);
      assert.equal((quote as any).approvalTxns?.length, 2);

      const plan = ExecutionPlanBuilder.buildPlan({
        route: {
          id: 'route-multi-approval-test',
          routeType: 'CROSS_CHAIN_DIRECT',
          sourceChainId: 'arbitrum',
          destinationChainId: 'base',
          tokenIn: usdcArb,
          tokenOut: usdcBase,
          amountIn: 1000000000n,
          amountOut: 999500000n,
          minimumAmountOut: 994502500n,
          priceImpact: { percentage: 0.01 },
          estimatedGasUSD: 0.05,
          gasCostUSD: 0.05,
          executionTimeMs: 25000,
          hops: [],
          crossChainQuote: quote,
          isExecutable: true
        },
        request: {
          sourceChainId: 'arbitrum',
          destinationChainId: 'base',
          tokenIn: usdcArb,
          tokenOut: usdcBase,
          amountInRaw: '1000000000',
          userWalletAddress: USER_ADDR,
          recipientAddress: RECIPIENT_ADDR
        }
      });

      assert.ok(plan);
      const approvalSteps = plan.steps.filter((s) => s.type === 'APPROVAL');
      assert.equal(approvalSteps.length, 2, 'ExecutionPlan must contain exactly 2 distinct approval steps');

      assert.equal(approvalSteps[0].calldata, calldata1);
      assert.equal(approvalSteps[0].targetAddress.toLowerCase(), tokenAddress.toLowerCase());
      assert.equal(approvalSteps[0].approvalTarget?.toLowerCase(), spender1.toLowerCase());

      assert.equal(approvalSteps[1].calldata, calldata2);
      assert.equal(approvalSteps[1].targetAddress.toLowerCase(), tokenAddress.toLowerCase());
      assert.equal(approvalSteps[1].approvalTarget?.toLowerCase(), spender2.toLowerCase());

      // Approval 2 depends on Approval 1
      assert.ok(approvalSteps[1].dependencies.includes(approvalSteps[0].id), 'Second approval must depend on the first approval');

      // Bridge step depends on the final approval
      const bridgeStep = plan.steps.find((s) => s.type === 'BRIDGE_DEPOSIT');
      assert.ok(bridgeStep, 'Plan must contain BRIDGE_DEPOSIT step');
      assert.ok(bridgeStep.dependencies.includes(approvalSteps[1].id), 'Bridge deposit must depend on approval confirmation');
    });

    it('26. Malformed approval transaction fails closed in AcrossProvider with MALFORMED_APPROVAL_TRANSACTION', async () => {
      const mockFetch = (async () => {
        return new Response(JSON.stringify({
          swapTx: {
            to: SPOKE_POOL_ARB,
            data: '0x7b9392320000000000000000000000008ba1f109551bd432803012645ac136ddd64dba72',
            value: '0',
            chainId: 42161
          },
          approvalTxns: [
            {
              to: 'not_an_address', // malformed target
              data: '0x1234',
              value: '0',
              chainId: 42161
            }
          ],
          outputAmount: '999500000',
          quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300
        }), { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'MALFORMED_APPROVAL_TRANSACTION');
    });

    it('27. Wrong chainId on approval transaction fails closed with MALFORMED_APPROVAL_TRANSACTION', async () => {
      const mockFetch = (async () => {
        return new Response(JSON.stringify({
          swapTx: {
            to: SPOKE_POOL_ARB,
            data: '0x7b9392320000000000000000000000008ba1f109551bd432803012645ac136ddd64dba72',
            value: '0',
            chainId: 42161
          },
          approvalTxns: [
            {
              to: usdcArb.address,
              data: '0x095ea7b300000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000000',
              value: '0',
              chainId: 1 // Mismatched chainId (Ethereum instead of Arbitrum 42161)
            }
          ],
          outputAmount: '999500000',
          quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300
        }), { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'MALFORMED_APPROVAL_TRANSACTION');
    });

    it('28. Plan sealing and integrity verification pass for multi-approval plan', async () => {
      const tokenAddress = usdcArb.address;
      const spender1 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
      const spender2 = SPOKE_POOL_ARB;
      const calldata1 = '0x095ea7b3000000000000000000000000000000000022d473030f116ddee9f6b43ac78ba30000000000000000000000000000000000000000000000000000000000000000';
      const calldata2 = '0x095ea7b3000000000000000000000000e35e9842fceaca96570b734083f4a58e8f7c5f2affffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

      const mockFetch = (async () => {
        return new Response(JSON.stringify({
          swapTx: {
            to: SPOKE_POOL_ARB,
            data: '0x7b9392320000000000000000000000008ba1f109551bd432803012645ac136ddd64dba72',
            value: '0',
            chainId: 42161
          },
          approvalTxns: [
            {
              to: tokenAddress,
              data: calldata1,
              value: '0',
              chainId: 42161,
              tokenAddress,
              spender: spender1
            },
            {
              to: tokenAddress,
              data: calldata2,
              value: '0',
              chainId: 42161,
              tokenAddress,
              spender: spender2
            }
          ],
          outputAmount: '999500000',
          minOutputAmount: '994502500',
          quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300,
          totalRelayFee: { total: '500000', pct: '0.0005' },
          estimatedFillTimeSec: 25
        }), { status: 200 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      const plan = ExecutionPlanBuilder.buildPlan({
        route: {
          id: 'route-seal-test',
          routeType: 'CROSS_CHAIN_DIRECT',
          sourceChainId: 'arbitrum',
          destinationChainId: 'base',
          tokenIn: usdcArb,
          tokenOut: usdcBase,
          amountIn: 1000000000n,
          amountOut: 999500000n,
          minimumAmountOut: 994502500n,
          priceImpact: { percentage: 0.01 },
          estimatedGasUSD: 0.05,
          gasCostUSD: 0.05,
          executionTimeMs: 25000,
          hops: [],
          crossChainQuote: quote,
          isExecutable: true
        },
        request: {
          sourceChainId: 'arbitrum',
          destinationChainId: 'base',
          tokenIn: usdcArb,
          tokenOut: usdcBase,
          amountInRaw: '1000000000',
          userWalletAddress: USER_ADDR,
          recipientAddress: RECIPIENT_ADDR
        }
      });

      assert.ok(plan);
      const sealed = sealPlan(plan);
      assert.ok(sealed.planHash, 'Sealed plan must have computed planHash');
      assert.ok(sealed.integrityHash, 'Sealed plan must have computed integrityHash');
      assert.equal(sealed.planHash, sealed.integrityHash);

      // Verify assertPlanIntegrity does not throw
      assert.doesNotThrow(() => {
        assertPlanIntegrity(sealed);
      }, 'Sealed multi-approval plan must satisfy integrity validation');

      // Verify ExecutionPlanValidator accepts the plan
      assert.doesNotThrow(() => {
        ExecutionPlanValidator.validatePlan(sealed);
      }, 'Sealed plan must pass ExecutionPlanValidator');
    });

    // --- REGRESSION INVARIANTS ---
    it('29. Regression: No legacy /suggested-fees production fallback is called or supported', async () => {
      let calledSuggestedFees = false;
      let calledSwapApproval = false;

      const mockFetch = (async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/suggested-fees')) {
          calledSuggestedFees = true;
          return new Response(JSON.stringify({ relayFeePct: '0.001' }), { status: 200 });
        }
        if (urlStr.includes('/swap/approval')) {
          calledSwapApproval = true;
          return new Response(JSON.stringify({
            swapTx: {
              to: SPOKE_POOL_ARB,
              data: '0x7b9392320000000000000000000000008ba1f109551bd432803012645ac136ddd64dba72',
              value: '0',
              chainId: 42161
            },
            outputAmount: '999500000',
            quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300
          }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(calledSwapApproval, true, 'Must call /swap/approval');
      assert.equal(calledSuggestedFees, false, 'Must NEVER call deprecated /suggested-fees endpoint');
    });

    it('30. Regression: Unexecutable quote cannot be marked executable downstream', async () => {
      const mockFetch = (async () => {
        return new Response(JSON.stringify({ error: 'Deposit size exceeds liquidity' }), { status: 400 });
      }) as any;

      const provider = new AcrossProvider({
        apiKey: MOCK_API_KEY,
        integratorId: MOCK_INTEGRATOR_ID,
        fetchFn: mockFetch
      });

      const quote = await provider.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false);

      const aggregator = new CrossChainAggregator([provider]);
      const validatedQuotes = await aggregator.getQuotes({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdcArb,
        tokenOut: usdcBase,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDR,
        recipientAddress: RECIPIENT_ADDR
      });

      for (const vq of validatedQuotes) {
        if (vq.provider === 'ACROSS') {
          assert.equal(vq.isExecutable, false, 'Unexecutable Across quote must never be promoted to executable');
        }
      }
    });
  });
});

