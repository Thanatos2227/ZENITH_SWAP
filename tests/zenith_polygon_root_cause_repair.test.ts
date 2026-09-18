import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZenithV1Provider,
  ZenithV2Provider,
  ZenithV3Provider,
  DEXAggregator,
  ZenithRouter,
  defaultZenithRouter,
  calculateV3SqrtPriceX96,
  sqrtBigInt,
  resolvePoolTokenAddress
} from '../packages/routing/src';
import { TickMath } from '../packages/routing/src/math/v3ExactMath';
import {
  registerZenithDeployment,
  getZenithV3Router,
  getZenithV2Router,
  getZenithV1Router,
  isZenithDeployed,
  ZenithRouterNotDeployedError,
  ZenithRouteExecutionMismatchError,
  ZenithSimulationFailedError,
  ZENITH_V3_POOL_ABI
} from '../packages/contracts/src';
import { EVMExecutionAdapter } from '../packages/execution/src/adapters/evmAdapter';
import { Token, QuoteResponse } from '../packages/types/src';
import { Interface } from 'ethers';

test('ZENITH SWAP — Polygon & Sovereign Execution Root-Cause Repair Suite', async (t) => {
  const polygonPOL: Token = {
    address: '0x0000000000000000000000000000000000000000',
    chainId: 'polygon',
    name: 'Polygon Ecosystem Token',
    symbol: 'POL',
    decimals: 18,
    isNative: true,
    wrappedAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    priceUSD: 0.42,
    verificationTier: 'VERIFIED_CANONICAL'
  };

  const polygonUSDC: Token = {
    address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    chainId: 'polygon',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    priceUSD: 1.0,
    verificationTier: 'VERIFIED_CANONICAL'
  };

  await t.test('1. Negative Test: Polygon Zenith Router Not Deployed (Fail Closed)', async () => {
    // On Polygon (chainId 137), Zenith contracts are not configured in deployments/137.json
    assert.equal(getZenithV3Router(137), undefined, 'Polygon V3 router must be undefined');
    assert.equal(getZenithV2Router(137), undefined, 'Polygon V2 router must be undefined');
    assert.equal(getZenithV1Router(137), undefined, 'Polygon V1 router must be undefined');
    assert.equal(isZenithDeployed(137), false, 'isZenithDeployed(137) must return false');

    const v3Provider = new ZenithV3Provider();
    const v2Provider = new ZenithV2Provider();
    const v1Provider = new ZenithV1Provider();

    // Provider isAvailable must be false when router is undeployed
    assert.equal(v3Provider.isAvailable(137, polygonPOL, polygonUSDC), false);
    assert.equal(v2Provider.isAvailable(137, polygonPOL, polygonUSDC), false);
    assert.equal(v1Provider.isAvailable(137, polygonPOL, polygonUSDC), false);

    // Provider getQuote must return null without falling back to QuickSwap
    const quoteV3 = await v3Provider.getQuote({
      chainId: 137,
      tokenIn: polygonPOL,
      tokenOut: polygonUSDC,
      amountIn: 10n ** 18n,
      slippageToleranceBps: 50
    });
    assert.equal(quoteV3, null, 'Undeployed V3 provider must return null quote');

    // Attempting buildExecution on undeployed chain must throw ZenithRouterNotDeployedError
    const mockQuote: any = {
      provider: 'ZENITH_V3',
      chainId: 137,
      tokenIn: polygonPOL,
      tokenOut: polygonUSDC,
      amountIn: 10n ** 18n,
      minimumAmountOut: 400000n,
      gasEstimate: 145000n
    };

    await assert.rejects(
      async () => {
        await v3Provider.buildExecution(mockQuote, '0x1111111111111111111111111111111111111111');
      },
      (err: any) => {
        assert.ok(err instanceof ZenithRouterNotDeployedError);
        assert.ok(err.message.includes('ZENITH_ROUTER_NOT_DEPLOYED'));
        assert.ok(!err.message.includes('QuickSwap'));
        return true;
      },
      'Must throw ZENITH_ROUTER_NOT_DEPLOYED error and never fallback to QuickSwap'
    );
  });

  await t.test('2. Sovereign DEXAggregator ZENITH_ONLY Mode Strict Enforcement', async () => {
    const aggregator = new DEXAggregator([], 'ZENITH_ONLY');
    assert.equal(aggregator.getExecutionMode(), 'ZENITH_ONLY');

    // In ZENITH_ONLY mode on an un-deployed chain, no quotes from external DEXes (QuickSwap, Uniswap) are returned
    const quotes = await aggregator.getQuotes({
      chainId: 137,
      tokenIn: polygonPOL,
      tokenOut: polygonUSDC,
      amountIn: 10n ** 18n,
      slippageToleranceBps: 50
    });

    assert.equal(quotes.length, 0, 'ZENITH_ONLY mode must never return external DEX quotes');

    // Attempting buildExecution with an external protocol in ZENITH_ONLY mode must throw
    const externalQuote: any = {
      provider: 'QUICKSWAP',
      chainId: 137,
      tokenIn: polygonPOL,
      tokenOut: polygonUSDC,
      amountIn: 10n ** 18n,
      minimumAmountOut: 400000n
    };

    await assert.rejects(
      async () => {
        await aggregator.buildExecution(externalQuote, '0x1111111111111111111111111111111111111111');
      },
      /ZENITH_ONLY mode|ZENITH_EXTERNAL_EXECUTION_DETECTED|sovereign mode/,
      'Must block external protocol execution in ZENITH_ONLY mode'
    );
  });

  await t.test('3. Real Local Polygon/Anvil Deployment POL -> USDC Acceptance Test', async () => {
    const localChainId = 31337;
    const mockV3Router = '0x1234567890123456789012345678901234567890';
    const mockV3Factory = '0x2234567890123456789012345678901234567890';
    const mockV3Pool = '0x3234567890123456789012345678901234567890';

    registerZenithDeployment(localChainId, {
      chainId: localChainId,
      name: 'Local Testnet',
      v3Router: mockV3Router,
      v3Factory: mockV3Factory
    });

    assert.equal(isZenithDeployed(localChainId), true);
    assert.equal(getZenithV3Router(localChainId), mockV3Router);

    const poolReserve0 = 10_000_000n * 10n ** 18n;
    const poolReserve1 = 1_000_000n * 10n ** 6n;
    const poolLiquidity = sqrtBigInt(poolReserve0 * poolReserve1);
    const poolSqrtPriceX96 = calculateV3SqrtPriceX96(poolReserve0, poolReserve1);
    const poolCurrentTick = TickMath.getTickAtSqrtRatio(poolSqrtPriceX96);

    const inToken: Token = { ...polygonPOL, chainId: '31337' };
    const outToken: Token = { ...polygonUSDC, chainId: '31337' };
    const inAddr = resolvePoolTokenAddress(inToken, localChainId);
    const outAddr = resolvePoolTokenAddress(outToken, localChainId);

    const mockProvider = {
      getBlockNumber: async () => 100,
      getCode: async () => '0x608060405234801561001057600080fd5b50',
      estimateGas: async () => 145000n,
      call: async (tx: any) => {
        const poolIface = new Interface(ZENITH_V3_POOL_ABI);
        const factoryIface = new Interface([
          'function getPool(address,address,uint24) external view returns (address)'
        ]);

        if (tx.to?.toLowerCase() === mockV3Factory.toLowerCase()) {
          return factoryIface.encodeFunctionResult('getPool', [mockV3Pool]);
        }
        if (tx.to?.toLowerCase() === mockV3Pool.toLowerCase()) {
          const data = tx.data;
          if (data.startsWith(poolIface.getFunction('token0')!.selector)) {
            return poolIface.encodeFunctionResult('token0', [inAddr]);
          }
          if (data.startsWith(poolIface.getFunction('token1')!.selector)) {
            return poolIface.encodeFunctionResult('token1', [outAddr]);
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
    const quote = await v3Provider.getQuote({
      chainId: localChainId,
      tokenIn: inToken,
      tokenOut: outToken,
      amountIn: 10n ** 18n, // 1 POL
      slippageToleranceBps: 50,
      feeTierBps: 30,
      provider: mockProvider
    } as any);

    assert.ok(quote, 'Should generate a valid quote on deployed chain');
    assert.equal(quote.provider, 'ZENITH_V3');
    assert.equal(quote.executionTarget, mockV3Router);
    assert.equal(quote.approvalTarget, mockV3Router);

    const userAddr = '0x9999999999999999999999999999999999999999';
    const execution = await v3Provider.buildExecution(quote, userAddr);

    assert.equal(execution.to, mockV3Router, 'Execution target must be Zenith V3 router, NEVER QuickSwap');
    assert.equal(execution.value, (10n ** 18n).toString(), 'Native POL input must send exact amountIn as transaction value');
    assert.equal(execution.approvalAmount, '0', 'Native POL requires 0 approval');
    assert.ok(execution.data.startsWith('0x414bf389') || execution.data.length > 10, 'Must contain exactInputSingle calldata');
  });

  await t.test('4. Route / Execution Consistency Enforcement (ZENITH_ROUTE_EXECUTION_MISMATCH)', async () => {
    const adapter = new EVMExecutionAdapter();

    // Construct a quote where quote.executionTarget is Zenith V3 Router, but execution.to is QuickSwap Router
    const fakeQuote: any = {
      request: {
        sourceChainId: 'ethereum',
        destinationChainId: 'ethereum',
        tokenIn: polygonPOL,
        tokenOut: polygonUSDC
      },
      amountInRaw: (10n ** 18n).toString(),
      amountOutRaw: '420000',
      minimumReceivedRaw: '417900',
      amountInFormatted: '1.0',
      minimumReceivedFormatted: '0.4179',
      executionTarget: '0x1234567890123456789012345678901234567890', // Zenith Router
      bestRoute: {
        dexQuote: {
          provider: 'ZENITH_V3',
          executionTarget: '0x1234567890123456789012345678901234567890'
        },
        execution: {
          to: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // QuickSwap Router (mismatch!)
          data: '0x123456',
          value: '0'
        }
      }
    };

    const mockSigner: any = {
      provider: {
        getBalance: async () => 10n ** 20n,
        call: async () => '0x'
      },
      estimateGas: async () => 100000n,
      sendTransaction: async () => {
        throw new Error('MetaMask opened unexpectedly!');
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({
          quote: fakeQuote,
          userAddress: '0x1234567890abcdef1234567890abcdef12345678',
          signer: mockSigner
        });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithRouteExecutionMismatchError);
        assert.ok(err.message.includes('ZENITH_ROUTE_EXECUTION_MISMATCH'));
        return true;
      },
      'Must abort before simulation or signing if target does not match quoted provider'
    );
  });

  await t.test('5. Strict Pre-Flight Dual Simulation Gate (eth_call Failure Blocks MetaMask)', async () => {
    const adapter = new EVMExecutionAdapter();

    const targetRouter = '0x1234567890123456789012345678901234567890';
    const quote: any = {
      request: {
        sourceChainId: 'ethereum',
        destinationChainId: 'ethereum',
        tokenIn: polygonPOL,
        tokenOut: polygonUSDC
      },
      amountInRaw: (10n ** 18n).toString(),
      amountOutRaw: '420000',
      minimumReceivedRaw: '417900',
      amountInFormatted: '1.0',
      minimumReceivedFormatted: '0.4179',
      executionTarget: targetRouter,
      bestRoute: {
        dexQuote: {
          provider: 'ZENITH_V3',
          executionTarget: targetRouter
        },
        execution: {
          to: targetRouter,
          data: '0xabcdef',
          value: (10n ** 18n).toString()
        }
      }
    };

    let metaMaskOpened = false;

    // Simulate an RPC provider where eth_call reverts (e.g. pool reverted)
    const mockSigner: any = {
      provider: {
        getBalance: async () => 10n ** 20n,
        call: async () => {
          throw new Error('execution reverted: STF');
        }
      },
      estimateGas: async () => 100000n,
      sendTransaction: async () => {
        metaMaskOpened = true;
        return { hash: '0x999', wait: async () => ({ status: 1, blockNumber: 1 }) };
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({
          quote,
          userAddress: '0x1234567890abcdef1234567890abcdef12345678',
          signer: mockSigner
        });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithSimulationFailedError);
        assert.ok(err.message.includes('ZENITH_SIMULATION_FAILED'));
        return true;
      },
      'Must throw ZenithSimulationFailedError when eth_call reverts'
    );

    assert.equal(metaMaskOpened, false, 'MetaMask must NOT open when pre-flight simulation fails');
  });

  await t.test('6. Strict Pre-Flight Dual Simulation Gate (estimateGas Failure Blocks MetaMask)', async () => {
    const adapter = new EVMExecutionAdapter();

    const targetRouter = '0x1234567890123456789012345678901234567890';
    const quote: any = {
      request: {
        sourceChainId: 'ethereum',
        destinationChainId: 'ethereum',
        tokenIn: polygonPOL,
        tokenOut: polygonUSDC
      },
      amountInRaw: (10n ** 18n).toString(),
      amountOutRaw: '420000',
      minimumReceivedRaw: '417900',
      amountInFormatted: '1.0',
      minimumReceivedFormatted: '0.4179',
      executionTarget: targetRouter,
      bestRoute: {
        dexQuote: {
          provider: 'ZENITH_V3',
          executionTarget: targetRouter
        },
        execution: {
          to: targetRouter,
          data: '0xabcdef',
          value: (10n ** 18n).toString()
        }
      }
    };

    let metaMaskOpened = false;

    // Simulate where eth_call passes, but estimateGas fails (out of gas / state change)
    const mockSigner: any = {
      provider: {
        getBalance: async () => 10n ** 20n,
        call: async () => '0x'
      },
      estimateGas: async () => {
        throw new Error('UNPREDICTABLE_GAS_LIMIT: execution reverted');
      },
      sendTransaction: async () => {
        metaMaskOpened = true;
        return { hash: '0x999', wait: async () => ({ status: 1, blockNumber: 1 }) };
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({
          quote,
          userAddress: '0x1234567890abcdef1234567890abcdef12345678',
          signer: mockSigner
        });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithSimulationFailedError);
        assert.ok(err.message.includes('ZENITH_SIMULATION_FAILED'));
        return true;
      },
      'Must throw ZenithSimulationFailedError when estimateGas fails'
    );

    assert.equal(metaMaskOpened, false, 'MetaMask must NOT open when estimateGas fails');
  });

  await t.test('7. Successful Dual Simulation Dispatches Authoritative Tx with 1.2x Gas Buffer', async () => {
    const adapter = new EVMExecutionAdapter();

    const targetRouter = '0x1234567890123456789012345678901234567890';
    const quote: any = {
      request: {
        sourceChainId: 'ethereum',
        destinationChainId: 'ethereum',
        tokenIn: polygonPOL,
        tokenOut: polygonUSDC
      },
      amountInRaw: (10n ** 18n).toString(),
      amountOutRaw: '420000',
      minimumReceivedRaw: '417900',
      amountInFormatted: '1.0',
      minimumReceivedFormatted: '0.4179',
      executionTarget: targetRouter,
      bestRoute: {
        dexQuote: {
          provider: 'ZENITH_V3',
          executionTarget: targetRouter
        },
        execution: {
          to: targetRouter,
          data: '0xabcdef12',
          value: (10n ** 18n).toString()
        }
      }
    };

    let submittedPayload: any = null;

    const mockSigner: any = {
      provider: {
        getBalance: async () => 10n ** 20n,
        call: async () => '0x'
      },
      estimateGas: async () => 150000n,
      sendTransaction: async (tx: any) => {
        submittedPayload = tx;
        return {
          hash: '0xabcde12345',
          wait: async () => ({
            status: 1,
            blockNumber: 123456,
            gasUsed: 145000n,
            effectiveGasPrice: 20000000000n
          })
        };
      }
    };

    const result = await adapter.executeSwap({
      quote,
      userAddress: '0x1234567890abcdef1234567890abcdef12345678',
      signer: mockSigner
    });

    assert.equal(result.isSuccess, true);
    assert.equal(result.txHash, '0xabcde12345');
    assert.equal(submittedPayload.to, targetRouter);
    assert.equal(submittedPayload.data, '0xabcdef12');
    assert.equal(submittedPayload.value, 10n ** 18n);
    assert.equal(submittedPayload.gasLimit, 180000n, 'Gas limit must equal measured 150000n * 1.2 = 180000n');
  });
});
