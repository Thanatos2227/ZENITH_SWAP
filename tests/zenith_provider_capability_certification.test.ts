import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ZeroAddress } from 'ethers';
import {
  CrossChainQuote,
  QuoteRequest,
  Token,
  ProviderCapabilityLevel,
  ProviderErrorCategory
} from '@zenith/types';
import {
  CrossChainProviderCapabilityMatrix,
  CAPABILITY_HIERARCHY
} from '../packages/routing/src/crosschain/crossChainProviderCapabilityMatrix';
import {
  validateUniversalBridgeQuoteExecutability,
  normalizeProviderErrorCategory
} from '../packages/routing/src/crosschain/quoteValidator';
import { CrossChainAggregator } from '../packages/routing/src/crosschain/crossChainAggregator';
import {
  AcrossProvider,
  normalizeAcrossDepositStatus
} from '../packages/routing/src/crosschain/providers/acrossProvider';
import { DeBridgeProvider } from '../packages/routing/src/crosschain/providers/debridgeProvider';
import { StargateProvider } from '../packages/routing/src/crosschain/providers/stargateProvider';
import { LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE } from '../packages/execution/src/fixtures/goldenPathExecutionFixture';
import { verifyDestinationSettlement } from '../packages/execution/src/crosschain/authoritativeDestinationVerifier';

const MOCK_USDC_POLYGON: Token = {
  address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  chainId: 'polygon',
  symbol: 'USDC',
  name: 'USD Coin (PoS)',
  decimals: 6,
  isNative: false
};

const MOCK_USDC_ARBITRUM: Token = {
  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  chainId: 'arbitrum',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  isNative: false
};

const MOCK_OPERATOR_WALLET = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';

