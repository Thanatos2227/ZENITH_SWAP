import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import {
  registerZenithDeployment,
  getZenithV3Router,
  getZenithV3Factory,
  CANONICAL_NATIVE_ADDRESS,
  ZENITH_V3_ROUTER_ABI,
  ZENITH_V3_POOL_ABI,
  ZenithSimulationFailedError,
  ZenithRouteExecutionMismatchError,
  ZenithRouterNotDeployedError
} from '../packages/contracts/src';
import { EVMExecutionAdapter } from '../packages/execution/src/adapters/evmAdapter';
import { ZenithV3Provider } from '../packages/routing/src/dex/zenithV3Provider';
import { DEXAggregator } from '../packages/routing/src/dex/dexAggregator';
import {
  calculateV3SqrtPriceX96,
  sqrtBigInt
} from '../packages/routing/src/dex/dexMath';
import {
  TickMath,
  simulateV3Swap
} from '../packages/routing/src/math/v3ExactMath';
import { Token, QuoteResponse } from '@zenith/types';

test('ZENITH SWAP — Phase 0 Sovereign V3 Golden Path Acceptance Test Suite', async (t) => {
  const chainId = 137;
  const routerAddress = '0x3000000000000000000000000000000000000003';
  const factoryAddress = '0x300000000000000000000000000000000000000F';
  const poolAddress = '0x3000000000000000000000000000000000000001';
  const wpolAddress = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
  const usdcAddress = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
  const usdtAddress = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
  const userAddress = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

  registerZenithDeployment(chainId, {
    chainId,
    name: 'Polygon Mainnet',
    v3Router: routerAddress,
    v3Factory: factoryAddress
  });

  const polToken: Token = {
    address: '0x0000000000000000000000000000000000000000',
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

  const usdtToken: Token = {
    address: usdtAddress,
    chainId: 'polygon',
    name: 'Tether USD',
    symbol: 'USDT',
    decimals: 6,
    priceUSD: 1.0,
    verificationTier: 'VERIFIED_CANONICAL'
  };

  // Pool Configuration: 10M POL (18 decimals) / 1M USDC (6 decimals)
  const poolReserve0 = 10_000_000n * 10n ** 18n;
  const poolReserve1 = 1_000_000n * 10n ** 6n;
  const poolLiquidity = sqrtBigInt(poolReserve0 * poolReserve1);
  const poolSqrtPriceX96 = calculateV3SqrtPriceX96(poolReserve0, poolReserve1);
  const poolCurrentTick = TickMath.getTickAtSqrtRatio(poolSqrtPriceX96);
  const poolFee = 3000;
  const poolTickSpacing = 60;

  function createMockOnChainEnvironment(options?: {
    revertSimulation?: boolean;
    revertReason?: string;
    estimateGasFail?: boolean;
    mockBalance?: bigint;
    mockAllowance?: bigint;
  }) {
    let broadcastTx: any = null;
    let callSimulationTx: any = null;
    let gasEstimateTx: any = null;

    const provider: any = {
      getBlockNumber: async () => 50000000,
      getCode: async () => '0x608060405234801561001057600080fd5b50',
      getBalance: async () => options?.mockBalance !== undefined ? options.mockBalance : 100n * 10n ** 18n,
      estimateGas: async (tx: any) => {
        gasEstimateTx = tx;
        if (options?.estimateGasFail) {
          throw new Error('UNPREDICTABLE_GAS_LIMIT: execution reverted');
        }
        return 145000n;
      },
      call: async (tx: any) => {
        const poolIface = new Interface(ZENITH_V3_POOL_ABI);
        const factoryIface = new Interface([
          'function getPool(address,address,uint24) external view returns (address)'
        ]);
        const erc20Iface = new Interface([
          'function allowance(address,address) external view returns (uint256)',
          'function balanceOf(address) external view returns (uint256)'
        ]);

        const to = tx.to?.toLowerCase();

        // Factory calls
        if (to === factoryAddress.toLowerCase()) {
          return factoryIface.encodeFunctionResult('getPool', [poolAddress]);
        }

        // Pool calls
        if (to === poolAddress.toLowerCase()) {
          const data = tx.data;
          if (data.startsWith(poolIface.getFunction('token0')!.selector)) {
            return poolIface.encodeFunctionResult('token0', [wpolAddress]);
          }
          if (data.startsWith(poolIface.getFunction('token1')!.selector)) {
            return poolIface.encodeFunctionResult('token1', [usdcAddress]);
          }
          if (data.startsWith(poolIface.getFunction('fee')!.selector)) {
            return poolIface.encodeFunctionResult('fee', [poolFee]);
          }
          if (data.startsWith(poolIface.getFunction('tickSpacing')!.selector)) {
            return poolIface.encodeFunctionResult('tickSpacing', [poolTickSpacing]);
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

        // ERC20 token calls (balance / allowance)
        if (to === usdcAddress.toLowerCase() || to === usdtAddress.toLowerCase()) {
          const data = tx.data;
          if (data.startsWith(erc20Iface.getFunction('allowance')!.selector)) {
            const allowance = options?.mockAllowance !== undefined ? options.mockAllowance : 1000000000000n;
            return erc20Iface.encodeFunctionResult('allowance', [allowance]);
          }
          if (data.startsWith(erc20Iface.getFunction('balanceOf')!.selector)) {
            const bal = options?.mockBalance !== undefined ? options.mockBalance : 1000000000000n;
            return erc20Iface.encodeFunctionResult('balanceOf', [bal]);
          }
        }

        // Router simulation calls
        if (to === routerAddress.toLowerCase()) {
          callSimulationTx = tx;
          if (options?.revertSimulation) {
            throw new Error(options.revertReason || 'execution reverted: V3TooLittleReceived()');
          }
          // Return simulated amountOut (99699 units)
          return '0x0000000000000000000000000000000000000000000000000000000000018573';
        }

        return '0x';
      }
    };

    const signer: any = {
      provider,
      getAddress: async () => userAddress,
      estimateGas: async (tx: any) => provider.estimateGas(tx),
      sendTransaction: async (tx: any) => {
        broadcastTx = tx;
        return {
          hash: '0x' + 'a'.repeat(64),
          wait: async () => ({
            status: 1,
            blockNumber: 50000001,
            gasUsed: 142000n,
            gasPrice: 35000000000n
          })
        };
      }
    };

    return {
      provider,
      signer,
      getBroadcastTx: () => broadcastTx,
      getCallSimulationTx: () => callSimulationTx,
      getGasEstimateTx: () => gasEstimateTx
    };
  }

  await t.test('1. Golden Path: Native POL -> USDC Full Pipeline Execution (Zero-Mock Parity)', async () => {
    const env = createMockOnChainEnvironment();
    const v3Provider = new ZenithV3Provider();
    const adapter = new EVMExecutionAdapter();

    const amountIn = 1n * 10n ** 18n; // 1 POL
    const slippageToleranceBps = 50; // 0.50%

    // Step A: Live Pool Reading & Quote Generation
    const quote = await v3Provider.getQuote({
      chainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps,
      feeTierBps: 30,
      provider: env.provider
    } as any);

    assert.ok(quote, 'Quote must be successfully generated from live state');
    assert.equal(quote.provider, 'ZENITH_V3');
    assert.equal(quote.executionTarget.toLowerCase(), routerAddress.toLowerCase());

    // Step B: Math Parity Assertion
    const exactMathSim = simulateV3Swap({
      amountIn,
      zeroForOne: true,
      sqrtPriceX96: poolSqrtPriceX96,
      currentTick: poolCurrentTick,
      liquidity: poolLiquidity,
      feePips: poolFee,
      tickSpacing: poolTickSpacing
    });
    assert.equal(quote.amountOut, exactMathSim.amountOut, 'Quote amountOut must match exact V3 math parity');

    // Step C: Minimum Amount Out Verification
    const expectedMinOut = (quote.amountOut * (10000n - BigInt(slippageToleranceBps))) / 10000n;
    assert.equal(quote.minimumAmountOut, expectedMinOut, 'Minimum amount out must be computed with exact integer slippage');

    // Step D: Execution Calldata Construction
    const execution = await v3Provider.buildExecution(quote, userAddress);
    assert.equal(execution.to.toLowerCase(), routerAddress.toLowerCase());
    assert.equal(execution.value, amountIn.toString(), 'Native asset must attach amountIn to msg.value');
    assert.equal(execution.approvalTarget, CANONICAL_NATIVE_ADDRESS);
    assert.equal(execution.approvalAmount, '0');

    // Verify exactInputSingle parameters in calldata
    const routerIface = new Interface(ZENITH_V3_ROUTER_ABI);
    const decoded = routerIface.parseTransaction({ data: execution.data, value: execution.value });
    assert.ok(decoded);
    assert.equal(decoded.name, 'exactInputSingle');
    assert.equal(decoded.args[0].tokenIn.toLowerCase(), wpolAddress.toLowerCase());
    assert.equal(decoded.args[0].tokenOut.toLowerCase(), usdcAddress.toLowerCase());
    assert.equal(Number(decoded.args[0].fee), 3000);
    assert.equal(decoded.args[0].recipient.toLowerCase(), userAddress.toLowerCase());
    assert.equal(decoded.args[0].amountIn, amountIn);
    assert.equal(decoded.args[0].amountOutMinimum, quote.minimumAmountOut);

    // Step E: Pre-Flight Dual Simulation & Transaction Execution
    const fullQuote: QuoteResponse = {
      protocol: 'ZENITH_V3',
      provider: 'ZENITH_V3',
      request: {
        sourceChainId: chainId,
        destinationChainId: chainId,
        tokenIn: polToken,
        tokenOut: usdcToken,
        amountInRaw: amountIn.toString(),
        slippageToleranceBps,
        userAddress
      },
      amountInRaw: amountIn.toString(),
      amountInFormatted: '1.0',
      amountOutRaw: quote.amountOut.toString(),
      amountOutFormatted: '0.099699',
      minimumReceivedRaw: quote.minimumAmountOut.toString(),
      minimumReceivedFormatted: '0.099200',
      priceImpactPercent: 0.05,
      estimatedGasUnits: '145000',
      estimatedGasUsd: 0.01,
      executionTarget: routerAddress,
      approvalTarget: CANONICAL_NATIVE_ADDRESS,
      dexQuote: quote,
      bestRoute: {
        provider: 'ZENITH_V3',
        executionTarget: routerAddress,
        approvalTarget: CANONICAL_NATIVE_ADDRESS,
        dexQuote: quote,
        execution
      }
    };

    const result = await adapter.executeSwap({
      quote: fullQuote,
      userAddress,
      signer: env.signer
    });

    assert.equal(result.isSuccess, true);
    assert.ok(env.getCallSimulationTx() !== null, 'eth_call simulation must have been executed');
    assert.ok(env.getGasEstimateTx() !== null, 'estimateGas must have been executed');
    const broadcastTx = env.getBroadcastTx();
    assert.ok(broadcastTx !== null, 'Transaction must have been broadcasted');
    assert.equal(broadcastTx.gasLimit, (145000n * 120n) / 100n, 'Gas limit must include 1.2x safety multiplier');
    assert.equal(broadcastTx.value.toString(), amountIn.toString());
  });

  await t.test('2. Golden Path: ERC20 USDT -> USDC with Approval Verification', async () => {
    const env = createMockOnChainEnvironment({ mockAllowance: 0n });
    const v3Provider = new ZenithV3Provider();
    const adapter = new EVMExecutionAdapter();

    const amountIn = 100n * 10n ** 6n; // 100 USDT
    const slippageToleranceBps = 50;

    const quote = await v3Provider.getQuote({
      chainId,
      tokenIn: usdtToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps,
      feeTierBps: 30,
      provider: env.provider
    } as any);
    assert.ok(quote);

    const execution = await v3Provider.buildExecution(quote, userAddress);
    assert.equal(execution.value, '0', 'ERC20 value must be 0');
    assert.equal(execution.approvalTarget.toLowerCase(), routerAddress.toLowerCase());
    assert.equal(execution.requiredAllowanceRaw, amountIn.toString());

    // Check allowance verification
    const allowance = await adapter.checkAllowance({
      tokenAddress: usdtToken.address,
      ownerAddress: userAddress,
      spenderAddress: routerAddress,
      signer: env.signer
    });
    assert.equal(allowance, 0n);
  });

  await t.test('3. Negative Safety Gate: Pre-flight Simulation Failure Blocks MetaMask Dispatch', async () => {
    const env = createMockOnChainEnvironment({
      revertSimulation: true,
      revertReason: 'execution reverted: 0x39d35496' // V3TooLittleReceived()
    });
    const v3Provider = new ZenithV3Provider();
    const adapter = new EVMExecutionAdapter();

    const amountIn = 1n * 10n ** 18n;
    const quote = await v3Provider.getQuote({
      chainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50,
      provider: env.provider
    } as any);
    assert.ok(quote);

    const execution = await v3Provider.buildExecution(quote, userAddress);

    const fullQuote: QuoteResponse = {
      protocol: 'ZENITH_V3',
      provider: 'ZENITH_V3',
      request: {
        sourceChainId: chainId,
        destinationChainId: chainId,
        tokenIn: polToken,
        tokenOut: usdcToken,
        amountInRaw: amountIn.toString(),
        slippageToleranceBps: 50,
        userAddress
      },
      amountInRaw: amountIn.toString(),
      amountInFormatted: '1.0',
      amountOutRaw: quote.amountOut.toString(),
      amountOutFormatted: '0.099',
      minimumReceivedRaw: quote.minimumAmountOut.toString(),
      minimumReceivedFormatted: '0.098',
      priceImpactPercent: 0.05,
      estimatedGasUnits: '145000',
      estimatedGasUsd: 0.01,
      executionTarget: routerAddress,
      approvalTarget: CANONICAL_NATIVE_ADDRESS,
      dexQuote: quote,
      bestRoute: {
        provider: 'ZENITH_V3',
        executionTarget: routerAddress,
        approvalTarget: CANONICAL_NATIVE_ADDRESS,
        dexQuote: quote,
        execution
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({
          quote: fullQuote,
          userAddress,
          signer: env.signer
        });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithSimulationFailedError || err.message.includes('0x39d35496') || err.message.includes('Simulation failed'));
        return true;
      },
      'Simulation failure must reject before broadcast'
    );

    assert.equal(env.getBroadcastTx(), null, 'No transaction must be sent when simulation fails');
  });

  await t.test('4. Fail Closed: Undeployed Router Protocol Rejection', async () => {
    const undeployedChainId = 999999;
    const v3Provider = new ZenithV3Provider();

    assert.equal(v3Provider.isAvailable(undeployedChainId, polToken, usdcToken), false);

    const quote = await v3Provider.getQuote({
      chainId: undeployedChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 10n ** 18n,
      slippageToleranceBps: 50
    });
    assert.equal(quote, null, 'Must return null quote on unconfigured chain');
  });

  await t.test('5. Route / Execution Consistency: Target Mismatch Rejection', async () => {
    const env = createMockOnChainEnvironment();
    const adapter = new EVMExecutionAdapter();

    const fakeQuote: any = {
      protocol: 'ZENITH_V3',
      provider: 'ZENITH_V3',
      executionTarget: routerAddress,
      request: {
        sourceChainId: chainId,
        destinationChainId: chainId,
        tokenIn: polToken,
        tokenOut: usdcToken,
        amountInRaw: '1000000000000000000',
        slippageToleranceBps: 50,
        userAddress
      },
      bestRoute: {
        provider: 'ZENITH_V3',
        executionTarget: routerAddress,
        approvalTarget: CANONICAL_NATIVE_ADDRESS,
        execution: {
          to: '0x0000000000000000000000000000000000000bad', // Mismatched target!
          data: '0x1234',
          value: '1000000000000000000',
          chainId,
          gasLimit: '150000',
          approvalTarget: CANONICAL_NATIVE_ADDRESS,
          requiredAllowanceRaw: '0'
        }
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({
          quote: fakeQuote,
          userAddress,
          signer: env.signer
        });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithRouteExecutionMismatchError || err.message.includes('ZENITH_ROUTE_EXECUTION_MISMATCH'));
        return true;
      },
      'Target mismatch must be intercepted by EVMExecutionAdapter'
    );
  });
});
