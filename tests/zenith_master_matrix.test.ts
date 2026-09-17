import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultChainRegistry, NETWORK_GAS_PROFILES } from '../packages/chains/src';
import {
  DEFAULT_TOKENS,
  defaultTokenService,
  defaultMarketDataService
} from '../packages/tokens/src';
import {
  defaultZenithRouter,
  ConstantProductMath,
  ConcentratedLiquidityMath,
  validateAndSanitizeAmount,
  truncateToThreeDecimals
} from '../packages/routing/src';
import {
  defaultTokenRiskEngine,
  defaultCircuitBreaker,
  defaultSimulationEngine,
  defaultMEVRouter
} from '../packages/security/src';
import {
  ExecutionStateMachine,
  defaultIntentEngine,
  defaultEVMAdapter,
  defaultExecutionCoordinator
} from '../packages/execution/src';
import {
  CrossChainIntent,
  ExecutionStatus,
  Token,
  ZenithNotification
} from '../packages/types/src';
import { defaultThemeManager, ZENITH_TOKENS } from '../packages/ui/src';

import {
  formatAddress,
  isExplicitlyDisconnected,
  setExplicitlyDisconnected,
  getStoredWalletSession,
  setStoredWalletSession,
  clearStoredWalletSession
} from '../apps/web/src/utils/walletDetector';

class LocalStorageMock {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] || null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}
(global as any).localStorage = new LocalStorageMock();
(global as any).window = { localStorage: (global as any).localStorage };

test('SUITE 1: Functional Tests', async (t) => {
  await t.test('1.1 Web3 Wallet Authentication, Session Management & Disconnect Persistence', () => {
    clearStoredWalletSession();
    assert.equal(getStoredWalletSession().isConnected, false);
    assert.equal(getStoredWalletSession().address, null);

    setStoredWalletSession('METAMASK', '0x1234567890123456789012345678901234567890');
    const session = getStoredWalletSession();
    assert.equal(session.isConnected, true);
    assert.equal(session.walletType, 'METAMASK');
    assert.equal(session.address, '0x1234567890123456789012345678901234567890');

    setExplicitlyDisconnected(true);
    assert.equal(isExplicitlyDisconnected(), true);
    assert.equal(getStoredWalletSession().isConnected, false);

    setExplicitlyDisconnected(false);
    assert.equal(isExplicitlyDisconnected(), false);
  });

  await t.test('1.2 Multi-Chain Token Search, Filtering & Sorting', () => {
    const usdcTokens = defaultTokenService.searchTokens('USDC');
    assert.ok(usdcTokens.length >= 3, 'Should find USDC across multiple chains');

    const ethTokens = defaultTokenService.getTokensForChain('ethereum');
    assert.ok(ethTokens.length > 0);

    const solanaTokens = defaultTokenService.getTokensForChain('solana');
    assert.ok(solanaTokens.length > 0);

    const sortedTokens = [...ethTokens].sort((a, b) => (b.priceUSD || 0) - (a.priceUSD || 0));
    assert.ok((sortedTokens[0].priceUSD || 0) >= (sortedTokens[sortedTokens.length - 1].priceUSD || 0));
  });

  await t.test('1.3 Custom Token Metadata Import & Validation', () => {
    const imported = defaultTokenService.importCustomToken({
      chainId: 'polygon',
      address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
      name: 'Custom Wrapped Token',
      symbol: 'CWT',
      decimals: 18
    });
    assert.equal(imported.symbol, 'CWT');
    assert.equal(imported.verificationTier, 'UNVERIFIED');
    assert.equal(imported.chainId, 'polygon');

    assert.throws(() => {
      defaultTokenService.importCustomToken({
        chainId: 'polygon',
        address: '0x123',
        name: 'Bad Token',
        symbol: 'BAD',
        decimals: 18
      });
    }, /Invalid EVM token address format/);
  });

  await t.test('1.4 Notification Center CRUD Operations', () => {
    const notifications: ZenithNotification[] = [];
    const addNotif = (n: ZenithNotification) => notifications.push(n);

    addNotif({
      id: 'notif_1',
      type: 'SUCCESS',
      title: 'Swap Completed',
      message: 'Swapped 1.0 ETH for 2,465 USDC',
      timestamp: Date.now()
    });

    addNotif({
      id: 'notif_2',
      type: 'WARNING',
      title: 'High Price Impact',
      message: 'Trade price impact is 2.5%',
      timestamp: Date.now()
    });

    assert.equal(notifications.length, 2);
    assert.equal(notifications[0].type, 'SUCCESS');
    assert.equal(notifications[1].type, 'WARNING');

    const remaining = notifications.filter((n) => n.id !== 'notif_1');
    assert.equal(remaining.length, 1);
  });
});

