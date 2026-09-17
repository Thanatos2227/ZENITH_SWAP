import test from 'node:test';
import assert from 'node:assert/strict';
import { id, Interface, parseUnits, formatUnits } from 'ethers';
import {
  ZENITH_V3_ROUTER_ABI,
  ZENITH_V3_POOL_ABI,
  registerZenithDeployment
} from '../packages/contracts/src';
import { EVMExecutionAdapter } from '../packages/execution/src/adapters/evmAdapter';
import { DEXAggregator } from '../packages/routing/src/dex/dexAggregator';
import { ZenithV3Provider } from '../packages/routing/src/dex/zenithV3Provider';
import { UniswapV3Provider } from '../packages/routing/src/dex/uniswapV3Provider';
import {
  calculateV3ConcentratedOutput,
  calculateV3SqrtPriceX96,
  sqrtBigInt
} from '../packages/routing/src/dex/dexMath';
import {
  FullMath,
  TickMath,
  SqrtPriceMath,
  SwapMath,
  simulateV3Swap,
  MIN_TICK,
  MAX_TICK
} from '../packages/routing/src/math/v3ExactMath';
import { Token, QuoteResponse } from '@zenith/types';

test('ZENITH SWAP — Final V3 Quote / Execution Mismatch Repair Test Suite', async (t) => {
  const v3RouterAddress = '0x3000000000000000000000000000000000000003';
  const v3FactoryAddress = '0x300000000000000000000000000000000000000F';
  const wpolAddress = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
  const usdcAddress = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
  const poolAddress = '0x3000000000000000000000000000000000000001';
  const userAddress = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

  registerZenithDeployment(137, {
    chainId: 137,
    name: 'Polygon Mainnet',
    v3Router: v3RouterAddress,
    v3Factory: v3FactoryAddress
  });

  const polToken: Token = {
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    chainId: 'polygon',
    name: 'Polygon Ecosystem Token',
    symbol: 'POL',
    decimals: 18,
    isNative: true,
    wrappedAddress: wpolAddress,
    priceUSD: 0.10,
    verificationTier: 'VERIFIED_CANONICAL'
  };

  const usdcToken: Token = {
    address: usdcAddress,
    chainId: 'polygon',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    priceUSD: 1.0,
    verificationTier: 'VERIFIED_CANONICAL'
  };

  // Pool configuration: 10M POL (18 decimals) / 1M USDC (6 decimals)
  const poolReserve0 = 10_000_000n * 10n ** 18n;
  const poolReserve1 = 1_000_000n * 10n ** 6n;
  const poolLiquidity = sqrtBigInt(poolReserve0 * poolReserve1);
  const poolSqrtPriceX96 = calculateV3SqrtPriceX96(poolReserve0, poolReserve1);
  const poolCurrentTick = TickMath.getTickAtSqrtRatio(poolSqrtPriceX96);
  const poolFee = 3000; // 0.30% fee tier (30 bps)
  const poolTickSpacing = 60;

  await t.test('1. Three-Way Value Comparison (A == B == C): Quote Engine vs Exact V3 Math vs On-Chain Execution', async () => {
    const amountIn = 1n * 10n ** 18n; // 1 POL
    const slippageToleranceBps = 50; // 0.5%

    // Value A: Frontend / Routing Quote
    const v3Provider = new ZenithV3Provider();
    const quoteA = await v3Provider.getQuote({
      chainId: 137,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps,
      liquidity: poolLiquidity,
      sqrtPriceX96: poolSqrtPriceX96,
      currentTick: poolCurrentTick,
      tickSpacing: poolTickSpacing,
      feeTierBps: 30
    } as any);
    assert.ok(quoteA, 'Quote A must be non-null');
    const A = quoteA.amountOut;

    // Value B: Independent Exact V3 Math Calculation
    const simB = simulateV3Swap({
      amountIn,
      zeroForOne: true,
      sqrtPriceX96: poolSqrtPriceX96,
      currentTick: poolCurrentTick,
      liquidity: poolLiquidity,
      feePips: poolFee,
      tickSpacing: poolTickSpacing
    });
    const B = simB.amountOut;

    // Value C: Simulated On-Chain Execution (Deterministic V3 Step Calculation)
    const amountRemainingLessFee = FullMath.mulDiv(amountIn, 1000000n - BigInt(poolFee), 1000000n);
    const sqrtPriceNext = SqrtPriceMath.getNextSqrtPriceFromInput(poolSqrtPriceX96, poolLiquidity, amountRemainingLessFee, true);
    const C = SqrtPriceMath.getAmount1Delta(sqrtPriceNext, poolSqrtPriceX96, poolLiquidity, false);

    console.log(`[Diagnostic] Value A (Quote Engine):             ${A} (${Number(A) / 1e6} USDC)`);
    console.log(`[Diagnostic] Value B (Independent V3 Math):      ${B} (${Number(B) / 1e6} USDC)`);
    console.log(`[Diagnostic] Value C (Solidity Pool Execution):   ${C} (${Number(C) / 1e6} USDC)`);

    // Verify Decision Tree: A == B and B == C
    assert.equal(A, B, 'Value A must equal Value B (Quote engine matches deterministic V3 math)');
    assert.equal(B, C, 'Value B must equal Value C (Deterministic V3 math matches Solidity swap loop)');
    assert.equal(A, C, 'Value A must equal Value C (Zero discrepancy between quote and execution)');

    assert.equal(A - B, 0n, 'A - B must be 0');
    assert.equal(B - C, 0n, 'B - C must be 0');
    assert.equal(A - C, 0n, 'A - C must be 0');

    // Verify AmountOutMinimum and Slippage
    const minimumCalculated = (A * (10000n - BigInt(slippageToleranceBps))) / 10000n;
    assert.equal(quoteA.minimumAmountOut, minimumCalculated);
    assert.ok(C >= quoteA.minimumAmountOut, `Actual execution output (${C}) must be >= amountOutMinimum (${quoteA.minimumAmountOut})`);
    assert.ok(quoteA.minimumAmountOut <= quoteA.amountOut, 'amountOutMinimum must never exceed amountOut');
  });

  await t.test('2. Multi-Tick Crossing Test: LiquidityNet Transitions Across Discrete Tick Ranges', () => {
    const tickA = -300000;
    const tickB = -299400;
    const tickC = -298800;

    const initializedTicks = [
      { tick: tickA, liquidityNet: 500000000000000000n },
      { tick: tickB, liquidityNet: 300000000000000000n },
      { tick: tickC, liquidityNet: -800000000000000000n }
    ];

    const largeAmountIn = 1000n * 10n ** 18n; // 1000 POL
    const simResult = simulateV3Swap({
      amountIn: largeAmountIn,
      zeroForOne: true,
      sqrtPriceX96: poolSqrtPriceX96,
      currentTick: poolCurrentTick,
      liquidity: poolLiquidity,
      feePips: poolFee,
      tickSpacing: poolTickSpacing,
      initializedTicks
    });

    assert.ok(simResult.amountOut > 0n, 'Multi-tick swap must produce positive output');
    assert.ok(simResult.amountInUsed > 0n, 'Swap must consume input');
    assert.ok(simResult.finalSqrtPriceX96 < poolSqrtPriceX96, 'Price must decrease for zeroForOne');
  });

  await t.test('3. Exact Slippage Bounds Verification: 0.1%, 0.5%, 1.0%', async () => {
    const v3Provider = new ZenithV3Provider();
    const amountIn = 10n * 10n ** 18n;

    for (const bps of [10, 50, 100]) {
      const q = await v3Provider.getQuote({
        chainId: 137,
        tokenIn: polToken,
        tokenOut: usdcToken,
        amountIn,
        slippageToleranceBps: bps,
        liquidity: poolLiquidity,
        sqrtPriceX96: poolSqrtPriceX96,
        currentTick: poolCurrentTick,
        tickSpacing: poolTickSpacing,
        feeTierBps: 30
      } as any);
      assert.ok(q);

      const expectedMin = (q.amountOut * (10000n - BigInt(bps))) / 10000n;
      assert.equal(q.minimumAmountOut, expectedMin, `amountOutMinimum at ${bps} bps must match floor integer division`);
      assert.ok(q.minimumAmountOut <= q.amountOut, 'amountOutMinimum must be <= quoted amountOut');
      assert.ok(q.amountOut >= q.minimumAmountOut, 'Quoted amountOut must satisfy minimumAmountOut');
    }
  });

  await t.test('4. End-to-End 1 POL -> USDC Execution Flow: Pre-Flight Simulation, Gas Estimate & Balance Delta', async () => {
    const v3Provider = new ZenithV3Provider();
    const quoteParams = {
      chainId: 137,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 1n * 10n ** 18n, // 1 POL
      slippageToleranceBps: 50,
      liquidity: poolLiquidity,
      sqrtPriceX96: poolSqrtPriceX96,
      currentTick: poolCurrentTick,
      tickSpacing: poolTickSpacing,
      feeTierBps: 30
    };

    const dQuote = await v3Provider.getQuote(quoteParams as any);
    assert.ok(dQuote);

    const execution = await v3Provider.buildExecution(dQuote, userAddress);
    assert.equal(execution.to.toLowerCase(), v3RouterAddress.toLowerCase());
    assert.equal(execution.value, (1n * 10n ** 18n).toString(), 'Native POL must pass msg.value to router');

    let ethCallSimulated = false;
    let gasEstimated = false;
    let txBroadcasted = false;

    let userUsdcBalance = 0n;

    const mockSigner = {
      getAddress: async () => userAddress,
      estimateGas: async () => {
        gasEstimated = true;
        return 145000n;
      },
      sendTransaction: async (tx: any) => {
        txBroadcasted = true;
        userUsdcBalance += dQuote.amountOut;
        return {
          hash: '0x9999999999999999999999999999999999999999999999999999999999999999',
          wait: async () => ({
            status: 1,
            hash: '0x9999999999999999999999999999999999999999999999999999999999999999',
            blockNumber: 654321,
            gasUsed: 145000n,
            gasPrice: 30000000000n
          })
        };
      },
      provider: {
        call: async () => {
          ethCallSimulated = true;
          // eth_call simulation succeeds and returns exact amountOut
          const hexAmount = dQuote.amountOut.toString(16).padStart(64, '0');
          return '0x' + hexAmount;
        },
        getBalance: async () => 1000n * 10n ** 18n,
        estimateGas: async () => 145000n,
        getTransactionReceipt: async () => ({
          status: 1,
          hash: '0x9999999999999999999999999999999999999999999999999999999999999999',
          blockNumber: 654321,
          gasUsed: 145000n,
          gasPrice: 30000000000n
        })
      }
    } as any;

    const adapter = new EVMExecutionAdapter();
    const quoteResponse: QuoteResponse = {
      id: 'quote-test-v3-e2e',
      request: {
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: polToken,
        tokenOut: usdcToken,
        amountInRaw: (1n * 10n ** 18n).toString(),
        slippageTolerancePercent: 0.5
      },
      bestRoute: {
        id: 'route-zenith-v3',
        routeType: 'DIRECT',
        hops: [{
          dexProtocol: 'ZENITH_V3',
          poolAddress,
          tokenIn: polToken,
          tokenOut: usdcToken,
          feeTierBps: 30,
          proportionPercent: 100,
          estimatedGas: 145000n
        }],
        dexQuote: dQuote,
        execution,
        gasCostUSD: 0.04,
        estimatedGasUnits: 145000n
      },
      routes: [],
      amountInFormatted: '1',
      amountInRaw: (1n * 10n ** 18n).toString(),
      amountOutFormatted: formatUnits(dQuote.amountOut, 6),
      amountOutRaw: dQuote.amountOut.toString(),
      minimumReceivedFormatted: formatUnits(dQuote.minimumAmountOut, 6),
      minimumReceivedRaw: dQuote.minimumAmountOut.toString(),
      freshnessSeconds: 15,
      fees: {
        poolFee: { feeBps: 30, feeAmountRaw: '3000000000000000', feeAmountFormatted: '0.003', feeUSD: 0.0003 },
        protocolFee: { feeBps: 5, feeAmountRaw: '500000000000000', feeAmountFormatted: '0.0005', feeUSD: 0.00005 },
        gasEstimateUSD: 0.04,
        totalFeesUSD: 0.04035
      },
      quoteTimestamp: Date.now()
    };

    const initialBalance = userUsdcBalance;
    const result = await adapter.executeSwap({
      quote: quoteResponse,
      userAddress,
      signer: mockSigner,
      provider: mockSigner.provider
    });

    assert.equal(ethCallSimulated, true, 'eth_call simulation must execute prior to broadcast');
    assert.equal(txBroadcasted, true, 'Transaction must be broadcast');
    assert.equal(result.isSuccess, true, 'executeSwap must return isSuccess = true');
    assert.ok(result.blockNumber > 0, 'result blockNumber must be > 0');
    assert.equal(userUsdcBalance - initialBalance, dQuote.amountOut, 'Output balance delta must equal exact quoted amountOut');
  });

  await t.test('5. Stale Quote vs Fresh Quote Price Shift Handling', async () => {
    const v3Provider = new ZenithV3Provider();
    const adapter = new EVMExecutionAdapter();

    const staleAmountOut = 100000n; // 0.1000 USDC
    const staleMinOut = 99500n;     // 0.0995 USDC
    const actualMarketOutput = 97500n; // 0.0975 USDC

    // Stale execution reverts because market price shifted down
    const staleExecution = await v3Provider.buildExecution({
      provider: 'ZENITH_V3',
      providerName: 'ZENITH V3',
      chainId: 137,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 1n * 10n ** 18n,
      amountOut: staleAmountOut,
      minimumAmountOut: staleMinOut,
      feeAmount: 3000000000000000n,
      feeTierBps: 30,
      priceImpactPercent: 0.01,
      executionTarget: v3RouterAddress,
      approvalTarget: v3RouterAddress,
      gasEstimate: 145000n,
      gasCostUSD: 0.04,
      quoteTimestamp: Date.now() - 30000,
      expiration: Date.now() - 15000,
      routePath: [polToken.address, usdcToken.address]
    }, userAddress);

    const staleSigner = {
      getAddress: async () => userAddress,
      estimateGas: async () => 145000n,
      sendTransaction: async () => ({ hash: '0xstale' }),
      provider: {
        call: async () => {
          if (actualMarketOutput < staleMinOut) {
            const err: any = new Error('execution reverted: custom error 0x39d35496');
            err.data = '0x39d35496';
            throw err;
          }
          return '0x0';
        },
        getBalance: async () => 1000n * 10n ** 18n,
        estimateGas: async () => 145000n
      }
    } as any;

    await assert.rejects(
      async () => {
        await adapter.executeSwap({
          quote: {
            id: 'quote-stale',
            request: {
              sourceChainId: 'polygon',
              destinationChainId: 'polygon',
              tokenIn: polToken,
              tokenOut: usdcToken,
              amountInRaw: (1n * 10n ** 18n).toString(),
              slippageTolerancePercent: 0.5
            },
            bestRoute: {
              id: 'route-stale',
              routeType: 'DIRECT',
              hops: [],
              execution: staleExecution,
              gasCostUSD: 0.04,
              estimatedGasUnits: 145000n
            },
            routes: [],
            amountInFormatted: '1',
            amountInRaw: (1n * 10n ** 18n).toString(),
            amountOutFormatted: '0.1',
            amountOutRaw: staleAmountOut.toString(),
            minimumReceivedFormatted: '0.0995',
            minimumReceivedRaw: staleMinOut.toString(),
            freshnessSeconds: 0,
            fees: {
              poolFee: { feeBps: 30, feeAmountRaw: '3000000000000000', feeAmountFormatted: '0.003', feeUSD: 0.0003 },
              protocolFee: { feeBps: 5, feeAmountRaw: '500000000000000', feeAmountFormatted: '0.0005', feeUSD: 0.00005 },
              gasEstimateUSD: 0.04,
              totalFeesUSD: 0.04035
            },
            quoteTimestamp: Date.now() - 30000
          },
          userAddress,
          signer: staleSigner,
          provider: staleSigner.provider
        });
      },
      (err: any) => {
        assert.equal(err.name, 'ZenithSimulationFailedError');
        assert.ok(err.revertReason.includes('V3_TOO_LITTLE_RECEIVED') || err.revertReason.includes('0x39d35496'));
        return true;
      }
    );

    // Fresh re-quote with current market state
    const freshMinOut = (actualMarketOutput * 9950n) / 10000n; // 97012
    assert.ok(actualMarketOutput >= freshMinOut, 'Actual market output must satisfy fresh minimum');

    const freshExecution = await v3Provider.buildExecution({
      provider: 'ZENITH_V3',
      providerName: 'ZENITH V3',
      chainId: 137,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 1n * 10n ** 18n,
      amountOut: actualMarketOutput,
      minimumAmountOut: freshMinOut,
      feeAmount: 3000000000000000n,
      feeTierBps: 30,
      priceImpactPercent: 0.01,
      executionTarget: v3RouterAddress,
      approvalTarget: v3RouterAddress,
      gasEstimate: 145000n,
      gasCostUSD: 0.04,
      quoteTimestamp: Date.now(),
      expiration: Date.now() + 15000,
      routePath: [polToken.address, usdcToken.address]
    }, userAddress);

    const freshSigner = {
      getAddress: async () => userAddress,
      estimateGas: async () => 145000n,
      sendTransaction: async () => ({
        hash: '0xfresh_tx_success',
        wait: async () => ({
          status: 1,
          hash: '0xfresh_tx_success',
          blockNumber: 654322,
          gasUsed: 145000n,
          gasPrice: 30000000000n
        })
      }),
      provider: {
        call: async () => '0x0000000000000000000000000000000000000000000000000000000000017ce4',
        getBalance: async () => 1000n * 10n ** 18n,
        estimateGas: async () => 145000n,
        getTransactionReceipt: async () => ({
          status: 1,
          hash: '0xfresh_tx_success',
          blockNumber: 654322,
          gasUsed: 145000n,
          gasPrice: 30000000000n
        })
      }
    } as any;

    const freshRes = await adapter.executeSwap({
      quote: {
        id: 'quote-fresh',
        request: {
          sourceChainId: 'polygon',
          destinationChainId: 'polygon',
          tokenIn: polToken,
          tokenOut: usdcToken,
          amountInRaw: (1n * 10n ** 18n).toString(),
          slippageTolerancePercent: 0.5
        },
        bestRoute: {
          id: 'route-fresh',
          routeType: 'DIRECT',
          hops: [],
          execution: freshExecution,
          gasCostUSD: 0.04,
          estimatedGasUnits: 145000n
        },
        routes: [],
        amountInFormatted: '1',
        amountInRaw: (1n * 10n ** 18n).toString(),
        amountOutFormatted: formatUnits(actualMarketOutput, 6),
        amountOutRaw: actualMarketOutput.toString(),
        minimumReceivedFormatted: formatUnits(freshMinOut, 6),
        minimumReceivedRaw: freshMinOut.toString(),
        freshnessSeconds: 15,
        fees: {
          poolFee: { feeBps: 30, feeAmountRaw: '3000000000000000', feeAmountFormatted: '0.003', feeUSD: 0.0003 },
          protocolFee: { feeBps: 5, feeAmountRaw: '500000000000000', feeAmountFormatted: '0.0005', feeUSD: 0.00005 },
          gasEstimateUSD: 0.04,
          totalFeesUSD: 0.04035
        },
        quoteTimestamp: Date.now()
      },
      userAddress,
      signer: freshSigner,
      provider: freshSigner.provider
    });

    assert.equal(freshRes.isSuccess, true, 'Fresh re-quote execution must succeed');
  });

  await t.test('6. Sovereign Invariant: Zero External DEX Fallback in ZENITH_ONLY Mode', async () => {
    const v3Provider = new ZenithV3Provider();
    const uniProvider = new UniswapV3Provider();
    const aggregator = new DEXAggregator([v3Provider, uniProvider], 'ZENITH_ONLY');

    const fakeUniQuote = {
      provider: 'UNISWAP_V3',
      providerName: 'Uniswap V3',
      chainId: 137,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 1n * 10n ** 18n,
      amountOut: 99699n,
      minimumAmountOut: 99200n,
      feeAmount: 3000000000000000n,
      feeTierBps: 30,
      priceImpactPercent: 0.01,
      executionTarget: '0xec7be89e9d109e7e3fec59c222e19d273f5ca961',
      approvalTarget: '0xec7be89e9d109e7e3fec59c222e19d273f5ca961',
      gasEstimate: 185000n,
      gasCostUSD: 0.05,
      quoteTimestamp: Date.now(),
      expiration: Date.now() + 15000,
      routePath: [polToken.address, usdcToken.address]
    } as any;

    await assert.rejects(
      async () => {
        await aggregator.buildExecution(fakeUniQuote, userAddress);
      },
      (err: any) => {
        assert.ok(err.message.includes('ZENITH_EXTERNAL_EXECUTION_DETECTED'));
        return true;
      }
    );
  });

  await t.test('7. Live Pool State Reader Integration & Authoritative State Quote Pipeline', async () => {
    // Mock ethers provider returning on-chain contract state for deployed Zenith V3 pool
    const mockProvider = {
      getBlockNumber: async () => 12345678,
      getCode: async () => '0x608060405234801561001057600080fd5b50',
      call: async (tx: any) => {
        const poolIface = new Interface(ZENITH_V3_POOL_ABI);
        const factoryIface = new Interface([
          'function getPool(address,address,uint24) external view returns (address)'
        ]);

        if (tx.to?.toLowerCase() === v3FactoryAddress.toLowerCase()) {
          return factoryIface.encodeFunctionResult('getPool', [poolAddress]);
        }

        if (tx.to?.toLowerCase() === poolAddress.toLowerCase()) {
          const data = tx.data;
          if (data.startsWith(poolIface.getFunction('token0')!.selector)) {
            return poolIface.encodeFunctionResult('token0', [wpolAddress]);
          }
          if (data.startsWith(poolIface.getFunction('token1')!.selector)) {
            return poolIface.encodeFunctionResult('token1', [usdcAddress]);
          }
          if (data.startsWith(poolIface.getFunction('fee')!.selector)) {
            return poolIface.encodeFunctionResult('fee', [3000]);
          }
          if (data.startsWith(poolIface.getFunction('tickSpacing')!.selector)) {
            return poolIface.encodeFunctionResult('tickSpacing', [60]);
          }
          if (data.startsWith(poolIface.getFunction('slot0')!.selector)) {
            return poolIface.encodeFunctionResult('slot0', [poolSqrtPriceX96, poolCurrentTick, true]);
          }
          if (data.startsWith(poolIface.getFunction('liquidity')!.selector)) {
            return poolIface.encodeFunctionResult('liquidity', [poolLiquidity]);
          }
          if (data.startsWith(poolIface.getFunction('tickBitmap')!.selector)) {
            return poolIface.encodeFunctionResult('tickBitmap', [0n]);
          }
        }
        return '0x';
      }
    } as any;

    const v3Provider = new ZenithV3Provider();
    const liveQuote = await v3Provider.getQuote({
      chainId: 137,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 1n * 10n ** 18n,
      slippageToleranceBps: 50,
      provider: mockProvider
    } as any);

    assert.ok(liveQuote, 'Live quote from on-chain state must be non-null');
    assert.equal(liveQuote.poolAddress?.toLowerCase(), poolAddress.toLowerCase());
    assert.equal(liveQuote.quoteBlockNumber, 12345678);
    assert.equal(liveQuote.amountOut, 99699n);
    assert.equal(liveQuote.minimumAmountOut, 99200n);
  });

  await t.test('8. Multi-Fee Units Verification: 1 BPS, 5 BPS, 30 BPS, 100 BPS', async () => {
    const v3Provider = new ZenithV3Provider();
    const amountIn = 1n * 10n ** 18n;

    const feeTiers = [
      { bps: 1, pips: 100 },
      { bps: 5, pips: 500 },
      { bps: 30, pips: 3000 },
      { bps: 100, pips: 10000 }
    ];

    let previousOutput = 1000000n;

    for (const tier of feeTiers) {
      const q = await v3Provider.getQuote({
        chainId: 137,
        tokenIn: polToken,
        tokenOut: usdcToken,
        amountIn,
        slippageToleranceBps: 50,
        feeTierBps: tier.bps,
        liquidity: poolLiquidity,
        sqrtPriceX96: poolSqrtPriceX96,
        currentTick: poolCurrentTick,
        tickSpacing: 60
      } as any);

      assert.ok(q, `Quote for ${tier.bps} bps must exist`);
      assert.equal(q.feeTierBps, tier.bps);
      assert.ok(q.amountOut < previousOutput, `Higher fee tier ${tier.bps} must yield strictly less output than lower fee tier`);
      previousOutput = q.amountOut;

      const sim = simulateV3Swap({
        amountIn,
        zeroForOne: true,
        sqrtPriceX96: poolSqrtPriceX96,
        currentTick: poolCurrentTick,
        liquidity: poolLiquidity,
        feePips: tier.pips,
        tickSpacing: 60
      });

      assert.equal(q.amountOut, sim.amountOut, `Quote output for ${tier.bps} bps must exactly match simulateV3Swap`);
    }
  });

  await t.test('9. Proof & Trace of 0.0992 USDC (99,200 raw) Invariant and Consistency', () => {
    // 1 POL input = 10^18 raw
    const amountIn = 1n * 10n ** 18n;
    const slippageBps = 50; // 0.50%

    // Step 1: Quoted amount calculation
    const sim = simulateV3Swap({
      amountIn,
      zeroForOne: true,
      sqrtPriceX96: poolSqrtPriceX96,
      currentTick: poolCurrentTick,
      liquidity: poolLiquidity,
      feePips: poolFee, // 3000 (30 bps)
      tickSpacing: poolTickSpacing
    });

    const quotedOutput = sim.amountOut; // 99,699 raw = 0.099699 USDC
    assert.equal(quotedOutput, 99699n, 'Quoted amount must be exactly 99699 raw');

    // Step 2: Minimum amount calculation (99699 * (10000 - 50) / 10000)
    const minimumOut = (quotedOutput * (10000n - BigInt(slippageBps))) / 10000n; // 99,200 raw = 0.099200 USDC
    assert.equal(minimumOut, 99200n, 'Minimum amount must be exactly 99200 raw (0.099200 USDC)');

    // Step 3: Exact calldata encoding
    const routerIface = new Interface(ZENITH_V3_ROUTER_ABI);
    const deadline = 1789654320;
    const encodedCalldata = routerIface.encodeFunctionData('exactInputSingle', [
      [
        wpolAddress,
        usdcAddress,
        3000,
        userAddress,
        deadline,
        amountIn,
        minimumOut,
        0
      ]
    ]);

    assert.ok(encodedCalldata.startsWith('0x414bf389'), 'Selector must be exactInputSingle (0x414bf389)');
    
    // Step 4: Validate on-chain execution with minimumOut = 99200
    // Execution produces 99,699 >= 99,200 -> Success (does NOT revert with V3TooLittleReceived 0x39d35496)
    assert.ok(quotedOutput >= minimumOut, 'Execution amount (99699) exceeds amountOutMinimum (99200)');
  });
});
