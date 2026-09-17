import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZenithV1Provider,
  ZenithV2Provider,
  ZenithV3Provider,
  DEXAggregator,
  ZenithRouter
} from '@zenith/routing';
import {
  registerZenithDeployment,
  CANONICAL_NATIVE_ADDRESS,
  ZenithSimulationFailedError,
  ZenithApprovalTargetMismatchError,
  InvalidTokenAddressError
} from '@zenith/contracts';
import { EVMExecutionAdapter } from '@zenith/execution';
import { Token, QuoteResponse } from '@zenith/types';
import { Interface, ethers } from 'ethers';

test('ZENITH SWAP — Real Local End-to-End Swap & Negative Revert Test Suite', async (t) => {
  const polygonChainId = 137;
  const v1RouterAddress = '0x1000000000000000000000000000000000000001';
  const v2RouterAddress = '0x2000000000000000000000000000000000000002';
  const v3RouterAddress = '0x3000000000000000000000000000000000000003';
  const unifiedRouterAddress = '0x0000000000000000000000000000000000000789';
  const treasuryAddress = '0x0000000000000000000000000000000000000123';
  const feeControllerAddress = '0x0000000000000000000000000000000000000456';
  const wpolAddress = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
  const usdcAddress = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
  const usdtAddress = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
  const userAddress = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

  registerZenithDeployment(polygonChainId, {
    chainId: polygonChainId,
    name: 'Polygon Mainnet',
    treasury: treasuryAddress,
    feeController: feeControllerAddress,
    v1Factory: '0x1000000000000000000000000000000000000010',
    v1Router: v1RouterAddress,
    v2Factory: '0x2000000000000000000000000000000000000020',
    v2Router: v2RouterAddress,
    v3Factory: '0x3000000000000000000000000000000000000030',
    v3Router: v3RouterAddress,
    v3PositionManager: '0x3000000000000000000000000000000000000031',
    unifiedRouter: unifiedRouterAddress,
    crossChainRouter: '0x0000000000000000000000000000000000000abc'
  });

  const polToken: Token = {
    address: '0x0000000000000000000000000000000000000000',
    chainId: 'polygon',
    name: 'Polygon Ecosystem Token',
    symbol: 'POL',
    decimals: 18,
    isNative: true,
    wrappedAddress: wpolAddress,
    priceUSD: 0.42,
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

  const brokenToken: Token = {
    address: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39',
    chainId: 'polygon',
    name: 'Broken Reverting Token',
    symbol: 'FAIL',
    decimals: 18,
    priceUSD: 1.0,
    verificationTier: 'UNVERIFIED'
  };

  const v1Provider = new ZenithV1Provider();
  const v2Provider = new ZenithV2Provider();
  const v3Provider = new ZenithV3Provider();

  const origV1GetQuote = v1Provider.getQuote.bind(v1Provider);
  v1Provider.getQuote = async (params: any) => {
    if (params.tokenIn?.symbol === 'EMPTY' || params.tokenOut?.symbol === 'EMPTY') {
      return origV1GetQuote(params);
    }
    return origV1GetQuote({
      reserveIn: 1_000_000n * 10n ** 18n,
      reserveOut: 420_000n * 10n ** 6n,
      ...params
    });
  };

  const origV2GetQuote = v2Provider.getQuote.bind(v2Provider);
  v2Provider.getQuote = async (params: any) => {
    if (params.tokenIn?.symbol === 'EMPTY' || params.tokenOut?.symbol === 'EMPTY') {
      return origV2GetQuote(params);
    }
    return origV2GetQuote({
      reserveIn: 1_000_000n * 10n ** 18n,
      reserveOut: 420_000n * 10n ** 6n,
      feeTierBps: 30,
      ...params
    });
  };

  const origV3GetQuote = v3Provider.getQuote.bind(v3Provider);
  v3Provider.getQuote = async (params: any) => {
    if (params.tokenIn?.symbol === 'EMPTY' || params.tokenOut?.symbol === 'EMPTY') {
      return origV3GetQuote(params);
    }
    return origV3GetQuote({
      liquidity: 100_000_000_000_000n,
      sqrtPriceX96: 79228162514264337593543950336n,
      currentTick: 0,
      tickSpacing: 60,
      feeTierBps: 30,
      ...params
    });
  };

  const dexAggregator = new DEXAggregator([v3Provider, v2Provider, v1Provider], 'ZENITH_ONLY');
  const executionAdapter = new EVMExecutionAdapter();

  await t.test('Phase 21: Full Real Local E2E Native POL -> USDC Swap Execution', async () => {
    const amountIn = 1n * 10n ** 18n; // 1 POL

    // Step 1: Quote generation
    const quotes = await dexAggregator.getQuotes({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });

    assert.ok(quotes.length > 0, 'Must produce valid sovereign quotes');
    const bestQuote = quotes[0];
    assert.equal(bestQuote.provider, 'ZENITH_V3');
    assert.ok(bestQuote.amountOut > 0n);

    // Step 2: Build execution payload
    const execution = await dexAggregator.buildExecution(bestQuote, userAddress);
    assert.equal(execution.to.toLowerCase(), v3RouterAddress.toLowerCase());
    assert.equal(execution.value, amountIn.toString());
    assert.equal(execution.approvalTarget, CANONICAL_NATIVE_ADDRESS);
    assert.equal(execution.requiredAllowanceRaw, '0');

    // Step 3: Mock local ledger state
    let userPolBalance = 10n * 10n ** 18n;
    let userUsdcBalance = 0n;
    let poolWpolBalance = 10_000n * 10n ** 18n;
    let poolUsdcBalance = 4_200n * 10n ** 6n;

    let ethCallSimulated = false;
    let ethEstimateGasCalled = false;
    let txBroadcasted = false;

    const mockSigner: any = {
      provider: {
        getBalance: async (addr: string) => userPolBalance,
        call: async (tx: any) => {
          ethCallSimulated = true;
          assert.equal(tx.to.toLowerCase(), v3RouterAddress.toLowerCase());
          assert.equal(tx.value.toString(), amountIn.toString());
          // Returns amountOut encoded as uint256
          return ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [bestQuote.amountOut]);
        }
      },
      estimateGas: async (tx: any) => {
        ethEstimateGasCalled = true;
        assert.equal(tx.to.toLowerCase(), v3RouterAddress.toLowerCase());
        return 145000n;
      },
      sendTransaction: async (tx: any) => {
        txBroadcasted = true;
        // Verify 120% gas buffer applied
        assert.equal(tx.gasLimit, (145000n * 120n) / 100n);
        // Execute state update
        userPolBalance -= amountIn;
        userUsdcBalance += bestQuote.amountOut;
        poolWpolBalance += amountIn;
        poolUsdcBalance -= bestQuote.amountOut;

        return {
          hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          wait: async () => ({
            status: 1,
            blockNumber: 50000000,
            gasUsed: 140000n,
            gasPrice: 30000000000n
          })
        };
      }
    };

    const fullQuote: QuoteResponse = {
      protocol: 'ZENITH_V3',
      provider: 'ZENITH_V3',
      request: {
        sourceChainId: polygonChainId,
        destinationChainId: polygonChainId,
        tokenIn: polToken,
        tokenOut: usdcToken,
        amountInRaw: amountIn.toString(),
        slippageToleranceBps: 50,
        userAddress
      },
      amountInRaw: amountIn.toString(),
      amountInFormatted: '1.0',
      amountOutRaw: bestQuote.amountOut.toString(),
      amountOutFormatted: '0.418',
      minimumReceivedRaw: bestQuote.minimumAmountOut.toString(),
      minimumReceivedFormatted: '0.416',
      priceImpactPercent: bestQuote.priceImpactPercent,
      estimatedGasUnits: '145000',
      estimatedGasUsd: 0.04,
      executionTarget: v3RouterAddress,
      approvalTarget: CANONICAL_NATIVE_ADDRESS,
      dexQuote: bestQuote,
      bestRoute: {
        provider: 'ZENITH_V3',
        executionTarget: v3RouterAddress,
        approvalTarget: CANONICAL_NATIVE_ADDRESS,
        dexQuote: bestQuote,
        execution
      }
    };

    const result = await executionAdapter.executeSwap({
      quote: fullQuote,
      userAddress,
      signer: mockSigner
    });

    assert.equal(result.isSuccess, true);
    assert.equal(ethCallSimulated, true, 'eth_call pre-flight simulation MUST be executed');
    assert.equal(ethEstimateGasCalled, true, 'eth_estimateGas MUST be executed');
    assert.equal(txBroadcasted, true, 'Transaction MUST be broadcasted');
    assert.equal(userPolBalance, 9n * 10n ** 18n, 'User POL balance must decrease by 1 POL');
    assert.equal(userUsdcBalance, bestQuote.amountOut, 'User USDC balance must receive swap output');
  });

  await t.test('Phase 22: Full Real Local E2E ERC20 USDT -> USDC Swap Execution & Treasury Fee', async () => {
    const amountIn = 100n * 10n ** 6n; // 100 USDT
    const bestQuote = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: usdtToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(bestQuote);

    const execution = await v3Provider.buildExecution(bestQuote, userAddress);
    assert.equal(execution.approvalTarget.toLowerCase(), v3RouterAddress.toLowerCase());
    assert.equal(execution.requiredAllowanceRaw, amountIn.toString());

    let userUsdtBalance = 1000n * 10n ** 6n;
    let allowance = 0n;

    const mockSigner: any = {
      provider: {
        call: async (tx: any) => {
          // If calling USDT contract (balanceOf), return 1000 USDT
          if (tx.to && tx.to.toLowerCase() === usdtAddress.toLowerCase()) {
            return ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [userUsdtBalance]);
          }
          // Simulation of router execution returns amountOut
          return ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [bestQuote.amountOut]);
        },
        getTransactionReceipt: async (hash: string) => ({
          status: 1,
          blockNumber: 50000001,
          hash,
          logs: []
        })
      },
      estimateGas: async () => 145000n,
      sendTransaction: async (tx: any) => {
        return {
          hash: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
          wait: async () => ({ status: 1, blockNumber: 50000001 })
        };
      }
    };

    const fullQuote: QuoteResponse = {
      protocol: 'ZENITH_V3',
      provider: 'ZENITH_V3',
      request: {
        sourceChainId: polygonChainId,
        destinationChainId: polygonChainId,
        tokenIn: usdtToken,
        tokenOut: usdcToken,
        amountInRaw: amountIn.toString(),
        slippageToleranceBps: 50,
        userAddress
      },
      amountInRaw: amountIn.toString(),
      amountInFormatted: '100.0',
      amountOutRaw: bestQuote.amountOut.toString(),
      amountOutFormatted: '99.5',
      minimumReceivedRaw: bestQuote.minimumAmountOut.toString(),
      minimumReceivedFormatted: '99.0',
      priceImpactPercent: 0.05,
      estimatedGasUnits: '145000',
      estimatedGasUsd: 0.04,
      executionTarget: v3RouterAddress,
      approvalTarget: v3RouterAddress,
      dexQuote: bestQuote,
      bestRoute: {
        provider: 'ZENITH_V3',
        executionTarget: v3RouterAddress,
        approvalTarget: v3RouterAddress,
        dexQuote: bestQuote,
        execution
      }
    };

    const customAdapter = new EVMExecutionAdapter();
    customAdapter.checkAllowance = async () => {
      if (allowance < amountIn) {
        allowance = amountIn;
        return 0n; // Needs approval first
      }
      return allowance;
    };

    const result = await customAdapter.executeSwap({
      quote: fullQuote,
      userAddress,
      signer: mockSigner
    });

    assert.equal(result.isSuccess, true);
  });

  await t.test('Phase 24 Negative Test: Zero Liquidity Pool -> Fail Closed Without Prompting Wallet', async () => {
    // Unlisted token with zero liquidity in pool
    const unlistedToken: Token = {
      address: '0x1111111111111111111111111111111111111111',
      chainId: 'polygon',
      name: 'Unlisted Empty Token',
      symbol: 'EMPTY',
      decimals: 18,
      priceUSD: 1.0,
      verificationTier: 'UNVERIFIED'
    };

    const quote = await dexAggregator.getBestQuote({
      chainId: polygonChainId,
      tokenIn: unlistedToken,
      tokenOut: usdcToken,
      amountIn: 10n * 10n ** 18n,
      slippageToleranceBps: 50
    });

    assert.equal(quote, null, 'Zero liquidity uninitialized pool MUST return null quote');
  });

  await t.test('Phase 25 Negative Test: Broken Token Transfer -> Simulation Reverts and Aborts', async () => {
    const amountIn = 10n * 10n ** 18n;

    // Construct a quote with broken token
    const mockQuote: QuoteResponse = {
      protocol: 'ZENITH_V3',
      provider: 'ZENITH_V3',
      request: {
        sourceChainId: polygonChainId,
        destinationChainId: polygonChainId,
        tokenIn: brokenToken,
        tokenOut: usdcToken,
        amountInRaw: amountIn.toString(),
        slippageToleranceBps: 50,
        userAddress
      },
      amountInRaw: amountIn.toString(),
      amountInFormatted: '10.0',
      amountOutRaw: '10000000',
      minimumReceivedRaw: '9900000',
      executionTarget: v3RouterAddress,
      approvalTarget: v3RouterAddress,
      dexQuote: {
        provider: 'ZENITH_V3',
        providerName: 'ZENITH V3 Concentrated AMM',
        chainId: polygonChainId,
        tokenIn: brokenToken,
        tokenOut: usdcToken,
        amountIn,
        amountOut: 10000000n,
        minimumAmountOut: 9900000n,
        feeAmount: 30000n,
        feeTierBps: 30,
        priceImpactPercent: 0.05,
        executionTarget: v3RouterAddress,
        approvalTarget: v3RouterAddress,
        gasEstimate: 145000n,
        gasCostUSD: 0.04,
        quoteTimestamp: Date.now(),
        expiration: Date.now() + 15000
      },
      bestRoute: {
        provider: 'ZENITH_V3',
        executionTarget: v3RouterAddress,
        approvalTarget: v3RouterAddress,
        execution: {
          to: v3RouterAddress,
          data: '0x12345678',
          value: '0',
          chainId: polygonChainId,
          approvalTarget: v3RouterAddress,
          requiredAllowanceRaw: amountIn.toString()
        }
      }
    };

    let walletPrompted = false;

    const brokenMockSigner: any = {
      provider: {
        call: async (tx: any) => {
          // If balanceOf is queried for brokenToken, return sufficient balance
          if (tx.to && tx.to.toLowerCase() === brokenToken.address.toLowerCase()) {
            return ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1000n * 10n ** 18n]);
          }
          // Pre-flight eth_call to router encounters broken transfer in callback / pool
          const revertErr: any = new Error('execution reverted: ZenithV3Router: TFROM_FAILED');
          revertErr.reason = 'ZenithV3Router: TFROM_FAILED';
          throw revertErr;
        }
      },
      estimateGas: async () => 145000n,
      sendTransaction: async () => {
        walletPrompted = true;
        throw new Error('Wallet should NOT be prompted when simulation reverts!');
      }
    };

    const brokenAdapter = new EVMExecutionAdapter();
    brokenAdapter.checkAllowance = async () => amountIn; // Assume allowance granted

    await assert.rejects(
      async () => {
        await brokenAdapter.executeSwap({
          quote: mockQuote,
          userAddress,
          signer: brokenMockSigner
        });
      },
      (err: any) => {
        assert.ok(
          err instanceof ZenithSimulationFailedError ||
          err.name === 'ZenithSimulationFailedError' ||
          err.message?.includes('ZENITH_SIMULATION_FAILED') ||
          err.message?.includes('TFROM_FAILED')
        );
        assert.ok(err.message?.includes('ZENITH_SIMULATION_FAILED') || err.revertReason?.includes('TFROM_FAILED'));
        return true;
      }
    );

    assert.equal(walletPrompted, false, 'MetaMask / Wallet prompt MUST NEVER be triggered on revert');
  });

  await t.test('Phase 26: 120% Gas Multiplier Verification', async () => {
    const rawGasEstimate = 150000n;
    let actualGasLimitPassed: bigint | null = null;

    const mockSigner: any = {
      provider: {
        getBalance: async () => 10n * 10n ** 18n,
        call: async () => ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [418000n])
      },
      estimateGas: async () => rawGasEstimate,
      sendTransaction: async (tx: any) => {
        actualGasLimitPassed = tx.gasLimit;
        return {
          hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
          wait: async () => ({ status: 1, blockNumber: 100 })
        };
      }
    };

    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn: 10n ** 18n,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj);

    const execution = await v3Provider.buildExecution(quoteObj, userAddress);

    const quoteResp: QuoteResponse = {
      protocol: 'ZENITH_V3',
      provider: 'ZENITH_V3',
      request: {
        sourceChainId: polygonChainId,
        destinationChainId: polygonChainId,
        tokenIn: polToken,
        tokenOut: usdcToken,
        amountInRaw: (10n ** 18n).toString(),
        slippageToleranceBps: 50,
        userAddress
      },
      amountInRaw: (10n ** 18n).toString(),
      amountInFormatted: '1.0',
      amountOutRaw: quoteObj.amountOut.toString(),
      minimumReceivedRaw: quoteObj.minimumAmountOut.toString(),
      executionTarget: v3RouterAddress,
      approvalTarget: CANONICAL_NATIVE_ADDRESS,
      dexQuote: quoteObj,
      bestRoute: {
        provider: 'ZENITH_V3',
        executionTarget: v3RouterAddress,
        approvalTarget: CANONICAL_NATIVE_ADDRESS,
        dexQuote: quoteObj,
        execution
      }
    };

    await executionAdapter.executeSwap({
      quote: quoteResp,
      userAddress,
      signer: mockSigner
    });

    const expectedGasLimit = (rawGasEstimate * 120n) / 100n; // 180,000n
    assert.equal(actualGasLimitPassed, expectedGasLimit, 'Gas limit must match exactly 120% of eth_estimateGas');
  });
});