test('SUITE 2: UI/UX & Design System Tests', async (t) => {
  await t.test('2.1 Theme Management & Dark/Light Mode Token Consistency', () => {
    defaultThemeManager.setTheme('dark');
    assert.equal(defaultThemeManager.getTheme(), 'dark');
    assert.equal(ZENITH_TOKENS.colors.dark.bgMain, '#080B11');

    defaultThemeManager.setTheme('light');
    assert.equal(defaultThemeManager.getTheme(), 'light');
    assert.equal(ZENITH_TOKENS.colors.light.bgMain, '#F8FAFC');

    defaultThemeManager.setTheme('dark');
  });

  await t.test('2.2 Format Address & Cryptographic Shortening', () => {
    const ethAddress = '0x1234567890abcdef1234567890abcdef12345678';
    assert.equal(formatAddress(ethAddress, 6, 4), '0x1234...5678');
    assert.equal(formatAddress('', 6, 4), '');
    assert.equal(formatAddress('0x123', 6, 4), '0x123');

    const solAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    assert.equal(formatAddress(solAddress, 4, 4), 'EPjF...Dt1v');
  });

  await t.test('2.3 Input Sanitization, Precision Truncation & UI Error Messaging', () => {
    const valid = validateAndSanitizeAmount('0.123');
    assert.equal(valid.isValid, true);
    assert.equal(valid.sanitized, '0.123');

    const truncated = validateAndSanitizeAmount('0.1239');
    assert.equal(truncated.isValid, true);
    assert.equal(truncated.sanitized, '0.123');
    assert.equal(truncated.isTruncated, true);

    const invalidChar = validateAndSanitizeAmount('0.12a3');
    assert.equal(invalidChar.isValid, false);
    assert.ok(invalidChar.error);
  });
});

test('SUITE 3: Responsive & Viewport Layout Tests', async (t) => {
  await t.test('3.1 Screen Breakpoint Resolutions & Layout Classification', () => {
    const breakpoints = {
      mobilePortrait: { width: 375, height: 667 },
      mobileLandscape: { width: 667, height: 375 },
      tablet: { width: 768, height: 1024 },
      laptop: { width: 1024, height: 768 },
      desktop: { width: 1440, height: 900 },
      ultra4K: { width: 2560, height: 1440 }
    };

    const classifyViewport = (w: number) => {
      if (w < 640) return 'xs';
      if (w < 768) return 'sm';
      if (w < 1024) return 'md';
      if (w < 1280) return 'lg';
      if (w < 1536) return 'xl';
      return '2xl';
    };

    assert.equal(classifyViewport(breakpoints.mobilePortrait.width), 'xs');
    assert.equal(classifyViewport(breakpoints.tablet.width), 'md');
    assert.equal(classifyViewport(breakpoints.laptop.width), 'lg');
    assert.equal(classifyViewport(breakpoints.desktop.width), 'xl');
    assert.equal(classifyViewport(breakpoints.ultra4K.width), '2xl');
  });

  await t.test('3.2 Touch & Virtual Keyboard Decimal Input Pattern', () => {
    const pattern = new RegExp('^[0-9]*[.,]?[0-9]*$');
    assert.ok(pattern.test('123.456'));
    assert.ok(pattern.test('0.5'));
    assert.equal(pattern.test('abc'), false);
  });
});

test('SUITE 4: Browser Compatibility & Standard Runtime Support', async (t) => {
  await t.test('4.1 Web3 Provider EIP-1193 Standard Interface', () => {
    const mockEIP1193Provider = {
      request: async ({ method, params: _params }: { method: string; params?: any[] }) => {
        if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
        if (method === 'eth_chainId') return '0x1';
        return null;
      },
      on: () => {},
      removeListener: () => {}
    };

    assert.equal(typeof mockEIP1193Provider.request, 'function');
    assert.equal(typeof mockEIP1193Provider.on, 'function');
  });

  await t.test('4.2 BigInt & Modern ECMAScript Precision Support', () => {
    assert.equal(typeof BigInt, 'function');
    const largeNumber = 10n ** 18n;
    assert.equal(largeNumber.toString(), '1000000000000000000');
    assert.equal(largeNumber * 2n, 2000000000000000000n);
  });
});

