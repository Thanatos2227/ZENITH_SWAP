import test from 'node:test';
import assert from 'node:assert/strict';
import { id, Interface, AbiCoder, parseUnits, formatUnits } from 'ethers';
import {
  ZENITH_V3_ROUTER_ABI,
  ZENITH_V3_POOL_ABI,
  registerZenithDeployment
} from '../packages/contracts/src';
import { EVMExecutionAdapter, decodeRevertReason, KNOWN_REVERT_ERRORS } from '../packages/execution/src/adapters/evmAdapter';
import { DEXAggregator } from '../packages/routing/src/dex/dexAggregator';
import { ZenithV3Provider } from '../packages/routing/src/dex/zenithV3Provider';
import { UniswapV3Provider } from '../packages/routing/src/dex/uniswapV3Provider';
import { QuickSwapProvider } from '../packages/routing/src/dex/quickswapProvider';
import { calculateDEXLiquidityOutput } from '../packages/routing/src/dex/dexMath';
import { Token, QuoteResponse } from '@zenith/types';

test('ZENITH SWAP — V3TooLittleReceived (0x39d35496) Root-Cause Repair Test Suite', async (t) => {
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

  await t.test('1. Exact Error Selector Identity: V3TooLittleReceived() == 0x39d35496', () => {
    const expectedSelector = '0x39d35496';
    const computedHash = id('V3TooLittleReceived()').slice(0, 10);
    assert.equal(computedHash, expectedSelector, 'keccak256("V3TooLittleReceived()") must match 0x39d35496');

    const decoded = decodeRevertReason(expectedSelector);
    assert.ok(decoded.includes('V3_TOO_LITTLE_RECEIVED'), 'Decoded reason must identify V3_TOO_LITTLE_RECEIVED');
    assert.ok(decoded.includes('slippage limit exceeded'), 'Decoded reason must mention slippage limit exceeded');
  });

  await t.test('2. ZenithV3Router ABI Encodes Custom Error V3TooLittleReceived()', () => {
    const routerIface = new Interface(ZENITH_V3_ROUTER_ABI);
    const errorFragment = routerIface.getError('V3TooLittleReceived');
    assert.ok(errorFragment, 'ZenithV3Router ABI must declare error V3TooLittleReceived()');
    assert.equal(errorFragment.selector, '0x39d35496');
  });

  await t.test('3. Pre-Flight eth_call Simulation: Catches 0x39d35496 and Prevents MetaMask Popup', async () => {
    const v3Provider = new ZenithV3Provider();
    const quoteParams = {
      chainId: 137,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 100n * 10n ** 18n, // 100 POL
      slippageToleranceBps: 50 // 0.5%
    };

    const dQuote = await v3Provider.getQuote(quoteParams);
    assert.ok(dQuote);

    const execution = await v3Provider.buildExecution(dQuote, userAddress);
    assert.equal(execution.to.toLowerCase(), v3RouterAddress.toLowerCase());

    const quoteResponse: QuoteResponse = {
      id: 'quote-test-v3-revert',
      request: {
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: polToken,
        tokenOut: usdcToken,
        amountInRaw: (100n * 10n ** 18n).toString(),
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
      amountInFormatted: '100',
      amountInRaw: (100n * 10n ** 18n).toString(),
      amountOutFormatted: '9.9699',
      amountOutRaw: dQuote.amountOut.toString(),
      minimumReceivedFormatted: '9.92005',
      minimumReceivedRaw: dQuote.minimumAmountOut.toString(),
      freshnessSeconds: 15,
      fees: {
        poolFee: { feeBps: 30, feeAmountRaw: '300000000000000000', feeAmountFormatted: '0.3', feeUSD: 0.03 },
        protocolFee: { feeBps: 5, feeAmountRaw: '50000000000000000', feeAmountFormatted: '0.05', feeUSD: 0.005 },
        gasEstimateUSD: 0.04,
        totalFeesUSD: 0.075
      },
      quoteTimestamp: Date.now()
    };

    let walletPopupInvoked = false;
    const mockSigner = {
      getAddress: async () => userAddress,
      estimateGas: async () => 145000n,
      sendTransaction: async (_tx: any) => {
        walletPopupInvoked = true;
        return { hash: '0xabc' };
      },
      provider: {
        call: async () => {
          // Simulate on-chain contract revert with 0x39d35496 (V3TooLittleReceived)
          const err: any = new Error('execution reverted: custom error 0x39d35496');
          err.data = '0x39d35496';
          throw err;
        },
        getBalance: async () => 1000n * 10n ** 18n,
        estimateGas: async () => 145000n
      }
    } as any;

    const adapter = new EVMExecutionAdapter();

    await assert.rejects(
      async () => {
        await adapter.executeSwap({
          quote: quoteResponse,
          userAddress,
          signer: mockSigner,
          provider: mockSigner.provider
        });
      },
      (err: any) => {
        assert.equal(err.name, 'ZenithSimulationFailedError');
        assert.ok(err.revertReason.includes('V3_TOO_LITTLE_RECEIVED') || err.revertReason.includes('0x39d35496'));
        return true;
      }
    );

    assert.equal(walletPopupInvoked, false, 'MetaMask popup must NEVER be invoked when pre-flight simulation reverts with 0x39d35496');
  });

  await t.test('4. Price Shift Scenario: Stale Quote Fails Closed -> Fresh Quote Succeeds', async () => {
    const v3Provider = new ZenithV3Provider();
    const adapter = new EVMExecutionAdapter();

    // Step A: Stale quote with overly optimistic minimum output
    const staleQuoteAmountOut = 10000000n; // 10.0 USDC
    const staleMinAmountOut = 9950000n;   // 9.95 USDC
    const actualPoolOutput = 9800000n;    // 9.80 USDC produced on-chain after price move

    const execution = await v3Provider.buildExecution({
      provider: 'ZENITH_V3',
      providerName: 'ZENITH V3',
      chainId: 137,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 100n * 10n ** 18n,
      amountOut: staleQuoteAmountOut,
      minimumAmountOut: staleMinAmountOut,
      feeAmount: 300000000000000000n,
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

    const staleQuoteResponse: QuoteResponse = {
      id: 'quote-stale',
      request: {
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: polToken,
        tokenOut: usdcToken,
        amountInRaw: (100n * 10n ** 18n).toString(),
        slippageTolerancePercent: 0.5
      },
      bestRoute: {
        id: 'route-stale',
        routeType: 'DIRECT',
        hops: [],
        execution,
        gasCostUSD: 0.04,
        estimatedGasUnits: 145000n
      },
      routes: [],
      amountInFormatted: '100',
      amountInRaw: (100n * 10n ** 18n).toString(),
      amountOutFormatted: '10.0',
      amountOutRaw: staleQuoteAmountOut.toString(),
      minimumReceivedFormatted: '9.95',
      minimumReceivedRaw: staleMinAmountOut.toString(),
      freshnessSeconds: 0,
      fees: {
        poolFee: { feeBps: 30, feeAmountRaw: '300000000000000000', feeAmountFormatted: '0.3', feeUSD: 0.03 },
        protocolFee: { feeBps: 5, feeAmountRaw: '50000000000000000', feeAmountFormatted: '0.05', feeUSD: 0.005 },
        gasEstimateUSD: 0.04,
        totalFeesUSD: 0.075
      },
      quoteTimestamp: Date.now() - 30000
    };

    // Stale simulation reverts because actualPoolOutput (9.80) < staleMinAmountOut (9.95)
    let staleSimulationReverted = false;
    const staleSigner = {
      getAddress: async () => userAddress,
      estimateGas: async () => 145000n,
      sendTransaction: async () => ({ hash: '0xstale' }),
      provider: {
        call: async () => {
          if (actualPoolOutput < staleMinAmountOut) {
            const err: any = new Error('execution reverted: custom error 0x39d35496');
            err.data = '0x39d35496';
            throw err;
          }
          return '0x0000000000000000000000000000000000000000000000000000000000958a00';
        },
        getBalance: async () => 1000n * 10n ** 18n,
        estimateGas: async () => 145000n
      }
    } as any;

    try {
      await adapter.executeSwap({
        quote: staleQuoteResponse,
        userAddress,
        signer: staleSigner,
        provider: staleSigner.provider
      });
    } catch (err: any) {
      staleSimulationReverted = true;
      assert.equal(err.name, 'ZenithSimulationFailedError');
      assert.ok(err.revertReason.includes('V3_TOO_LITTLE_RECEIVED') || err.revertReason.includes('0x39d35496'));
    }
    assert.equal(staleSimulationReverted, true, 'Stale quote must fail closed on 0x39d35496 revert');

    // Step B: Re-quote with fresh market pool state -> Fresh simulation succeeds
    const freshMinAmountOut = (actualPoolOutput * 9950n) / 10000n; // 9.751 USDC
    assert.ok(actualPoolOutput >= freshMinAmountOut, 'Actual output must satisfy freshly quoted minimum');

    const freshExecution = await v3Provider.buildExecution({
      provider: 'ZENITH_V3',
      providerName: 'ZENITH V3',
      chainId: 137,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 100n * 10n ** 18n,
      amountOut: actualPoolOutput,
      minimumAmountOut: freshMinAmountOut,
      feeAmount: 300000000000000000n,
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

    const freshQuoteResponse: QuoteResponse = {
      ...staleQuoteResponse,
      id: 'quote-fresh',
      amountOutRaw: actualPoolOutput.toString(),
      minimumReceivedRaw: freshMinAmountOut.toString(),
      bestRoute: {
        ...staleQuoteResponse.bestRoute,
        execution: freshExecution
      }
    };

    let freshTxSent = false;
    const freshSigner = {
      getAddress: async () => userAddress,
      estimateGas: async () => 145000n,
      sendTransaction: async (_tx: any) => {
        freshTxSent = true;
        return {
          hash: '0xfresh1234567890abcdef',
          wait: async () => ({
            status: 1,
            hash: '0xfresh1234567890abcdef',
            blockNumber: 123456,
            gasUsed: 145000n,
            gasPrice: 30000000000n
          })
        };
      },
      provider: {
        call: async () => '0x0000000000000000000000000000000000000000000000000000000000958a00',
        getBalance: async () => 1000n * 10n ** 18n,
        estimateGas: async () => 145000n,
        getTransactionReceipt: async () => ({
          status: 1,
          hash: '0xfresh1234567890abcdef',
          blockNumber: 123456,
          gasUsed: 145000n,
          gasPrice: 30000000000n
        })
      }
    } as any;

    const res = await adapter.executeSwap({
      quote: freshQuoteResponse,
      userAddress,
      signer: freshSigner,
      provider: freshSigner.provider
    });

    assert.equal(res.isSuccess, true);
    assert.equal(freshTxSent, true, 'Fresh quote must execute successfully without 0x39d35496 revert');
  });

  await t.test('5. Sovereign Invariant: ZENITH_ONLY Mode Strictly Prohibits External DEX Execution', async () => {
    const v3Provider = new ZenithV3Provider();
    const uniProvider = new UniswapV3Provider();
    const quickProvider = new QuickSwapProvider();

    const aggregator = new DEXAggregator([v3Provider, uniProvider, quickProvider], 'ZENITH_ONLY');

    const fakeExternalQuote = {
      provider: 'UNISWAP_V3',
      providerName: 'Uniswap V3',
      chainId: 137,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 100n * 10n ** 18n,
      amountOut: 9969900n,
      minimumAmountOut: 9920000n,
      feeAmount: 300000000000000000n,
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
        await aggregator.buildExecution(fakeExternalQuote, userAddress);
      },
      (err: any) => {
        assert.ok(err.message.includes('ZENITH_EXTERNAL_EXECUTION_DETECTED'));
        assert.ok(err.message.includes('strictly prohibited'));
        return true;
      }
    );
  });

  await t.test('6. Full Acceptance: Native POL -> WPOL -> Zenith V3 -> USDC Swap Flow Verification', async () => {
    const v3Provider = new ZenithV3Provider();
    const dQuote = await v3Provider.getQuote({
      chainId: 137,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 1n * 10n ** 18n, // 1 POL
      slippageToleranceBps: 50
    });

    assert.ok(dQuote);
    assert.equal(dQuote.provider, 'ZENITH_V3');
    assert.equal(dQuote.amountIn, 1n * 10n ** 18n);
    assert.ok(dQuote.amountOut > 0n);
    assert.ok(dQuote.minimumAmountOut > 0n);
    assert.ok(dQuote.minimumAmountOut <= dQuote.amountOut);

    const execution = await v3Provider.buildExecution(dQuote, userAddress);
    assert.equal(execution.to.toLowerCase(), v3RouterAddress.toLowerCase());
    assert.equal(execution.value, (1n * 10n ** 18n).toString(), 'Native POL must pass msg.value to router');

    // Decode exactInputSingle params from calldata
    const routerIface = new Interface(ZENITH_V3_ROUTER_ABI);
    const parsed = routerIface.parseTransaction({ data: execution.data, value: execution.value });
    assert.ok(parsed);
    assert.equal(parsed.name, 'exactInputSingle');

    const [params] = parsed.args;
    assert.equal(params.tokenIn.toLowerCase(), wpolAddress.toLowerCase(), 'tokenIn at V3 level must be WPOL');
    assert.equal(params.tokenOut.toLowerCase(), usdcAddress.toLowerCase(), 'tokenOut must be USDC');
    assert.equal(params.recipient.toLowerCase(), userAddress.toLowerCase(), 'recipient must be userAddress');
    assert.equal(params.amountIn, 1n * 10n ** 18n);
    assert.equal(params.amountOutMinimum, dQuote.minimumAmountOut);
    assert.equal(params.sqrtPriceLimitX96, 0n);
  });
});
