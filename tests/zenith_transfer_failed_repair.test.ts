import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZenithV1Provider,
  ZenithV2Provider,
  ZenithV3Provider,
  DEXAggregator,
  ZenithRouter
} from '../packages/routing/src';
import {
  registerZenithDeployment,
  getZenithV3Router,
  getZenithV2Router,
  getZenithV1Router,
  CANONICAL_NATIVE_ADDRESS,
  ZenithSimulationFailedError,
  ZenithApprovalTargetMismatchError,
  InvalidTokenAddressError
} from '../packages/contracts/src';
import { EVMExecutionAdapter } from '../packages/execution/src/adapters/evmAdapter';
import { Token, QuoteResponse } from '../packages/types/src';
import { Interface } from 'ethers';

test('ZENITH SWAP — TRANSFER_FAILED Root-Cause Repair & Complete Simulation Suite', async (t) => {
  const polygonChainId = 137;
  const v1RouterAddress = '0x1000000000000000000000000000000000000001';
  const v2RouterAddress = '0x2000000000000000000000000000000000000002';
  const v3RouterAddress = '0x3000000000000000000000000000000000000003';
  const wpolAddress = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
  const usdcAddress = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
  const usdtAddress = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
  const userAddress = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

  // Register Zenith deployments for Polygon test context
  registerZenithDeployment(polygonChainId, {
    chainId: polygonChainId,
    name: 'Polygon Mainnet',
    treasury: '0x0000000000000000000000000000000000000123',
    feeController: '0x0000000000000000000000000000000000000456',
    v1Factory: '0x1000000000000000000000000000000000000010',
    v1Router: v1RouterAddress,
    v2Factory: '0x2000000000000000000000000000000000000020',
    v2Router: v2RouterAddress,
    v3Factory: '0x3000000000000000000000000000000000000030',
    v3Router: v3RouterAddress,
    v3PositionManager: '0x3000000000000000000000000000000000000031',
    unifiedRouter: '0x0000000000000000000000000000000000000789',
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

  const v1Provider = new ZenithV1Provider();
  const v2Provider = new ZenithV2Provider();
  const v3Provider = new ZenithV3Provider();
  const adapter = new EVMExecutionAdapter();

  await t.test('1. Native POL -> WPOL -> Zenith V1: swapExactETHForTokens Calldata & Native Value', async () => {
    const amountIn = 10n ** 18n; // 1 POL
    const quote = await v1Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quote !== null, 'Quote must be generated');

    const execution = await v1Provider.buildExecution(quote, userAddress);
    assert.equal(execution.to.toLowerCase(), v1RouterAddress.toLowerCase());
    assert.equal(execution.value, amountIn.toString(), 'Native value must equal amountIn');
    assert.equal(execution.approvalTarget, CANONICAL_NATIVE_ADDRESS, 'Approval target must be native marker');
    assert.equal(execution.requiredAllowanceRaw, '0', 'Required allowance must be 0 for native asset');

    // Decode function selector
    assert.ok(execution.data.startsWith('0x7ff36ab5'), 'Must use swapExactETHForTokens selector');
  });

  await t.test('2. Native POL -> WPOL -> Zenith V2: swapExactETHForTokens Calldata & Native Value', async () => {
    const amountIn = 10n ** 18n; // 1 POL
    const quote = await v2Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quote !== null, 'Quote must be generated');

    const execution = await v2Provider.buildExecution(quote, userAddress);
    assert.equal(execution.to.toLowerCase(), v2RouterAddress.toLowerCase());
    assert.equal(execution.value, amountIn.toString(), 'Native value must equal amountIn');
    assert.equal(execution.approvalTarget, CANONICAL_NATIVE_ADDRESS);
    assert.equal(execution.requiredAllowanceRaw, '0');

    // Verify selector for swapExactETHForTokens(uint256,address[],uint24[],address,uint256)
    const v2Iface = new Interface([
      'function swapExactETHForTokens(uint256 amountOutMin, address[] path, uint24[] feeBpsPath, address to, uint256 deadline) payable returns (uint256[])'
    ]);
    const parsed = v2Iface.parseTransaction({ data: execution.data, value: execution.value });
    assert.ok(parsed, 'Calldata must parse as swapExactETHForTokens');
    assert.equal(parsed.name, 'swapExactETHForTokens');
    assert.equal(parsed.args[1][0].toLowerCase(), wpolAddress.toLowerCase(), 'Path[0] must be WPOL');
  });

  await t.test('3. Native POL -> WPOL -> Zenith V3: exactInputSingle with msg.value & WPOL Wrapping', async () => {
    const amountIn = 10n ** 18n; // 1 POL
    const quote = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quote !== null, 'Quote must be generated');

    const execution = await v3Provider.buildExecution(quote, userAddress);
    assert.equal(execution.to.toLowerCase(), v3RouterAddress.toLowerCase());
    assert.equal(execution.value, amountIn.toString(), 'Native value must be attached');
    assert.equal(execution.approvalTarget, CANONICAL_NATIVE_ADDRESS);
    assert.equal(execution.requiredAllowanceRaw, '0');

    const v3Iface = new Interface([
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256)'
    ]);
    const parsed = v3Iface.parseTransaction({ data: execution.data, value: execution.value });
    assert.ok(parsed, 'Calldata must parse as exactInputSingle');
    assert.equal(parsed.name, 'exactInputSingle');
    assert.equal(parsed.args[0].tokenIn.toLowerCase(), wpolAddress.toLowerCase(), 'tokenIn must resolve to WPOL');
    assert.equal(parsed.args[0].tokenOut.toLowerCase(), usdcAddress.toLowerCase(), 'tokenOut must resolve to USDC');
    assert.equal(parsed.args[0].amountIn.toString(), amountIn.toString());
  });

  await t.test('4. End-to-End EVMAdapter Simulation for Native POL -> USDC Swap', async () => {
    const amountIn = 10n ** 18n;
    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj);

    const execution = await v3Provider.buildExecution(quoteObj, userAddress);

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
      amountOutRaw: quoteObj.amountOut.toString(),
      amountOutFormatted: '0.418',
      minimumReceivedRaw: quoteObj.minimumAmountOut.toString(),
      minimumReceivedFormatted: '0.416',
      priceImpactPercent: 0.05,
      estimatedGasUnits: '145000',
      estimatedGasUsd: 0.04,
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

    let simulatedCall: any = null;
    let estimatedGasCall: any = null;
    let broadcastTx: any = null;

    const mockSigner: any = {
      provider: {
        getBalance: async (addr: string) => 5n * 10n ** 18n, // 5 POL
        call: async (tx: any) => {
          simulatedCall = tx;
          return '0x0000000000000000000000000000000000000000000000000000000000065b90'; // returns amountOut
        }
      },
      estimateGas: async (tx: any) => {
        estimatedGasCall = tx;
        return 145000n;
      },
      sendTransaction: async (tx: any) => {
        broadcastTx = tx;
        return {
          hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          wait: async () => ({
            status: 1,
            blockNumber: 50000000,
            gasUsed: 140000n,
            gasPrice: 30000000000n
          })
        };
      }
    };

    const result = await adapter.executeSwap({
      quote: fullQuote,
      userAddress,
      signer: mockSigner
    });

    assert.equal(result.isSuccess, true);
    assert.equal(result.txHash, '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
    assert.ok(simulatedCall !== null, 'eth_call simulation must be executed');
    assert.equal(simulatedCall.value.toString(), amountIn.toString(), 'Simulation value must equal native amountIn');
    assert.equal(simulatedCall.to.toLowerCase(), v3RouterAddress.toLowerCase());
    assert.equal(broadcastTx.value.toString(), amountIn.toString(), 'Broadcasted value must equal native amountIn');
    assert.equal(broadcastTx.gasLimit, (145000n * 120n) / 100n, 'Gas limit must include 120% buffer');
  });

  await t.test('5. ERC20 -> USDC Swap Flow: Approval and Transfer Verification', async () => {
    const amountIn = 100n * 10n ** 6n; // 100 USDT
    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: usdtToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj, 'Quote for USDT -> USDC must be generated');

    const execution = await v3Provider.buildExecution(quoteObj, userAddress);
    assert.equal(execution.value, '0', 'ERC20 swap value must be 0');
    assert.equal(execution.approvalTarget.toLowerCase(), v3RouterAddress.toLowerCase());
    assert.equal(execution.requiredAllowanceRaw, amountIn.toString());

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
      amountOutRaw: quoteObj.amountOut.toString(),
      amountOutFormatted: '99.5',
      minimumReceivedRaw: quoteObj.minimumAmountOut.toString(),
      minimumReceivedFormatted: '99.0',
      priceImpactPercent: 0.05,
      estimatedGasUnits: '145000',
      estimatedGasUsd: 0.04,
      executionTarget: v3RouterAddress,
      approvalTarget: v3RouterAddress,
      dexQuote: quoteObj,
      bestRoute: {
        provider: 'ZENITH_V3',
        executionTarget: v3RouterAddress,
        approvalTarget: v3RouterAddress,
        dexQuote: quoteObj,
        execution
      }
    };

    let allowanceChecked = false;

    // Mock contract calls for USDT token
    const mockSigner: any = {
      provider: {
        call: async (tx: any) => {
          // Return 1,000,000 USDT for balanceOf/simulation calls
          return '0x000000000000000000000000000000000000000000000000000000e8d4a51000';
        },
        getTransactionReceipt: async (hash: string) => ({
          status: 1,
          blockNumber: 50000001,
          hash,
          logs: []
        })
      },
      estimateGas: async () => 145000n,
      sendTransaction: async (tx: any) => ({
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        wait: async () => ({ status: 1, blockNumber: 50000001 })
      })
    };

    const erc20Adapter = new EVMExecutionAdapter();
    let currentAllow = 0n;
    erc20Adapter.checkAllowance = async () => {
      allowanceChecked = true;
      if (currentAllow === 0n) {
        currentAllow = amountIn;
        return 0n;
      }
      return amountIn;
    };

    const result = await erc20Adapter.executeSwap({
      quote: fullQuote,
      userAddress,
      signer: mockSigner
    });

    assert.equal(result.isSuccess, true);
    assert.equal(allowanceChecked, true, 'Allowance check must be executed for ERC20 asset');
  });

  // =========================================================================
  // NEGATIVE TESTS (A through J)
  // =========================================================================

  await t.test('Negative Test A: Insufficient Native Balance Rejection', async () => {
    const amountIn = 10n ** 18n; // 1 POL
    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj);
    const execution = await v3Provider.buildExecution(quoteObj, userAddress);

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
      amountOutRaw: quoteObj.amountOut.toString(),
      amountOutFormatted: '0.418',
      minimumReceivedRaw: quoteObj.minimumAmountOut.toString(),
      minimumReceivedFormatted: '0.416',
      priceImpactPercent: 0.05,
      estimatedGasUnits: '145000',
      estimatedGasUsd: 0.04,
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

    const mockSigner: any = {
      provider: {
        getBalance: async () => 10n ** 17n // User only has 0.1 POL (needs 1 POL)
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({
          quote: fullQuote,
          userAddress,
          signer: mockSigner
        });
      },
      (err: any) => {
        assert.ok(
          err.message.includes('Insufficient native POL balance') ||
          err.message.includes('Insufficient balance for POL') ||
          err instanceof InsufficientBalanceError,
          `Unexpected error: ${err.message}`
        );
        return true;
      },
      'Must reject with Insufficient native balance error before simulation'
    );
  });

  await t.test('Negative Test B: Insufficient ERC20 Balance Rejection', async () => {
    const amountIn = 100n * 10n ** 6n; // 100 USDT
    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: usdtToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj);
    const execution = await v3Provider.buildExecution(quoteObj, userAddress);

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
      amountOutRaw: quoteObj.amountOut.toString(),
      amountOutFormatted: '99.5',
      minimumReceivedRaw: quoteObj.minimumAmountOut.toString(),
      minimumReceivedFormatted: '99.0',
      priceImpactPercent: 0.05,
      estimatedGasUnits: '145000',
      estimatedGasUsd: 0.04,
      executionTarget: v3RouterAddress,
      approvalTarget: v3RouterAddress,
      dexQuote: quoteObj,
      bestRoute: {
        provider: 'ZENITH_V3',
        executionTarget: v3RouterAddress,
        approvalTarget: v3RouterAddress,
        dexQuote: quoteObj,
        execution
      }
    };

    await assert.rejects(
      async () => {
        const testAdapter = new EVMExecutionAdapter();
        testAdapter.checkAllowance = async () => amountIn;
        const mockSignerWithLowBalance: any = {
          provider: {
            call: async () => '0x0000000000000000000000000000000000000000000000000000000000000001'
          },
          estimateGas: async () => {
            throw new Error('execution reverted: Insufficient balance');
          }
        };
        await testAdapter.executeSwap({
          quote: fullQuote,
          userAddress,
          signer: mockSignerWithLowBalance
        });
      },
      (err: any) => {
        assert.ok(err.message.includes('reverted') || err.message.includes('Insufficient') || err instanceof ZenithSimulationFailedError);
        return true;
      }
    );
  });

  await t.test('Negative Test C: Approval Target Mismatch Rejection', async () => {
    const amountIn = 100n * 10n ** 6n;
    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: usdtToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj);
    const execution = await v3Provider.buildExecution(quoteObj, userAddress);

    // Tamper with approvalTarget so it doesn't match executionTo
    const maliciousApprovalTarget = '0x6543210987654321098765432109876543210987';
    execution.approvalTarget = maliciousApprovalTarget;

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
      amountOutRaw: quoteObj.amountOut.toString(),
      amountOutFormatted: '99.5',
      minimumReceivedRaw: quoteObj.minimumAmountOut.toString(),
      minimumReceivedFormatted: '99.0',
      priceImpactPercent: 0.05,
      estimatedGasUnits: '145000',
      estimatedGasUsd: 0.04,
      executionTarget: v3RouterAddress,
      approvalTarget: maliciousApprovalTarget,
      dexQuote: quoteObj,
      bestRoute: {
        provider: 'ZENITH_V3',
        executionTarget: v3RouterAddress,
        approvalTarget: maliciousApprovalTarget,
        dexQuote: quoteObj,
        execution
      }
    };

    const mockSigner: any = {
      provider: {
        call: async () => '0x'
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({
          quote: fullQuote,
          userAddress,
          signer: mockSigner
        });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithApprovalTargetMismatchError);
        assert.ok(err.message.includes('ZENITH_APPROVAL_TARGET_MISMATCH'));
        return true;
      },
      'Must throw ZenithApprovalTargetMismatchError when approvalTarget differs from router'
    );
  });

  await t.test('Negative Test D: On-Chain Pre-Flight eth_call Revert (TRANSFER_FAILED)', async () => {
    const amountIn = 10n ** 18n;
    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj);
    const execution = await v3Provider.buildExecution(quoteObj, userAddress);

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
      amountOutRaw: quoteObj.amountOut.toString(),
      amountOutFormatted: '0.418',
      minimumReceivedRaw: quoteObj.minimumAmountOut.toString(),
      minimumReceivedFormatted: '0.416',
      priceImpactPercent: 0.05,
      estimatedGasUnits: '145000',
      estimatedGasUsd: 0.04,
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

    const mockSigner: any = {
      provider: {
        getBalance: async () => 5n * 10n ** 18n,
        call: async () => {
          const revertErr: any = new Error('execution reverted: ZenithV3Router: TFROM_FAILED');
          revertErr.reason = 'ZenithV3Router: TFROM_FAILED';
          throw revertErr;
        }
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({
          quote: fullQuote,
          userAddress,
          signer: mockSigner
        });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithSimulationFailedError);
        assert.ok(err.message.includes('ZENITH_SIMULATION_FAILED'));
        assert.ok(err.revertReason?.includes('TFROM_FAILED'));
        return true;
      },
      'Must catch eth_call revert, preserve revertReason, and throw ZenithSimulationFailedError'
    );
  });

  await t.test('Negative Test E: Invalid Token Address Handling', async () => {
    const invalidToken: Token = {
      address: '0xinvalid_address_format',
      chainId: 'polygon',
      name: 'Invalid Token',
      symbol: 'BAD',
      decimals: 18,
      priceUSD: 1.0,
      verificationTier: 'UNVERIFIED'
    };

    const fullQuote: any = {
      protocol: 'ZENITH_V3',
      provider: 'ZENITH_V3',
      request: {
        sourceChainId: polygonChainId,
        destinationChainId: polygonChainId,
        tokenIn: invalidToken,
        tokenOut: usdcToken,
        amountInRaw: '1000000000000000000',
        slippageToleranceBps: 50,
        userAddress
      },
      amountInRaw: '1000000000000000000',
      amountInFormatted: '1.0',
      amountOutRaw: '1000000',
      minimumReceivedRaw: '990000',
      executionTarget: v3RouterAddress,
      approvalTarget: v3RouterAddress,
      dexQuote: { amountOut: 1000000n, minimumAmountOut: 990000n },
      bestRoute: { execution: { to: v3RouterAddress, data: '0x1234', value: '0' } }
    };

    const mockSigner: any = { provider: {} };
    await assert.rejects(
      async () => {
        await adapter.executeSwap({ quote: fullQuote, userAddress, signer: mockSigner });
      },
      (err: any) => {
        assert.ok(err instanceof InvalidTokenAddressError || err.message.includes('Invalid'));
        return true;
      }
    );
  });

  await t.test('Negative Test F: Pool Not Found Simulation Revert', async () => {
    const amountIn = 10n ** 18n;
    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj);
    const execution = await v3Provider.buildExecution(quoteObj, userAddress);

    const fullQuote: any = {
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
      amountOutRaw: quoteObj.amountOut.toString(),
      minimumReceivedRaw: quoteObj.minimumAmountOut.toString(),
      executionTarget: v3RouterAddress,
      approvalTarget: CANONICAL_NATIVE_ADDRESS,
      dexQuote: quoteObj,
      bestRoute: {
        dexQuote: quoteObj,
        execution
      }
    };

    const mockSigner: any = {
      provider: {
        getBalance: async () => 5n * 10n ** 18n,
        call: async () => {
          const revertErr: any = new Error('execution reverted: ZenithV3Router: POOL_NOT_FOUND');
          revertErr.reason = 'ZenithV3Router: POOL_NOT_FOUND';
          throw revertErr;
        }
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({ quote: fullQuote, userAddress, signer: mockSigner });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithSimulationFailedError);
        assert.ok(err.revertReason?.includes('POOL_NOT_FOUND'));
        return true;
      }
    );
  });

  await t.test('Negative Test G: Slippage Limit Exceeded Simulation Revert', async () => {
    const amountIn = 10n ** 18n;
    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj);
    const execution = await v3Provider.buildExecution(quoteObj, userAddress);

    const fullQuote: any = {
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
      amountOutRaw: quoteObj.amountOut.toString(),
      minimumReceivedRaw: quoteObj.minimumAmountOut.toString(),
      executionTarget: v3RouterAddress,
      approvalTarget: CANONICAL_NATIVE_ADDRESS,
      dexQuote: quoteObj,
      bestRoute: { dexQuote: quoteObj, execution }
    };

    const mockSigner: any = {
      provider: {
        getBalance: async () => 5n * 10n ** 18n,
        call: async () => {
          const revertErr: any = new Error('execution reverted: ZenithV3Router: SLIPPAGE');
          revertErr.reason = 'ZenithV3Router: SLIPPAGE';
          throw revertErr;
        }
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({ quote: fullQuote, userAddress, signer: mockSigner });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithSimulationFailedError);
        assert.ok(err.revertReason?.includes('SLIPPAGE'));
        return true;
      }
    );
  });

  await t.test('Negative Test H: Expired Deadline Simulation Revert', async () => {
    const amountIn = 10n ** 18n;
    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj);
    // Build execution with expired deadline
    const execution = await v3Provider.buildExecution(quoteObj, userAddress, undefined, Math.floor(Date.now() / 1000) - 3600);

    const fullQuote: any = {
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
      amountOutRaw: quoteObj.amountOut.toString(),
      minimumReceivedRaw: quoteObj.minimumAmountOut.toString(),
      executionTarget: v3RouterAddress,
      approvalTarget: CANONICAL_NATIVE_ADDRESS,
      dexQuote: quoteObj,
      bestRoute: { dexQuote: quoteObj, execution }
    };

    const mockSigner: any = {
      provider: {
        getBalance: async () => 5n * 10n ** 18n,
        call: async () => {
          const revertErr: any = new Error('execution reverted: ZenithV3Router: EXPIRED');
          revertErr.reason = 'ZenithV3Router: EXPIRED';
          throw revertErr;
        }
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({ quote: fullQuote, userAddress, signer: mockSigner });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithSimulationFailedError);
        assert.ok(err.revertReason?.includes('EXPIRED'));
        return true;
      }
    );
  });

  await t.test('Negative Test I: Invalid Slippage Bounds (minOut > amountOut)', async () => {
    const amountIn = 10n ** 18n;
    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj);
    const execution = await v3Provider.buildExecution(quoteObj, userAddress);

    const fullQuote: any = {
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
      amountOutRaw: '1000000', // 1.0 USDC
      minimumReceivedRaw: '2000000', // 2.0 USDC (impossible minimumReceived > quoted)
      executionTarget: v3RouterAddress,
      approvalTarget: CANONICAL_NATIVE_ADDRESS,
      bestRoute: {
        dexQuote: quoteObj,
        execution
      }
    };

    const mockSigner: any = {
      provider: {
        getBalance: async () => 5n * 10n ** 18n
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({ quote: fullQuote, userAddress, signer: mockSigner });
      },
      (err: any) => {
        assert.ok(err.message.includes('Slippage bounds invalid'), `Actual error was: ${err.message}`);
        return true;
      }
    );
  });

  await t.test('Negative Test J: Gas Estimation Failure Rejection', async () => {
    const amountIn = 10n ** 18n;
    const quoteObj = await v3Provider.getQuote({
      chainId: polygonChainId,
      tokenIn: polToken,
      tokenOut: usdcToken,
      amountIn,
      slippageToleranceBps: 50
    });
    assert.ok(quoteObj);
    const execution = await v3Provider.buildExecution(quoteObj, userAddress);

    const fullQuote: any = {
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
      amountOutRaw: quoteObj.amountOut.toString(),
      minimumReceivedRaw: quoteObj.minimumAmountOut.toString(),
      executionTarget: v3RouterAddress,
      approvalTarget: CANONICAL_NATIVE_ADDRESS,
      dexQuote: quoteObj,
      bestRoute: { dexQuote: quoteObj, execution }
    };

    const mockSigner: any = {
      provider: {
        getBalance: async () => 5n * 10n ** 18n,
        call: async () => '0x0000000000000000000000000000000000000000000000000000000000065b90'
      },
      estimateGas: async () => {
        const gasErr: any = new Error('Gas estimation failed: execution reverted');
        gasErr.reason = 'TRANSFER_FAILED';
        throw gasErr;
      }
    };

    await assert.rejects(
      async () => {
        await adapter.executeSwap({ quote: fullQuote, userAddress, signer: mockSigner });
      },
      (err: any) => {
        assert.ok(err instanceof ZenithSimulationFailedError);
        assert.ok(err.message.includes('Gas estimation (eth_estimateGas) failed'));
        return true;
      }
    );
  });
});