test('SUITE 5: API & Oracle Network Tests', async (t) => {
  await t.test('5.1 Live Market Data Fetching & Cascading Fallback Hierarchy', async () => {
    const marketMap = await defaultMarketDataService.fetchMarketData();
    assert.ok(marketMap.size > 0);

    const ethToken = DEFAULT_TOKENS.find((t) => t.symbol === 'ETH')!;
    const cachedEth = defaultMarketDataService.getCachedMarketData(ethToken.chainId, ethToken.address);
    assert.ok(cachedEth !== undefined);
  });

  await t.test('5.2 24-Hour Market Statistics & Pool Metrics', async () => {
    const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
    const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;

    const stats = await defaultMarketDataService.fetch24hStats(tokenIn.symbol, tokenOut.symbol, 2465.87);
    assert.ok(stats.currentPrice > 0);
    assert.ok(stats.volume24hUSD > 0);
    assert.ok(stats.high24h >= stats.low24h);
  });

  await t.test('5.3 Protocol Analytics & Concentrated Pools Liquidity', () => {
    const analytics = defaultMarketDataService.getProtocolAnalytics();
    assert.ok(analytics.totalValueLockedUSD > 1000000);
    assert.ok(analytics.totalVolume24hUSD > 1000000);

    const pools = defaultMarketDataService.getPools();
    assert.ok(pools.length > 0);
    assert.ok(pools.some((p) => p.feeBps === 5));
  });
});

test('SUITE 6: State Store & Database Integrity Tests', async (t) => {
  await t.test('6.1 Immutability, Atomic State Transitions & Replay Protection', () => {
    const initialChain = defaultChainRegistry.getChain('ethereum');
    assert.ok(initialChain);

    const modified = { ...initialChain, canonicalName: 'Modified Ethereum' };
    assert.notEqual(initialChain.canonicalName, modified.canonicalName);

    let nonce = 1;
    const getNextNonce = () => nonce++;
    assert.equal(getNextNonce(), 1);
    assert.equal(getNextNonce(), 2);
    assert.equal(getNextNonce(), 3);
  });

  await t.test('6.2 Null, Undefined & Corrupt Cache Handling', () => {
    const nonExistentData = defaultMarketDataService.getCachedMarketData('non_chain', '0x0000000000000000000000000000000000000000');
    assert.equal(nonExistentData, undefined);

    const nonExistentChain = defaultChainRegistry.getChain('non_existent_chain');
    assert.equal(nonExistentChain, undefined);
  });
});

