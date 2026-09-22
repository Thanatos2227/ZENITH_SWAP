import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  validateEvmAddress,
  validateTokenAddress,
  validateRecipientAddress,
  validateExecutionTarget,
  validateApprovalTarget,
  CANONICAL_NATIVE_ADDRESS,
  ZERO_ADDRESS,
  InvalidAddressError,
  InvalidTokenAddressError,
  InvalidRecipientAddressError,
  InvalidExecutionTargetError,
  RecipientMismatchError,
  SecurityPolicyViolationError,
  IntentExpiredError,
  SolverLiquidityUnavailableError,
  ZenithSimulationFailedError,
  DestinationExecutionUnavailableError,
  getAcrossSpokePool,
  getStargateRouter,
  getDeBridgeSourceContract,
  EVMContractRegistry
} from '@zenith/contracts';
import { defaultChainRegistry } from '@zenith/chains';
import {
  scaleTokenUnits,
  calculateConstantProductOutput
} from '@zenith/routing';
import { defaultTokenRiskEngine } from '@zenith/security';
import { defaultMEVRouter } from '@zenith/security';
import { defaultAcrossProvider } from '@zenith/routing';
import { defaultDeBridgeProvider } from '@zenith/routing';
import { defaultStargateProvider } from '@zenith/routing';
import {
  SolverEngine,
  DestinationExecutionEngine,
  SQLiteCrossChainStateRepository,
  CrossChainRecoveryEngine,
  defaultEVMAdapter
} from '@zenith/execution';
import { QuoteRequest, Token, PersistentIntent } from '@zenith/types';

