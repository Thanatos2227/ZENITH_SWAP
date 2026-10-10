import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DEXAggregator, UniswapV3Provider } from '@zenith/routing';
import { CrossChainAggregator, AcrossProvider } from '@zenith/routing';
import { defaultTokenService } from '@zenith/tokens';
import { validateCrossChainQuoteExecutability } from '@zenith/routing';
import { Token } from '@zenith/types';

describe('ZENITH Live DEX Liquidity & Cross-Chain Execution Suite', () => {
  const isLiveTest = process.env.ZENITH_LIVE_DEX_TESTS === '1' || process.env.LIVE_RPC_TESTS === '1';
  const VALID_USER_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

  const tokens = defaultTokenService.getTokensForChain('arbitrum');
  const eth = tokens.find((t) => t.symbol === 'ETH')!;
  const wbtc = tokens.find((t) => t.symbol === 'WBTC')!;
  const gmx = tokens.find((t) => t.symbol === 'GMX')!;
  const usdc = tokens.find((t) => t.symbol === 'USDC')!;

  const baseTokens = defaultTokenService.getTokensForChain('base');
  const baseUsdc = baseTokens.find((t) => t.symbol === 'USDC')!;
  const brett = baseTokens.find((t) => t.symbol === 'BRETT') || {
    address: '0x532f27101965dd16442e59d40670faf5ebb142e4',
    symbol: 'BRETT',
    name: 'Brett',
    decimals: 18,
    chainId: 'base'
  };

  describe('1. Same-Chain Arbitrum Live Quoting Diagnostics (READ-ONLY)', () => {
    it('ETH -> WBTC on Arbitrum via Uniswap V3 returns real live quote', async () => {
      const aggregator = new DEXAggregator();
      const quote = await aggregator.getBestQuote({
        chainId: 42161,
        tokenIn: eth,
        tokenOut: wbtc,
        amountIn: 1000000000000000000n, // 1 ETH
        slippageToleranceBps: 50
      });

      assert.ok(quote !== null, 'Quote should not be null');
      assert.ok(quote.amountOut > 0n, 'Amount out should be > 0');
      assert.ok(quote.executionTarget, 'Execution target should exist');
      assert.ok(quote.approvalTarget, 'Approval target should exist');
      assert.strictEqual(quote.liquiditySource, 'LIVE_RPC');
      assert.ok(typeof quote.quoteBlockNumber === 'number' && quote.quoteBlockNumber > 0);
      assert.ok(quote.amountOut > 1000000n, 'Expected > 0.01 WBTC');
    });

    it('ETH -> GMX on Arbitrum via Uniswap V3 / Camelot returns real live quote', async () => {
      const aggregator = new DEXAggregator();
      const quote = await aggregator.getBestQuote({
        chainId: 42161,
        tokenIn: eth,
        tokenOut: gmx,
        amountIn: 1000000000000000000n, // 1 ETH
        slippageToleranceBps: 50
      });

      assert.ok(quote !== null, 'Quote should not be null');
      assert.ok(quote.amountOut > 0n, 'Amount out should be > 0');
      assert.ok(quote.executionTarget, 'Execution target should exist');
      assert.strictEqual(quote.liquiditySource, 'LIVE_RPC');
      assert.ok(quote.amountOut > 10000000000000000000n, 'Expected > 10 GMX');
    });

    it('USDC -> WBTC on Arbitrum via Uniswap V3 returns real live quote', async () => {
      const aggregator = new DEXAggregator();
      const quote = await aggregator.getBestQuote({
        chainId: 42161,
        tokenIn: usdc,
        tokenOut: wbtc,
        amountIn: 1000000000n, // 1000 USDC
        slippageToleranceBps: 50
      });

      assert.ok(quote !== null, 'Quote should not be null');
      assert.ok(quote.amountOut > 0n, 'Amount out should be > 0');
      assert.strictEqual(quote.liquiditySource, 'LIVE_RPC');
      assert.ok(quote.amountOut > 500000n, 'Expected > 0.005 WBTC');
    });

    it('USDC -> GMX on Arbitrum via Uniswap V3 / Camelot returns real live quote', async () => {
      const aggregator = new DEXAggregator();
      const quote = await aggregator.getBestQuote({
        chainId: 42161,
        tokenIn: usdc,
        tokenOut: gmx,
        amountIn: 1000000000n, // 1000 USDC
        slippageToleranceBps: 50
      });

      assert.ok(quote !== null, 'Quote should not be null');
      assert.ok(quote.amountOut > 0n, 'Amount out should be > 0');
      assert.strictEqual(quote.liquiditySource, 'LIVE_RPC');
      assert.ok(quote.amountOut > 10000000000000000000n, 'Expected > 10 GMX');
    });
  });

  describe('2. Failure Cases & Revert Handling', () => {
    it('Unsupported token / zero address gracefully returns null or unavailable', async () => {
      const provider = new UniswapV3Provider();
      const fakeToken: Token = {
        address: '0x9999999999999999999999999999999999999998',
        symbol: 'NONEXISTENT',
        name: 'Nonexistent',
        decimals: 18,
        chainId: 'arbitrum'
      };

      const quote = await provider.getQuote({
        chainId: 42161,
        tokenIn: fakeToken,
        tokenOut: wbtc,
        amountIn: 1000000000000000000n,
        slippageToleranceBps: 50
      });

      // No liquidity pool exists for fakeToken, so quote should be null
      assert.strictEqual(quote, null);
    });

    it('Zero amountIn returns null', async () => {
      const provider = new UniswapV3Provider();
      const quote = await provider.getQuote({
        chainId: 42161,
        tokenIn: eth,
        tokenOut: wbtc,
        amountIn: 0n,
        slippageToleranceBps: 50
      });

      assert.strictEqual(quote, null);
    });
  });

  describe('3. Security Invariants & Executability Barriers', () => {
    it('SIMULATION quotes MUST NEVER be marked executable in LIVE_EXECUTION mode', () => {
      const simulatedQuote = {
        provider: 'UNISWAP_V3',
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        sourceToken: eth,
        destinationToken: brett,
        sourceAmountRaw: '1000000000000000000',
        destinationAmountRaw: '500000000000000000000',
        minDestinationAmountRaw: '495000000000000000000',
        bridgeFeeUSD: 0.1,
        relayerFee: '0.05%',
        gasEstimateUSD: 0.5,
        recipient: VALID_USER_ADDRESS,
        expiration: Date.now() + 30000,
        executionTarget: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        calldata: '0x1234',
        approvalTarget: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        quoteTimestamp: Date.now(),
        securityRating: 'A+' as const,
        liquiditySource: 'SIMULATION',
        isExecutable: false,
        unexecutableReason: 'LIVE_DEX_LIQUIDITY_UNAVAILABLE: Route contains simulated DEX quote fixtures.'
      };

      const res = validateCrossChainQuoteExecutability(simulatedQuote as any, {
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: eth,
        tokenOut: brett,
        amountInRaw: '1000000000000000000',
        executionMode: 'LIVE_EXECUTION',
        userWalletAddress: VALID_USER_ADDRESS
      });

      // Must fail-closed!
      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.unexecutableReason?.includes('LIVE_DEX_LIQUIDITY_UNAVAILABLE'));
    });

    it('Expired quotes cannot execute', () => {
      const expiredQuote = {
        provider: 'ACROSS',
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        sourceToken: usdc,
        destinationToken: baseUsdc,
        sourceAmountRaw: '1000000000',
        destinationAmountRaw: '999000000',
        minDestinationAmountRaw: '995000000',
        bridgeFeeUSD: 0.1,
        relayerFee: '0.05%',
        gasEstimateUSD: 0.5,
        recipient: VALID_USER_ADDRESS,
        expiration: Date.now() - 5000, // Expired
        executionTarget: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A',
        calldata: '0x1234',
        approvalTarget: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A',
        quoteTimestamp: Date.now() - 300000,
        securityRating: 'A+' as const,
        value: '0',
        isExecutable: true
      };

      const res = validateCrossChainQuoteExecutability(expiredQuote as any, {
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: usdc,
        tokenOut: baseUsdc,
        amountInRaw: '1000000000',
        executionMode: 'READ_ONLY',
        userWalletAddress: VALID_USER_ADDRESS
      });

      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.failedGates.includes('VALID_EXPIRATION') || res.failedGates.includes('EXPIRATION_VALID'));
    });
  });

  describe('4. Cross-Chain & Composite Routing (ETH Arbitrum -> BRETT Base)', () => {
    it('Across API returns quote for USDC Arbitrum -> USDC Base (live or authenticated mock)', async () => {
      if (process.env.ACROSS_API_KEY) {
        const across = new AcrossProvider();
        const quote = await across.getQuote({
          sourceChainId: 'arbitrum',
          destinationChainId: 'base',
          tokenIn: usdc,
          tokenOut: baseUsdc,
          amountInRaw: '1000000000', // 1000 USDC
          executionMode: 'READ_ONLY',
          userWalletAddress: VALID_USER_ADDRESS,
          recipientAddress: VALID_USER_ADDRESS
        });

        assert.ok(quote !== null);
        assert.ok(BigInt(quote.destinationAmountRaw) > 990000000n);
        assert.ok(quote.executionTarget);
      } else {
        // Fail-closed verification without credentials
        const unauthAcross = new AcrossProvider();
        const unauthQuote = await unauthAcross.getQuote({
          sourceChainId: 'arbitrum',
          destinationChainId: 'base',
          tokenIn: usdc,
          tokenOut: baseUsdc,
          amountInRaw: '1000000000',
          executionMode: 'READ_ONLY',
          userWalletAddress: VALID_USER_ADDRESS,
          recipientAddress: VALID_USER_ADDRESS
        });
        assert.ok(unauthQuote !== null);
        assert.strictEqual(unauthQuote.isExecutable, false);
        assert.ok(unauthQuote.unexecutableReason?.startsWith('ACROSS_AUTH_REQUIRED'));

        // Authenticated Swap API execution verification
        const mockFetch = (async () => {
          return new Response(JSON.stringify({
            swapTx: {
              to: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
              data: '0x7b939232000000000000000000000000',
              value: '0',
              chainId: 42161
            },
            outputAmount: '999500000',
            quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300
          }), { status: 200 });
        }) as any;

        const authAcross = new AcrossProvider({
          apiKey: 'test_across_api_key',
          integratorId: '0x0001',
          fetchFn: mockFetch
        });
        const authQuote = await authAcross.getQuote({
          sourceChainId: 'arbitrum',
          destinationChainId: 'base',
          tokenIn: usdc,
          tokenOut: baseUsdc,
          amountInRaw: '1000000000',
          executionMode: 'READ_ONLY',
          userWalletAddress: VALID_USER_ADDRESS,
          recipientAddress: VALID_USER_ADDRESS
        });
        assert.ok(authQuote !== null);
        assert.ok(BigInt(authQuote.destinationAmountRaw) > 990000000n);
        assert.ok(authQuote.executionTarget);
      }
    });

    it('Composite route composition (ETH Arbitrum -> BRETT Base) chains live DEX and Bridge hops', async () => {
      const crossChainAggregator = new CrossChainAggregator();
      const connectorQuotes = await crossChainAggregator.findConnectorBridgeQuotes({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: eth,
        tokenOut: brett,
        amountInRaw: '1000000000000000000', // 1 ETH
        executionMode: isLiveTest ? 'LIVE_EXECUTION' : 'READ_ONLY',
        userWalletAddress: VALID_USER_ADDRESS
      });

      assert.ok(connectorQuotes.length > 0);
      const best = connectorQuotes[0];
      assert.ok(best !== null);
      assert.ok(best.underlyingBridgeQuote);
      assert.ok(BigInt(best.destinationAmountRaw) > 0n);

      // Verify 3-hop composite route with source and destination DEX swaps
      const threeHopRoute = connectorQuotes.find((q) => q.sourceDexQuote && q.destDexQuote);
      if (threeHopRoute) {
        assert.ok(threeHopRoute.sourceDexQuote);
        assert.ok(threeHopRoute.destDexQuote);
        assert.strictEqual(threeHopRoute.sourceDexQuote.liquiditySource, 'LIVE_RPC');
        assert.strictEqual(threeHopRoute.destDexQuote.liquiditySource, 'LIVE_RPC');
      }
    });
  });
});