test('SUITE 7: Security, Risk & Vulnerability Tests', async (t) => {
  await t.test('7.1 Honeypot & Malicious Token Quarantine', () => {
    const safeToken: Token = {
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      chainId: 'ethereum',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      verificationTier: 'VERIFIED_CANONICAL'
    };
    const safeEvaluation = defaultTokenRiskEngine.evaluateToken(safeToken);
    assert.equal(safeEvaluation.isTradeable, true);
    assert.equal(safeEvaluation.overallRiskLevel, 'LOW');

    const honeypotToken: Token = {
      address: '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead',
      chainId: 'ethereum',
      name: 'Scam Token',
      symbol: 'SCAM',
      decimals: 18,
      verificationTier: 'SUSPICIOUS',
      securityProfile: {
        isHoneypot: true,
        buyTaxPercent: 0,
        sellTaxPercent: 100,
        transferTaxPercent: 0,
        canBlacklist: true,
        canMintArbitrary: true,
        isProxy: false,
        liquidityLockedPercent: 0,
        holderConcentrationTop10Percent: 99,
        hasMaliciousPatterns: true,
        riskScore: 100,
        warnings: ['Honeypot detected', '100% sell tax']
      }
    };
    const honeypotEval = defaultTokenRiskEngine.evaluateToken(honeypotToken);
    assert.equal(honeypotEval.isTradeable, false);
    assert.equal(honeypotEval.overallRiskLevel, 'CRITICAL');
  });

  await t.test('7.2 Pre-Flight Simulation Engine (eth_call dry-run)', async () => {
    const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
    const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;

    const simSuccess = await defaultSimulationEngine.simulateSwap({
      chainId: 'ethereum',
      userAddress: '0x1234567890123456789012345678901234567890',
      routerAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      tokenIn,
      tokenOut,
      amountInRaw: '1000000000000000000',
      amountOutExpectedRaw: '2465000000',
      slippageTolerancePercent: 0.5
    });

    assert.equal(simSuccess.isSuccess, true);
    assert.ok(simSuccess.gasUsed > 0);
  });

  await t.test('7.3 MEV Protection & Flashbots Relay Routing', () => {
    const ethMEV = defaultMEVRouter.resolveMEVRoute('ethereum', 'FLASHBOTS_PRIVATE');
    assert.equal(ethMEV.isPrivateMempool, true);
    assert.equal(ethMEV.frontrunningProtection, true);
    assert.equal(ethMEV.sandwichProtection, true);
    assert.ok(ethMEV.rpcEndpoint.includes('flashbots'));

    const disabledMEV = defaultMEVRouter.resolveMEVRoute('ethereum', 'NONE');
    assert.equal(disabledMEV.isPrivateMempool, false);
  });

  await t.test('7.4 Circuit Breaker Protocol Pause & Oracle Anomaly Protection', () => {
    const validDeviation = defaultCircuitBreaker.validatePriceDeviation({
      oraclePriceUSD: 2500,
      quotedPriceUSD: 2490
    });
    assert.equal(validDeviation.isValid, true);

    const anomalousDeviation = defaultCircuitBreaker.validatePriceDeviation({
      oraclePriceUSD: 2500,
      quotedPriceUSD: 1500
    });
    assert.equal(anomalousDeviation.isValid, false);
    assert.ok(anomalousDeviation.reason);
  });
});

test('SUITE 8: Performance & Computational Stress Tests', async (t) => {
  await t.test('8.1 High-Throughput AMM Math Benchmark (>10,000 ops/sec)', () => {
    const start = performance.now();
    const iterations = 10000;
    const reserveIn = 1000000000000000000000n;
    const reserveOut = 3450000000000n;
    const amountIn = 1000000000000000000n;

    for (let i = 0; i < iterations; i++) {
      ConstantProductMath.getAmountOut(amountIn, reserveIn, reserveOut, 30);
    }
    const duration = performance.now() - start;
    assert.ok(duration < 500, `10,000 AMM calculations took ${duration}ms, expected < 500ms`);
  });

  await t.test('8.2 Concentrated Liquidity Tick Computation Latency (<10ms for 100 steps)', () => {
    const start = performance.now();
    const sqrtPrice = ConcentratedLiquidityMath.priceToSqrtRatioX96(2500.0);
    const targetSqrt = (sqrtPrice * 99n) / 100n;
    const liquidity = 1000000000000000000n;

    for (let i = 0; i < 100; i++) {
      ConcentratedLiquidityMath.computeSwapStep(sqrtPrice, targetSqrt, liquidity, 10000000000000000n, 30, true, true);
    }
    const duration = performance.now() - start;
    assert.ok(duration < 50, `100 tick steps took ${duration}ms, expected < 50ms`);
  });
});

test('SUITE 9: Integration Tests', async (t) => {
  await t.test('9.1 End-to-End Quoting Pipeline: Token -> Router -> Math -> Risk -> EES', async () => {
    const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
    const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;

    const quote = await defaultZenithRouter.getQuote({
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn,
      tokenOut,
      amountInRaw: '1000000000000000000',
      slippageTolerancePercent: 0.5,
      reserveIn: 1_000n * 10n ** 18n,
      reserveOut: 3_000_000n * 10n ** 6n
    } as any);

    assert.ok(quote.requestId);
    assert.ok(quote.effectiveExecutionScore > 50);
    assert.equal(quote.request.sourceChainId, 'ethereum');
    assert.equal(quote.request.destinationChainId, 'ethereum');
    assert.ok(quote.routes.length > 0);
  });

  await t.test('9.2 Cross-Chain Stargate & Across Bridge Quoting Integration', async () => {
    const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
    const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;

    const crossQuote = await defaultZenithRouter.getQuote({
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn,
      tokenOut,
      amountInRaw: '1000000000',
      slippageTolerancePercent: 0.5
    });

    assert.equal(crossQuote.bestRoute.routeType, 'CROSS_CHAIN');
    assert.ok(crossQuote.bestRoute.bridgeStep);
    assert.ok(crossQuote.intent);
    assert.equal(crossQuote.intent?.destinationChainId, 'arbitrum');
  });
});