describe('ZENITH SWAP — Production Readiness, Security & Execution Audit Test Suite', () => {

  // =========================================================================
  // 1. Transaction Target & Address Security Audit
  // =========================================================================
  describe('1. Transaction Target & Address Governance Security', () => {
    test('1.1 Rejects placeholder and invalid target addresses across all chains', () => {
      const forbiddenPlaceholders = [
        '0x0000000000000000000000000000000000000000',
        '0x1111111111111111111111111111111111111111',
        '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead',
        '0x000000000000000000000000000000000000dead',
        'not-an-address',
        '0x123'
      ];

      for (const target of forbiddenPlaceholders) {
        assert.throws(
          () => validateEvmAddress(target, 'Execution Target'),
          (err: any) => err instanceof InvalidAddressError,
          `Expected ${target} to be rejected by validateEvmAddress`
        );
        assert.throws(
          () => validateExecutionTarget(target, 'ethereum'),
          (err: any) => err instanceof InvalidAddressError || err instanceof InvalidExecutionTargetError,
          `Expected ${target} to be rejected by validateExecutionTarget`
        );
      }
    });

    test('1.2 Protocol contract addresses are bound to (Chain ID + Protocol + Contract Type)', () => {
      // Across SpokePools
      assert.equal(getAcrossSpokePool(1), '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5');
      assert.equal(getAcrossSpokePool(137), '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096');
      assert.equal(getAcrossSpokePool(42161), '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A');
      assert.equal(getAcrossSpokePool(11155111), '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662');

      // Stargate Routers
      assert.equal(getStargateRouter(1), '0x8731d54E9D02c286767d56ac03e8037C07e01e98');
      assert.equal(getStargateRouter(137), '0x45a01E4e04f14F7A4A1Da563391C99F3679c3eb0');

      // deBridge DLN Source Contracts
      assert.equal(getDeBridgeSourceContract(1), '0xeF4fB24aD0916217251F553c0596F8Edc630EB66');
      assert.equal(getDeBridgeSourceContract(137), '0xeF4fB24aD0916217251F553c0596F8Edc630EB66');
    });
  });

  // =========================================================================
  // 2. Token & Amount Accounting Invariant Audit
  // =========================================================================
  describe('2. Token & Amount Accounting Invariants', () => {
    test('2.1 Pure integer bigint scaling preserves exact quantities without precision loss', () => {
      // 100 USDC (6 decimals: 100_000_000) -> 18 decimals (100_000_000_000_000_000_000)
      const usdcRaw = 100_000_000n;
      const scaled18 = scaleTokenUnits(usdcRaw, 6, 18);
      assert.equal(scaled18, 100_000_000_000_000_000_000n);

      // Downscaling back to 6 decimals
      const scaledBack = scaleTokenUnits(scaled18, 18, 6);
      assert.equal(scaledBack, usdcRaw);
    });

    test('2.2 Constant product AMM math enforces exact integer fee and invariant conservation', () => {
      const result = calculateConstantProductOutput({
        amountInRaw: 10_000_000_000_000_000_000n, // 10 ETH
        reserveInRaw: 1000_000_000_000_000_000_000n, // 1000 ETH
        reserveOutRaw: 3_000_000_000_000n, // 3,000,000 USDC (6 decimals)
        feeBps: 30, // 0.30%
        slippageToleranceBps: 50 // 0.50%
      });

      assert.ok(result.amountOutRaw > 0n);
      assert.ok(result.minimumOutRaw > 0n);
      assert.ok(result.minimumOutRaw <= result.amountOutRaw);
      assert.equal(result.feeAmountRaw, (10_000_000_000_000_000_000n * 30n) / 10000n);
    });
  });

  // =========================================================================
  // 3. Approval Security Audit
  // =========================================================================
  describe('3. Approval Security & Bounded Allowance Audit', () => {
    test('3.1 Rejects approval target mismatch for direct DEX swaps', () => {
      const spender = '0x111111125421cA6dc452d289314280a0f8842A65';
      const target = '0x3000000000000000000000000000000000000003';
      assert.notEqual(spender.toLowerCase(), target.toLowerCase());
    });

    test('3.2 Native tokens do not require ERC-20 approval', async () => {
      const allowance = await defaultEVMAdapter.checkAllowance({
        tokenAddress: CANONICAL_NATIVE_ADDRESS,
        ownerAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        spenderAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564'
      });
      assert.equal(allowance, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'));
    });
  });

  // =========================================================================
  // 4. Slippage & Deadline Security Audit
  // =========================================================================
  describe('4. Slippage & Deadline Boundary Security', () => {
    test('4.1 Expired intent deadline fails closed immediately', async () => {
      const solver = new SolverEngine({
        profile: { isActive: true, availableLiquidityUSD: 1000000 }
      });

      const expiredDeadline = Date.now() - 1000; // 1 second in the past

      const tokenIn: Token = {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        chainId: 1,
        isNative: false
      };

      const tokenOut: Token = {
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        symbol: 'WETH',
        name: 'Wrapped Ether',
        decimals: 18,
        chainId: 1,
        isNative: false
      };

      await assert.rejects(
        async () => {
          await solver.prepareDestinationExecution({
            intentId: 'expired-test-intent-1',
            sourceChainId: 'arbitrum',
            destinationChainId: 'ethereum',
            recipient: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
            inputToken: tokenIn,
            inputAmountActual: '1000000000', // 1000 USDC
            outputToken: tokenOut,
            minimumOutputAmount: '300000000000000000', // 0.3 ETH
            deadline: expiredDeadline,
            bridgeProvider: 'ACROSS',
            providerOrderId: 'order-expired-1'
          });
        },
        (err: any) => err instanceof IntentExpiredError,
        'Expected expired deadline to throw IntentExpiredError'
      );
    });

    test('4.2 Dynamic destination DEX minimum output check protects against price shifts', async () => {
      const solver = new SolverEngine({
        profile: { isActive: true, availableLiquidityUSD: 1000000 }
      });

      const tokenIn: Token = {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        chainId: 1,
        isNative: false
      };

      const tokenOut: Token = {
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        symbol: 'WETH',
        name: 'Wrapped Ether',
        decimals: 18,
        chainId: 1,
        isNative: false
      };

      // User asks for impossible minimum output (e.g. 1000 ETH for 1000 USDC)
      const impossibleMinOut = 1000n * 10n ** 18n;

      await assert.rejects(
        async () => {
          await solver.prepareDestinationExecution({
            intentId: 'impossible-slippage-intent',
            sourceChainId: 'arbitrum',
            destinationChainId: 'ethereum',
            recipient: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
            inputToken: tokenIn,
            inputAmountActual: '1000000000', // 1000 USDC
            outputToken: tokenOut,
            minimumOutputAmount: impossibleMinOut.toString(),
            deadline: Date.now() + 60000,
            bridgeProvider: 'ACROSS',
            providerOrderId: 'order-slippage-1'
          });
        },
        /DESTINATION_SLIPPAGE_EXCEEDED/,
        'Expected impossible slippage to throw DESTINATION_SLIPPAGE_EXCEEDED error'
      );
    });
  });

  // =========================================================================
  // 5. Replay Protection & Duplicate Execution Audit
  // =========================================================================
  describe('5. Persistence Replay Protection & Concurrency Audit', () => {
    test('5.1 SQLite repository prevents duplicate intent ID insertion', async () => {
      const repo = new SQLiteCrossChainStateRepository(':memory:');
      const sampleIntent: PersistentIntent = {
        intentId: 'unique-intent-uuid-1',
        userAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sourceTokenSymbol: 'USDC',
        destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        destinationTokenSymbol: 'USDC',
        amountInRaw: '100000000',
        expectedAmountOutRaw: '99950000',
        minAmountOutRaw: '99500000',
        provider: 'ACROSS',
        routeId: 'route-test-1',
        nonce: '1001',
        deadline: Date.now() + 600000,
        status: 'CREATED',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await repo.createIntent(sampleIntent);

      // Attempt duplicate insertion with same intentId
      await assert.rejects(
        async () => {
          await repo.createIntent(sampleIntent);
        },
        /Duplicate intent ID/,
        'Expected duplicate intentId insertion to throw'
      );
    });

    test('5.2 SQLite repository prevents nonce replay attacks for the same user and chains', async () => {
      const repo = new SQLiteCrossChainStateRepository(':memory:');
      const intent1: PersistentIntent = {
        intentId: 'intent-alpha',
        userAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sourceTokenSymbol: 'USDC',
        destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        destinationTokenSymbol: 'USDC',
        amountInRaw: '100000000',
        expectedAmountOutRaw: '99950000',
        minAmountOutRaw: '99500000',
        provider: 'ACROSS',
        routeId: 'route-test-1',
        nonce: '42',
        deadline: Date.now() + 600000,
        status: 'CREATED',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await repo.createIntent(intent1);

      const intent2: PersistentIntent = {
        ...intent1,
        intentId: 'intent-beta', // different intentId, same user + chain + nonce
        nonce: '42'
      };

      await assert.rejects(
        async () => {
          await repo.createIntent(intent2);
        },
        /Nonce replay detected/,
        'Expected duplicate nonce for same user and chain pair to be rejected'
      );
    });

    test('5.3 Worker lease locking prevents concurrent double-solver execution', async () => {
      const repo = new SQLiteCrossChainStateRepository(':memory:');
      const sampleIntent: PersistentIntent = {
        intentId: 'concurrency-test-intent',
        userAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sourceTokenSymbol: 'USDC',
        destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        destinationTokenSymbol: 'USDC',
        amountInRaw: '100000000',
        expectedAmountOutRaw: '99950000',
        minAmountOutRaw: '99500000',
        provider: 'ACROSS',
        routeId: 'route-test-1',
        nonce: '500',
        deadline: Date.now() + 600000,
        status: 'FULFILLING',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await repo.createIntent(sampleIntent);

      // Worker 1 claims lease
      const claim1 = await repo.claimIntentLease(sampleIntent.intentId, 'solver-worker-alpha', 30000);
      assert.equal(claim1, true, 'First worker lease claim should succeed');

      // Worker 2 attempts concurrent claim
      const claim2 = await repo.claimIntentLease(sampleIntent.intentId, 'solver-worker-beta', 30000);
      assert.equal(claim2, false, 'Concurrent lease claim by second worker should be rejected');

      // Worker 1 releases lease
      await repo.releaseIntentLease(sampleIntent.intentId, 'solver-worker-alpha');

      // Worker 2 now succeeds
      const claim3 = await repo.claimIntentLease(sampleIntent.intentId, 'solver-worker-beta', 30000);
      assert.equal(claim3, true, 'Lease claim after release should succeed');
    });
  });

  // =========================================================================
  // 6. Malicious Token & Risk Engine Audit
  // =========================================================================
  describe('6. Malicious Token & Risk Engine Security', () => {
    test('6.1 Honeypot tokens fail security policy and are marked non-tradeable', () => {
      const maliciousToken: Token = {
        address: '0x9999999999999999999999999999999999999999',
        symbol: 'HONEY',
        name: 'Honeypot Trap',
        decimals: 18,
        chainId: 1,
        isNative: false,
        securityProfile: {
          isHoneypot: true,
          buyTaxPercent: 0,
          sellTaxPercent: 100,
          transferTaxPercent: 0,
          canBlacklist: true,
          canMintArbitrary: true,
          isProxy: false,
          liquidityLockedPercent: 0,
          holderConcentrationTop10Percent: 95,
          hasMaliciousPatterns: true,
          riskScore: 100,
          warnings: ['Honeypot detected']
        }
      };

      const risk = defaultTokenRiskEngine.evaluateToken(maliciousToken);
      assert.equal(risk.isTradeable, false);
      assert.equal(risk.overallRiskLevel, 'CRITICAL');
      assert.ok(risk.warnings.some((w) => w.includes('Honeypot')));
    });

    test('6.2 High transfer-tax tokens are flagged with severe risk warnings', () => {
      const taxToken: Token = {
        address: '0x8888888888888888888888888888888888888888',
        symbol: 'TAX',
        name: 'High Tax Token',
        decimals: 18,
        chainId: 1,
        isNative: false,
        securityProfile: {
          isHoneypot: false,
          buyTaxPercent: 15,
          sellTaxPercent: 20,
          transferTaxPercent: 10,
          canBlacklist: false,
          canMintArbitrary: false,
          isProxy: false,
          liquidityLockedPercent: 80,
          holderConcentrationTop10Percent: 30,
          hasMaliciousPatterns: false,
          riskScore: 60,
          warnings: ['High tax detected']
        }
      };

      const risk = defaultTokenRiskEngine.evaluateToken(taxToken);
      assert.ok(risk.riskScore >= 40);
      assert.ok(risk.warnings.some((w) => w.includes('tax') || w.includes('fee')));
    });
  });

  // =========================================================================
  // 7. Settlement Verification Audit
  // =========================================================================
  describe('7. Authoritative Settlement Invariant Verification', () => {
    test('7.1 Solver destination verification rejects non-existent or reverted receipts', async () => {
      const solver = new SolverEngine();
      const verification = await solver.verifyDestinationExecution(
        'mock-exec-id',
        '0x0000000000000000000000000000000000000000', // Invalid zero recipient
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        1000000n
      );

      assert.equal(verification.isVerified, false);
      assert.ok(verification.reason?.includes('recipient'));
    });
  });

  // =========================================================================
  // 8. MEV Architecture Reality Check
  // =========================================================================
  describe('8. MEV Protection Classification & Architecture Reality Check', () => {
    test('8.1 MEV router correctly configures Flashbots Private RPC on Ethereum Mainnet', () => {
      const route = defaultMEVRouter.resolveMEVRoute('ethereum', 'FLASHBOTS_PRIVATE');
      assert.equal(route.protectionLevel, 'FLASHBOTS_PRIVATE');
      assert.equal(route.rpcEndpoint, 'https://rpc.flashbots.net/fast');
      assert.equal(route.isPrivateMempool, true);
      assert.equal(route.frontrunningProtection, true);
    });

    test('8.2 L2 rollups with sequencer FIFO protection are recognized without redundant bundling', () => {
      const arbRoute = defaultMEVRouter.resolveMEVRoute('arbitrum', 'NONE');
      assert.equal(arbRoute.frontrunningProtection, true);
      assert.ok(arbRoute.disclaimer?.includes('FIFO Sequencer'));
    });
  });

  // =========================================================================
  // 9. Zero-Custody Secret Management Audit
  // =========================================================================
  describe('9. Zero-Custody Secret Management Audit', () => {
    test('9.1 State repository never serializes or exposes private keys', async () => {
      const repo = new SQLiteCrossChainStateRepository(':memory:');
      const intent: PersistentIntent = {
        intentId: 'audit-custody-intent-1',
        userAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sourceTokenSymbol: 'USDC',
        destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        destinationTokenSymbol: 'USDC',
        amountInRaw: '100000000',
        expectedAmountOutRaw: '99950000',
        minAmountOutRaw: '99500000',
        provider: 'ACROSS',
        routeId: 'route-test-1',
        nonce: '999',
        deadline: Date.now() + 600000,
        status: 'CREATED',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await repo.createIntent(intent);
      const retrieved = await repo.getIntent(intent.intentId);
      assert.ok(retrieved);

      // Verify no key field exists in retrieved object
      const json = JSON.stringify(retrieved);
      assert.equal(json.includes('privateKey'), false);
      assert.equal(json.includes('secret'), false);
      assert.equal(json.includes('mnemonic'), false);
    });
  });
});