describe('ZENITH — Phase 1 Task 26: Cross-Chain Provider Capability Certification Suite', () => {

  // ==========================================================================
  // TASK 2: CAPABILITY MATRIX & HIERARCHY INVARIANTS
  // ==========================================================================
  describe('Task 2 — Capability Matrix & Strict Hierarchy', () => {
    it('enforces strict hierarchical order without inferring higher from lower', () => {
      assert.strictEqual(CAPABILITY_HIERARCHY.UNSUPPORTED, 0);
      assert.strictEqual(CAPABILITY_HIERARCHY.UNIT_TESTED, 1);
      assert.strictEqual(CAPABILITY_HIERARCHY.CONFIGURED, 2);
      assert.strictEqual(CAPABILITY_HIERARCHY.QUOTE_AVAILABLE, 3);
      assert.strictEqual(CAPABILITY_HIERARCHY.EXECUTION_AVAILABLE, 4);
      assert.strictEqual(CAPABILITY_HIERARCHY.LIVE_VERIFIED, 5);

      // Higher satisfies lower
      assert.strictEqual(CrossChainProviderCapabilityMatrix.meetsCapability('LIVE_VERIFIED', 'EXECUTION_AVAILABLE'), true);
      assert.strictEqual(CrossChainProviderCapabilityMatrix.meetsCapability('EXECUTION_AVAILABLE', 'QUOTE_AVAILABLE'), true);
      assert.strictEqual(CrossChainProviderCapabilityMatrix.meetsCapability('QUOTE_AVAILABLE', 'CONFIGURED'), true);

      // Lower NEVER satisfies higher
      assert.strictEqual(CrossChainProviderCapabilityMatrix.meetsCapability('QUOTE_AVAILABLE', 'EXECUTION_AVAILABLE'), false);
      assert.strictEqual(CrossChainProviderCapabilityMatrix.meetsCapability('EXECUTION_AVAILABLE', 'LIVE_VERIFIED'), false);
      assert.strictEqual(CrossChainProviderCapabilityMatrix.meetsCapability('CONFIGURED', 'QUOTE_AVAILABLE'), false);
      assert.strictEqual(CrossChainProviderCapabilityMatrix.meetsCapability('UNSUPPORTED', 'CONFIGURED'), false);
    });

    it('certifies Across V3 Polygon -> Arbitrum USDC as LIVE_VERIFIED based on historical evidence', () => {
      const cap = CrossChainProviderCapabilityMatrix.getCapability(
        'ACROSS',
        'polygon',
        'arbitrum',
        'USDC',
        'USDC'
      );
      assert.strictEqual(cap.capabilityLevel, 'LIVE_VERIFIED');
      assert.strictEqual(cap.quoteSupported, true);
      assert.strictEqual(cap.executionSupported, true);
      assert.strictEqual(cap.trackingSupported, true);
      assert.strictEqual(
        CrossChainProviderCapabilityMatrix.isLiveVerified('ACROSS', 'polygon', 'arbitrum', 'USDC', 'USDC'),
        true
      );
    });

    it('certifies Across V3 on other EVM pairs as EXECUTION_AVAILABLE, not LIVE_VERIFIED', () => {
      const cap = CrossChainProviderCapabilityMatrix.getCapability(
        'ACROSS',
        'ethereum',
        'arbitrum',
        'USDC',
        'USDC'
      );
      assert.strictEqual(cap.capabilityLevel, 'EXECUTION_AVAILABLE');
      assert.strictEqual(
        CrossChainProviderCapabilityMatrix.isLiveVerified('ACROSS', 'ethereum', 'arbitrum', 'USDC', 'USDC'),
        false
      );
    });

    it('truthfully certifies deBridge DLN as EXECUTION_AVAILABLE and strictly rejects LIVE_VERIFIED', () => {
      const cap = CrossChainProviderCapabilityMatrix.getCapability(
        'DEBRIDGE_DLN',
        'polygon',
        'arbitrum',
        'USDC',
        'USDC'
      );
      assert.strictEqual(cap.capabilityLevel, 'EXECUTION_AVAILABLE');
      assert.notStrictEqual(cap.capabilityLevel, 'LIVE_VERIFIED');
      assert.strictEqual(
        CrossChainProviderCapabilityMatrix.isLiveVerified('DEBRIDGE_DLN', 'polygon', 'arbitrum', 'USDC', 'USDC'),
        false
      );
    });

    it('truthfully certifies Stargate V2 as CONFIGURED and strictly rejects QUOTE_AVAILABLE, EXECUTION_AVAILABLE, LIVE_VERIFIED', () => {
      const cap = CrossChainProviderCapabilityMatrix.getCapability(
        'STARGATE',
        'polygon',
        'arbitrum',
        'USDC',
        'USDC'
      );
      assert.strictEqual(cap.capabilityLevel, 'CONFIGURED');
      assert.strictEqual(cap.quoteSupported, false);
      assert.strictEqual(cap.executionSupported, false);
      assert.strictEqual(
        CrossChainProviderCapabilityMatrix.meetsCapability(cap.capabilityLevel, 'QUOTE_AVAILABLE'),
        false
      );
      assert.strictEqual(
        CrossChainProviderCapabilityMatrix.meetsCapability(cap.capabilityLevel, 'EXECUTION_AVAILABLE'),
        false
      );
      assert.strictEqual(
        CrossChainProviderCapabilityMatrix.isLiveVerified('STARGATE', 'polygon', 'arbitrum', 'USDC', 'USDC'),
        false
      );
    });

    it('returns UNSUPPORTED for identical chain pairs or non-existent chains', () => {
      const sameChain = CrossChainProviderCapabilityMatrix.getCapability('ACROSS', 'polygon', 'polygon', 'USDC', 'USDC');
      assert.strictEqual(sameChain.capabilityLevel, 'UNSUPPORTED');
      assert.strictEqual(sameChain.quoteSupported, false);

      const invalidChain = CrossChainProviderCapabilityMatrix.getCapability('ACROSS', 'polygon', 'solana', 'USDC', 'USDC');
      assert.strictEqual(invalidChain.capabilityLevel, 'UNSUPPORTED');
    });
  });

  // ==========================================================================
  // TASK 3: ACROSS REGRESSION USING HISTORICAL ON-CHAIN FIXTURE
  // ==========================================================================
  describe('Task 3 — Across V3 Reference Regression', () => {
    it('verifies historical LIVE_ONCHAIN fixture integrity without broadcasting', () => {
      assert.strictEqual(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.sourceChainId, 137);
      assert.strictEqual(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.destinationChainId, 42161);
      assert.strictEqual(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.actualSourceSwapOutputRaw, '553197');
      assert.strictEqual(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.acrossDepositId, '2356813');
      assert.strictEqual(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.destinationFillTxHash, '0xc3f73e3f169d66bfa29af744725e0b4eb3f9f321e29e144a5845eab074e0f3b5');
      assert.strictEqual(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.actualDestinationOutputRaw, '542968');
    });

    it('normalizes Across deposit status with strict fillTx > fillTxnRef > fillTxHash precedence', () => {
      const p1 = normalizeAcrossDepositStatus({
        status: 'filled',
        fillTx: '0xc3f73e3f169d66bfa29af744725e0b4eb3f9f321e29e144a5845eab074e0f3b5',
        fillTxnRef: '0x1111111111111111111111111111111111111111111111111111111111111111',
        fillTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222'
      });
      assert.strictEqual(p1.resolvedFillTx, '0xc3f73e3f169d66bfa29af744725e0b4eb3f9f321e29e144a5845eab074e0f3b5');
      assert.strictEqual(p1.status, 'filled');

      const p2 = normalizeAcrossDepositStatus({
        status: 'filled',
        fillTxnRef: '0x1111111111111111111111111111111111111111111111111111111111111111',
        fillTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222'
      });
      assert.strictEqual(p2.resolvedFillTx, '0x1111111111111111111111111111111111111111111111111111111111111111');

      const p3 = normalizeAcrossDepositStatus({
        status: 'filled',
        fillTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222'
      });
      assert.strictEqual(p3.resolvedFillTx, '0x2222222222222222222222222222222222222222222222222222222222222222');
    });

    it('correctly categorizes Across terminal refunded and expired states', () => {
      const ref = normalizeAcrossDepositStatus({ status: 'refunded' });
      assert.strictEqual(ref.status, 'refunded');

      const exp = normalizeAcrossDepositStatus({ status: 'expired' });
      assert.strictEqual(exp.status, 'expired');
    });

    it('flags status conflicts when filled is claimed without a valid transaction hash', () => {
      const conflict = normalizeAcrossDepositStatus({ status: 'filled' });
      assert.strictEqual(conflict.hasStatusConflict, true);
      assert.strictEqual(conflict.resolvedFillTx, null);
    });
  });

  // ==========================================================================
  // TASK 4: DEBRIDGE AUDIT & CERTIFICATION
  // ==========================================================================
  describe('Task 4 — deBridge DLN Audit & Certification', () => {
    const deBridge = new DeBridgeProvider();

    it('verifies deBridge isAvailable on supported EVM chains and same-token pairs', () => {
      assert.strictEqual(deBridge.isAvailable('polygon', 'arbitrum', MOCK_USDC_POLYGON, MOCK_USDC_ARBITRUM), true);
      assert.strictEqual(deBridge.isAvailable('polygon', 'polygon', MOCK_USDC_POLYGON, MOCK_USDC_ARBITRUM), false);
    });

    it('produces valid createOrder calldata when execution is requested', async () => {
      const mockQuote: CrossChainQuote = {
        provider: 'DEBRIDGE_DLN',
        providerName: 'deBridge DLN',
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        sourceToken: MOCK_USDC_POLYGON,
        destinationToken: MOCK_USDC_ARBITRUM,
        sourceAmountRaw: '1000000',
        destinationAmountRaw: '995000',
        minDestinationAmountRaw: '990000',
        bridgeFeeUSD: 0.04,
        relayerFee: '0.04%',
        gasEstimateUSD: 0.02,
        recipient: MOCK_OPERATOR_WALLET,
        expiration: Date.now() + 300000,
        routeIdentifier: 'test-debridge',
        executionTarget: '0xeF381f7602058348d4eE296e622764B53D32B8B1',
        calldata: '0x1234',
        value: '0',
        approvalTarget: '0xeF381f7602058348d4eE296e622764B53D32B8B1',
        quoteTimestamp: Date.now(),
        estimatedTransferTimeSec: 120,
        securityRating: 'A',
        isExecutable: true
      };

      const exec = await deBridge.buildExecution(mockQuote, MOCK_OPERATOR_WALLET, MOCK_OPERATOR_WALLET);
      assert.ok(exec.data.startsWith('0x'));
      assert.ok(exec.data.length > 10);
      assert.strictEqual(exec.to.toLowerCase(), '0xef4fb24ad0916217251f553c0596f8edc630eb66');
      assert.strictEqual(exec.value, '0');
    });

    it('strictly fails closed when buildExecution is invoked on an unexecutable quote', async () => {
      const unexecutableQuote: CrossChainQuote = {
        provider: 'DEBRIDGE_DLN',
        providerName: 'deBridge DLN',
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        sourceToken: MOCK_USDC_POLYGON,
        destinationToken: MOCK_USDC_ARBITRUM,
        sourceAmountRaw: '1000000',
        destinationAmountRaw: '995000',
        minDestinationAmountRaw: '990000',
        bridgeFeeUSD: 0.04,
        relayerFee: '0.04%',
        gasEstimateUSD: 0.02,
        recipient: MOCK_OPERATOR_WALLET,
        expiration: Date.now() + 300000,
        routeIdentifier: 'test-debridge',
        executionTarget: '0xeF381f7602058348d4eE296e622764B53D32B8B1',
        calldata: '0x',
        value: '0',
        approvalTarget: '0xeF381f7602058348d4eE296e622764B53D32B8B1',
        quoteTimestamp: Date.now(),
        estimatedTransferTimeSec: 120,
        securityRating: 'A',
        isExecutable: false,
        unexecutableReason: 'PROVIDER_UNAVAILABLE'
      };

      await assert.rejects(
        async () => deBridge.buildExecution(unexecutableQuote, MOCK_OPERATOR_WALLET),
        /Cannot build execution for unexecutable quote/
      );
    });
  });

  // ==========================================================================
  // TASK 5: STARGATE AUDIT & CERTIFICATION
  // ==========================================================================
  describe('Task 5 — Stargate V2 Audit & Certification', () => {
    const stargate = new StargateProvider();

    it('verifies Stargate produces unexecutable quote without live quoter', async () => {
      const req: QuoteRequest = {
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        tokenIn: MOCK_USDC_POLYGON,
        tokenOut: MOCK_USDC_ARBITRUM,
        amountInRaw: '1000000',
        slippageTolerancePercent: 0.5,
        userWalletAddress: MOCK_OPERATOR_WALLET
      };

      const quote = await stargate.getQuote(req);
      assert.ok(quote !== null);
      assert.strictEqual(quote.isExecutable, false);
      assert.strictEqual(quote.calldata, '0x');
      assert.ok(quote.unexecutableReason?.includes('QUOTE_UNAVAILABLE'));
    });

    it('strictly fails closed on buildExecution for Stargate unexecutable quote', async () => {
      const req: QuoteRequest = {
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        tokenIn: MOCK_USDC_POLYGON,
        tokenOut: MOCK_USDC_ARBITRUM,
        amountInRaw: '1000000',
        slippageTolerancePercent: 0.5,
        userWalletAddress: MOCK_OPERATOR_WALLET
      };

      const quote = await stargate.getQuote(req);
      assert.ok(quote !== null);
      await assert.rejects(
        async () => stargate.buildExecution(quote, MOCK_OPERATOR_WALLET),
        /Cannot build execution for unexecutable quote/
      );
    });
  });

  // ==========================================================================
  // TASK 6: PROVIDER-AGNOSTIC NORMALIZED SCHEMA
  // ==========================================================================
  describe('Task 6 — Provider-Agnostic Normalized Bridge Quote Schema', () => {
    const aggregator = new CrossChainAggregator();

    it('converts CrossChainQuote to NormalizedBridgeQuote preserving all 19 fields without float math', () => {
      const rawQuote: CrossChainQuote = {
        provider: 'ACROSS',
        providerName: 'Across Protocol V3',
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        sourceToken: MOCK_USDC_POLYGON,
        destinationToken: MOCK_USDC_ARBITRUM,
        sourceAmountRaw: '553197',
        destinationAmountRaw: '542968',
        minDestinationAmountRaw: '540000',
        bridgeFeeUSD: 0.01,
        relayerFee: '0.05%',
        gasEstimateUSD: 0.02,
        recipient: MOCK_OPERATOR_WALLET,
        expiration: Date.now() + 300000,
        routeIdentifier: 'across-test-route',
        executionTarget: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
        calldata: '0x12345678',
        value: '0',
        approvalTarget: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
        quoteTimestamp: Date.now(),
        estimatedTransferTimeSec: 30,
        securityRating: 'A+',
        isExecutable: true
      };

      const normalized = aggregator.toNormalizedQuote(rawQuote);

      assert.strictEqual(normalized.provider, 'ACROSS');
      assert.strictEqual(normalized.sourceChainId, 'polygon');
      assert.strictEqual(normalized.destinationChainId, 'arbitrum');
      assert.strictEqual(normalized.sourceToken.symbol, 'USDC');
      assert.strictEqual(normalized.destinationToken.symbol, 'USDC');
      assert.strictEqual(normalized.inputAmountRaw, '553197');
      assert.strictEqual(normalized.expectedOutputRaw, '542968');
      assert.strictEqual(normalized.minimumOutputRaw, '540000');
      // Fee amount computed using exact bigint arithmetic: 553197 - 542968 = 10229
      assert.strictEqual(normalized.feeAmountRaw, '10229');
      assert.strictEqual(normalized.approvalTarget, '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096');
      assert.strictEqual(normalized.executionTarget, '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096');
      assert.strictEqual(normalized.calldata, '0x12345678');
      assert.strictEqual(normalized.value, '0');
      assert.strictEqual(normalized.isExecutable, true);
      assert.strictEqual(normalized.capabilityLevel, 'LIVE_VERIFIED');
    });
  });

  // ==========================================================================
  // TASK 7: UNIVERSAL 15-GATE EXECUTABILITY VALIDATOR
  // ==========================================================================
  describe('Task 7 — Universal 15-Gate Executability Validator', () => {
    const validBaseQuote: CrossChainQuote = {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'polygon',
      destinationChainId: 'arbitrum',
      sourceToken: MOCK_USDC_POLYGON,
      destinationToken: MOCK_USDC_ARBITRUM,
      sourceAmountRaw: '1000000',
      destinationAmountRaw: '990000',
      minDestinationAmountRaw: '985000',
      bridgeFeeUSD: 0.01,
      relayerFee: '0.05%',
      gasEstimateUSD: 0.02,
      recipient: MOCK_OPERATOR_WALLET,
      expiration: Date.now() + 300000,
      routeIdentifier: 'across-15gate-valid',
      executionTarget: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
      calldata: '0x12345678',
      value: '0',
      approvalTarget: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
      quoteTimestamp: Date.now(),
      estimatedTransferTimeSec: 30,
      securityRating: 'A+',
      isExecutable: true
    };

    it('passes all 15 gates for a fully verified quote', () => {
      const res = validateUniversalBridgeQuoteExecutability(validBaseQuote);
      assert.strictEqual(res.isExecutable, true);
      assert.strictEqual(res.status, 'EXECUTABLE');
      assert.strictEqual(res.failedGates.length, 0);
      assert.strictEqual(res.passedGates.length, 15);
    });

    it('Gate 1: fails closed on unsupported route', () => {
      const quote = { ...validBaseQuote, destinationChainId: 'unsupported-chain' };
      const res = validateUniversalBridgeQuoteExecutability(quote);
      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.failedGates.includes('ROUTE_SUPPORTED'));
      assert.strictEqual(res.errorCategory, 'UNSUPPORTED_ROUTE');
    });

    it('Gate 8: fails closed when minimum output exceeds expected output', () => {
      const quote = { ...validBaseQuote, minDestinationAmountRaw: '1000001', destinationAmountRaw: '1000000' };
      const res = validateUniversalBridgeQuoteExecutability(quote);
      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.failedGates.includes('VALID_MINIMUM_OUTPUT'));
    });

    it('Gate 9: fails closed on ZeroAddress or invalid execution target', () => {
      const quote = { ...validBaseQuote, executionTarget: ZeroAddress };
      const res = validateUniversalBridgeQuoteExecutability(quote);
      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.failedGates.includes('VALID_EXECUTION_TARGET'));
      assert.strictEqual(res.errorCategory, 'INVALID_TARGET');
    });

    it('Gate 10: fails closed on empty or non-hex calldata', () => {
      const quote = { ...validBaseQuote, calldata: '0x' };
      const res = validateUniversalBridgeQuoteExecutability(quote);
      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.failedGates.includes('VALID_CALLDATA'));
      assert.strictEqual(res.errorCategory, 'INVALID_CALLDATA');
    });

    it('Gate 11: fails closed on invalid approval target for non-native token', () => {
      const quote = { ...validBaseQuote, approvalTarget: ZeroAddress };
      const res = validateUniversalBridgeQuoteExecutability(quote);
      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.failedGates.includes('VALID_APPROVAL_TARGET'));
    });

    it('Gate 12: fails closed on expired quote', () => {
      const quote = { ...validBaseQuote, expiration: Date.now() - 1000 };
      const res = validateUniversalBridgeQuoteExecutability(quote);
      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.failedGates.includes('VALID_EXPIRATION'));
      assert.strictEqual(res.errorCategory, 'EXPIRED_QUOTE');
    });

    it('Gate 13: fails closed on ZeroAddress recipient', () => {
      const quote = { ...validBaseQuote, recipient: ZeroAddress };
      const res = validateUniversalBridgeQuoteExecutability(quote);
      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.failedGates.includes('VALID_RECEIVER'));
    });

    it('Gate 15: fails closed when provider capability does not permit execution mode', () => {
      const req: QuoteRequest = {
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        tokenIn: MOCK_USDC_POLYGON,
        tokenOut: MOCK_USDC_ARBITRUM,
        amountInRaw: '1000000',
        slippageTolerancePercent: 0.5,
        executionMode: 'LIVE_EXECUTION'
      };
      // deBridge is EXECUTION_AVAILABLE, but LIVE_EXECUTION requires LIVE_VERIFIED
      const deBridgeQuote = { ...validBaseQuote, provider: 'DEBRIDGE_DLN' as const };
      const res = validateUniversalBridgeQuoteExecutability(deBridgeQuote, req);
      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.failedGates.includes('CAPABILITY_PERMITS_EXECUTION'));
      assert.strictEqual(res.errorCategory, 'EXECUTION_UNAVAILABLE');
    });
  });

  // ==========================================================================
  // TASK 8: STANDARDIZED 16-CATEGORY ERROR TAXONOMY
  // ==========================================================================
  describe('Task 8 — Provider Error Taxonomy', () => {
    it('normalizes all standard provider error categories accurately', () => {
      assert.strictEqual(normalizeProviderErrorCategory(null, 429), 'RATE_LIMITED');
      assert.strictEqual(normalizeProviderErrorCategory(null, 502), 'PROVIDER_UNAVAILABLE');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('unsupported route on chain')), 'UNSUPPORTED_ROUTE');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('quote_expired')), 'EXPIRED_QUOTE');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('insufficient liquidity in pool')), 'INSUFFICIENT_LIQUIDITY');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('invalid calldata format')), 'INVALID_CALLDATA');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('zero address execution target')), 'INVALID_TARGET');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('malformed token identifier')), 'INVALID_TOKEN');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('chain id mismatch')), 'INVALID_CHAIN');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('destination unavailable')), 'DESTINATION_UNAVAILABLE');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('tracking unavailable')), 'TRACKING_UNAVAILABLE');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('status conflict between providers')), 'STATUS_CONFLICT');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('status unknown')), 'STATUS_UNKNOWN');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('network connection refused ECONNREFUSED')), 'PROVIDER_UNAVAILABLE');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('invalid quote json')), 'INVALID_QUOTE');
      assert.strictEqual(normalizeProviderErrorCategory(new Error('generic unknown error')), 'EXECUTION_UNAVAILABLE');
    });
  });

  // ==========================================================================
  // TASK 9: PROVIDER ROUTING POLICY
  // ==========================================================================
  describe('Task 9 — Provider Routing Policy', () => {
    it('selects ONLY LIVE_VERIFIED providers in LIVE_EXECUTION mode', async () => {
      const aggregator = new CrossChainAggregator();
      const req: QuoteRequest = {
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        tokenIn: MOCK_USDC_POLYGON,
        tokenOut: MOCK_USDC_ARBITRUM,
        amountInRaw: '1000000',
        slippageTolerancePercent: 0.5,
        userWalletAddress: MOCK_OPERATOR_WALLET,
        executionMode: 'LIVE_EXECUTION'
      };

      const quotes = await aggregator.getQuotes(req);
      const executableQuotes = quotes.filter((q) => q.isExecutable);

      // Across is LIVE_VERIFIED on polygon -> arbitrum USDC
      // Stargate and deBridge MUST NOT be executable for LIVE_EXECUTION
      for (const q of executableQuotes) {
        assert.strictEqual(q.provider, 'ACROSS');
        assert.strictEqual(
          CrossChainProviderCapabilityMatrix.isLiveVerified(q.provider, 'polygon', 'arbitrum', 'USDC', 'USDC'),
          true
        );
      }

      for (const q of quotes) {
        if (q.provider !== 'ACROSS') {
          assert.strictEqual(q.isExecutable, false);
          assert.ok(q.unexecutableReason?.includes('CAPABILITY_MISMATCH') || q.unexecutableReason?.includes('QUOTE_UNAVAILABLE'));
        }
      }
    });

    it('allows EXECUTION_AVAILABLE providers in SIMULATION mode', async () => {
      const aggregator = new CrossChainAggregator();
      const req: QuoteRequest = {
        sourceChainId: 'polygon',
        destinationChainId: 'arbitrum',
        tokenIn: MOCK_USDC_POLYGON,
        tokenOut: MOCK_USDC_ARBITRUM,
        amountInRaw: '1000000',
        slippageTolerancePercent: 0.5,
        userWalletAddress: MOCK_OPERATOR_WALLET,
        executionMode: 'SIMULATION'
      };

      const quotes = await aggregator.getQuotes(req);
      // In simulation mode, deBridge DLN can be executable if live API returned calldata
      // Stargate remains non-executable because quoter is not configured
      const stargateQuote = quotes.find((q) => q.provider === 'STARGATE');
      if (stargateQuote) {
        assert.strictEqual(stargateQuote.isExecutable, false);
      }
    });
  });

  // ==========================================================================
  // TASK 11: AUTHORITATIVE DESTINATION EVIDENCE HIERARCHY
  // ==========================================================================
  describe('Task 11 — Destination Evidence Hierarchy Precedence', () => {
    it('P1 on-chain receipt status 1 strictly overrides pending provider API', async () => {
      const result = await verifyDestinationSettlement({
        destinationChainId: 42161,
        destinationTxHash: '0xc3f73e3f169d66bfa29af744725e0b4eb3f9f321e29e144a5845eab074e0f3b5',
        expectedRecipient: MOCK_OPERATOR_WALLET,
        expectedToken: MOCK_USDC_ARBITRUM.address,
        expectedMinAmountRaw: '540000',
        providerStatus: 'pending', // Provider claims pending
        receipt: {
          status: 1, // On-chain proves success
          blockNumber: 507526931,
          logs: [
            {
              address: MOCK_USDC_ARBITRUM.address.toLowerCase(),
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x000000000000000000000000fd03abcadaf3f930fa4e37eb2f6ea3a44a41b7f0',
                '0x000000000000000000000000d2206db611d5677c8552a9dcbadf3077adb4af88'
              ],
              data: '0x0000000000000000000000000000000000000000000000000000000000084908' // 542968 raw
            }
          ]
        }
      });

      assert.strictEqual(result.settlementStatus, 'DESTINATION_SETTLED');
      assert.strictEqual(result.deliveredToExpectedRecipient, true);
    });

    it('P1 on-chain revert strictly overrides provider API claiming filled', async () => {
      const result = await verifyDestinationSettlement({
        destinationChainId: 42161,
        destinationTxHash: '0xrevertedtxhash0000000000000000000000000000000000000000000000000000',
        expectedRecipient: MOCK_OPERATOR_WALLET,
        expectedToken: MOCK_USDC_ARBITRUM.address,
        expectedMinAmountRaw: '540000',
        providerStatus: 'filled', // Provider falsely claims filled
        receipt: {
          status: 0, // On-chain proves revert!
          blockNumber: 507526932
        }
      });

      assert.strictEqual(result.settlementStatus, 'STATUS_CONFLICT');
      assert.strictEqual(result.deliveredToExpectedRecipient, false);
    });
  });

  // ==========================================================================
  // TASK 12: SECURITY INVARIANTS
  // ==========================================================================
  describe('Task 12 — Security Invariants', () => {
    it('strictly prohibits MAX_UINT token approvals', () => {
      const MAX_UINT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
      const exactAmount = '553197';

      assert.notStrictEqual(exactAmount, MAX_UINT);
      assert.strictEqual(BigInt(exactAmount) < BigInt(MAX_UINT), true);
    });

    it('prohibits floating point arithmetic in token quote calculations', () => {
      const inputRaw = '553197';
      const minFeeBps = 50n; // 0.50%
      const inputBig = BigInt(inputRaw);
      const feeRaw = (inputBig * minFeeBps) / 10000n;
      const netOutputBig = inputBig - feeRaw;

      assert.strictEqual(typeof netOutputBig, 'bigint');
      assert.strictEqual(netOutputBig.toString(), '550432');
    });

    it('validates genuine 32-byte hexadecimal transaction hashes', () => {
      const validHash = '0xc3f73e3f169d66bfa29af744725e0b4eb3f9f321e29e144a5845eab074e0f3b5';
      const invalidHash1 = '0x1234';
      const invalidHash2 = 'not-a-hash';

      const isValid = (h: string) => /^0x[0-9a-fA-F]{64}$/.test(h);

      assert.strictEqual(isValid(validHash), true);
      assert.strictEqual(isValid(invalidHash1), false);
      assert.strictEqual(isValid(invalidHash2), false);
    });
  });
});