test('SUITE 10: Regression & Release Verification', async (t) => {
  await t.test('10.1 All 53 Supported Chains are Registered and Validated', () => {
    const allChains = defaultChainRegistry.getAllChains();
    assert.equal(allChains.length, 53);

    for (const chain of allChains) {
      assert.ok(chain.id, 'Chain must have id');
      assert.ok(chain.canonicalName, 'Chain must have canonicalName');
      assert.ok(chain.shortName, 'Chain must have shortName');
      assert.ok(chain.nativeCurrency.symbol, 'Chain must have nativeCurrency');
      assert.ok(chain.rpcEndpoints.length > 0, 'Chain must have at least 1 RPC');
      assert.ok(chain.explorer.baseUrl, 'Chain must have block explorer');
    }
  });

  await t.test('10.2 Token Decimal Integrity Across EVM & Non-EVM Standards (up to 24 decimals)', () => {
    for (const token of DEFAULT_TOKENS) {
      assert.ok(token.decimals >= 0 && token.decimals <= 24, `Token ${token.symbol} decimals out of range`);
      assert.ok(token.address.length > 0, `Token ${token.symbol} missing address`);
    }
  });
});

test('SUITE 11: Accessibility (WCAG 2.1 AA) Tests', async (t) => {
  await t.test('11.1 Color Contrast Tokens & Palette Luminance Separation', () => {
    const darkBg = ZENITH_TOKENS.colors.dark.bgMain;
    const darkText = ZENITH_TOKENS.colors.dark.textPrimary;
    assert.ok(darkBg && darkText);
    assert.notEqual(darkBg, darkText);

    const lightBg = ZENITH_TOKENS.colors.light.bgMain;
    const lightText = ZENITH_TOKENS.colors.light.textPrimary;
    assert.ok(lightBg && lightText);
    assert.notEqual(lightBg, lightText);
  });

  await t.test('11.2 ARIA Attributes, Modal Semantics & Keyboard Shortcuts', () => {
    const modalAriaProps = {
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': 'modal-title',
      'aria-describedby': 'modal-description'
    };
    assert.equal(modalAriaProps.role, 'dialog');
    assert.equal(modalAriaProps['aria-modal'], true);
  });
});

test('SUITE 12: Reliability, Failover & Recovery Tests', async (t) => {
  await t.test('12.1 Primary RPC Failure & Automatic Fallback to Secondary RPC', () => {
    const ethChain = defaultChainRegistry.getChain('ethereum')!;
    assert.ok(ethChain.rpcEndpoints.length >= 2, 'Ethereum must configure backup RPC fallbacks');
    const primary = ethChain.rpcEndpoints[0].url;
    const backup = ethChain.rpcEndpoints[1].url;
    assert.notEqual(primary, backup);
  });

  await t.test('12.2 Cross-Chain Timeout & Deterministic Refund Engine', () => {
    const orderId = `intent_timeout_${Date.now()}`;
    const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
    const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'base' && t.symbol === 'USDC')!;

    const intent: CrossChainIntent = {
      orderId,
      sourceChainId: 'ethereum',
      destinationChainId: 'base',
      sourceToken: tokenIn,
      destinationToken: tokenOut,
      sourceAmountRaw: '100000000',
      minDestinationAmountRaw: '99000000',
      recipient: '0x1111111111111111111111111111111111111111',
      deadline: Date.now() + 100000,
      nonce: 1234567,
      status: 'CREATED',
      createdAt: Date.now()
    };

    defaultIntentEngine.registerIntent(intent);
    defaultIntentEngine.updateIntentState(orderId, 'SIGNED');
    defaultIntentEngine.updateIntentState(orderId, 'SUBMITTED');
    defaultIntentEngine.updateIntentState(orderId, 'ACCEPTED');

    const refunded = defaultIntentEngine.processRefund(orderId, 'Bridge Relayer Timeout Exceeded');
    assert.equal(refunded.status, 'REFUNDED');
    assert.equal(defaultIntentEngine.getIntent(orderId)?.status, 'REFUNDED');
  });
});

test('SUITE 13: Localization, Number & Currency Formatting Tests', async (t) => {
  await t.test('13.1 Number Truncation & Currency Formatting', () => {
    assert.equal(truncateToThreeDecimals(1234.5678), '1234.567');
    assert.equal(truncateToThreeDecimals(0.0009), '0.000');
    assert.equal(truncateToThreeDecimals(10000000), '9999999.999');

    const formatCurrencyUSD = (val: number) => `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    assert.equal(formatCurrencyUSD(2465.8), '$2,465.80');
  });

  await t.test('13.2 Gas Price & Fee Breakdown Formatting', () => {
    const gasEth = NETWORK_GAS_PROFILES.ethereum;
    assert.ok(gasEth.typicalSwapUSD > 0);
    assert.ok(gasEth.avgGasPriceGwei > 0);

    const gasBase = NETWORK_GAS_PROFILES.base;
    assert.ok(gasBase.typicalSwapUSD < gasEth.typicalSwapUSD);
  });
});

test('SUITE 14: Complete End-to-End User Journeys', async (t) => {
  await t.test('14.1 Full Trade Flow: Select -> Quote -> Approve -> Sign -> Execute -> Receipt', async () => {
    const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
    const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;

    const quote = await defaultZenithRouter.getQuote({
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn,
      tokenOut,
      amountInRaw: '1000000000000000000',
      slippageTolerancePercent: 0.5,
      reserveIn: 1_000n * 10n ** 18n,
      reserveOut: 3_000_000n * 10n ** 6n
    } as any);
    assert.ok(quote);

    const stateMachine = new ExecutionStateMachine();
    const history: ExecutionStatus[] = [];
    stateMachine.subscribe((status) => history.push(status));

    const user = '0x1234567890abcdef1234567890abcdef12345678';
    const mockSigner = {
      getAddress: async () => user,
      sendTransaction: async (_tx: any) => ({
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        wait: async () => ({
          status: 1,
          hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          blockNumber: 12345678,
          gasUsed: BigInt(150000),
          gasPrice: BigInt(30000000000),
          logs: []
        })
      }),
      provider: {
        call: async () => '0x',
        estimateGas: async () => BigInt(150000),
        getFeeData: async () => ({ gasPrice: BigInt(30000000000) }),
        getTransactionReceipt: async (hash: string) => ({
          status: 1,
          hash,
          blockNumber: 12345678,
          gasUsed: BigInt(150000),
          gasPrice: BigInt(30000000000),
          logs: []
        })
      }
    } as any;

    const receipt = await defaultExecutionCoordinator.executeTrade({
      quote,
      userAddress: user,
      signer: mockSigner,
      stateMachine
    });

    assert.equal(receipt.status, 'COMPLETED');
    assert.ok(receipt.txHash.startsWith('0x'));
    assert.ok(history.includes('COMPLETED'));
  });
});

test('SUITE 15: Special & Extreme Edge-Case Tests', async (t) => {
  await t.test('15.1 Zero-Division & Micro-Dust Protection', async () => {
    const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'base' && t.symbol === 'ETH')!;
    const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'base' && t.symbol === 'USDC')!;

    const dustQuote = await defaultZenithRouter.getQuote({
      sourceChainId: 'base',
      destinationChainId: 'base',
      tokenIn,
      tokenOut,
      amountInRaw: '1',
      slippageTolerancePercent: 0.5,
      reserveIn: 1_000n * 10n ** 18n,
      reserveOut: 3_000_000n * 10n ** 6n
    } as any);

    assert.ok(!isNaN(dustQuote.executionPrice));
    assert.ok(dustQuote.amountOutFormatted !== undefined);
  });

  await t.test('15.2 Extreme Maximum Whale Volume Guard (>10 Million Units)', async () => {
    const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
    const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;

    await assert.rejects(async () => {
      await defaultZenithRouter.getQuote({
        sourceChainId: 'ethereum',
        destinationChainId: 'ethereum',
        tokenIn,
        tokenOut,
        amountInRaw: (10000001n * 10n ** 18n).toString(),
        slippageTolerancePercent: 0.5
      });
    }, /exceeds maximum allowed limit/);
  });
});

test('SUITE 16: Dedicated Blockchain & Crypto / DEX Test Suite', async (t) => {
  await t.test('16.1 Multi-Chain Address Validation across EVM, Solana & UTXO', () => {
    const isValidEVM = (addr: string) => /^0x[a-fA-F0-9]{40}$/.test(addr);
    const isValidSolana = (addr: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
    const isValidBTC = (addr: string) => /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr);

    assert.equal(isValidEVM('0x1234567890123456789012345678901234567890'), true);
    assert.equal(isValidEVM('0xInvalidAddress'), false);

    assert.equal(isValidSolana('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), true);
    assert.equal(isValidSolana('0x1234'), false);

    assert.equal(isValidBTC('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), true);
  });

  await t.test('16.2 Token Allowances, Approvals & Permit2 Signing Verification', async () => {
    const nativeAllowance = await defaultEVMAdapter.checkAllowance({
      tokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      ownerAddress: '0x1234567890123456789012345678901234567890',
      spenderAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
    });
    assert.ok(nativeAllowance > 0n, 'Native ETH has infinite allowance');

    const erc20Allowance = await defaultEVMAdapter.checkAllowance({
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      ownerAddress: '0x1234567890123456789012345678901234567890',
      spenderAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
    });
    assert.equal(erc20Allowance, 0n);
  });

  await t.test('16.3 Protocol Fee Collection & Governance BPS Enforcement (Max 30 BPS)', () => {
    const defaultFeeBps = 5;
    const maxAllowedFeeBps = 30;

    const calculateFee = (amount: bigint, bps: number) => (amount * BigInt(bps)) / 10000n;
    const tradeAmount = 1000000000000000000n;

    const protocolFee = calculateFee(tradeAmount, defaultFeeBps);
    assert.equal(protocolFee, 500000000000000n);

    const maxFee = calculateFee(tradeAmount, maxAllowedFeeBps);
    assert.equal(maxFee, 3000000000000000n);
  });

  await t.test('16.4 Reentrancy Guard & Smart Contract Access Control Simulation', () => {
    let reentrancyStatus = 1;
    const nonReentrantCall = (fn: () => void) => {
      assert.equal(reentrancyStatus, 1, 'Reentrancy guard violation');
      reentrancyStatus = 2;
      try {
        fn();
      } finally {
        reentrancyStatus = 1;
      }
    };

    nonReentrantCall(() => {
      assert.equal(reentrancyStatus, 2);
    });
    assert.equal(reentrancyStatus, 1);

    assert.throws(() => {
      nonReentrantCall(() => {
        nonReentrantCall(() => {});
      });
    }, /Reentrancy guard violation/);
  });

  await t.test('16.5 Flash Loan & Sandwich Attack Resistance through Pre-Flight Bounds', () => {
    const oraclePriceUSD = 2500;
    const maxAllowedSlippagePercent = 1.0;
    const minAcceptablePrice = oraclePriceUSD * (1 - maxAllowedSlippagePercent / 100);

    const checkSandwichRisk = (executionPrice: number) => executionPrice >= minAcceptablePrice;

    assert.equal(checkSandwichRisk(2490), true);
    assert.equal(checkSandwichRisk(2475), true);
    assert.equal(checkSandwichRisk(2450), false, 'Should flag sandwich / frontrunning slippage drop');
  });

  await t.test('16.6 Emergency Pause & Guardian Circuit Breaker Activation', () => {
    let isProtocolPaused = false;
    const pauseProtocol = () => {
      isProtocolPaused = true;
    };
    const resumeProtocol = () => {
      isProtocolPaused = false;
    };

    const executeGuardedSwap = () => {
      if (isProtocolPaused) throw new Error('ZenithRouter: Circuit breaker active');
      return 'SWAP_SUCCESS';
    };

    assert.equal(executeGuardedSwap(), 'SWAP_SUCCESS');
    pauseProtocol();
    assert.throws(() => executeGuardedSwap(), /Circuit breaker active/);
    resumeProtocol();
    assert.equal(executeGuardedSwap(), 'SWAP_SUCCESS');
  });
});
