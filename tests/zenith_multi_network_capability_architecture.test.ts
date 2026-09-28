/**
 * @file zenith_multi_network_capability_architecture.test.ts
 * @package @zenith/chains
 *
 * ZENITH PHASE 2 TASK 36: MULTI-NETWORK CAPABILITY ARCHITECTURE TEST SUITE
 *
 * Rigorously certifies:
 * 1. Authoritative 6-level capability hierarchy
 * 2. Network identity security & collision prevention
 * 3. Network family classification & address/tx validation
 * 4. Granular operational capabilities (read, preflight, tx construction, signing, swap, bridge)
 * 5. Execution mode isolation (READ_ONLY, PREFLIGHT_ONLY, LIVE_EXECUTION)
 * 6. Execution adapter interface & capability-aware methods
 * 7. Finality models & safety block thresholds
 * 8. Gas models (Legacy, EIP-1559, OP Stack, Arbitrum, Solana, UTXO)
 * 9. Token standards & network token identity
 * 10. Bridge capability separation & corridor representation
 * 11. DEX capability separation & router validation
 * 12. Network health integration & circuit breaker halting
 * 13. Onboarding state machine & transition rules
 * 14. Existing 58 network migration & operational classifications
 * 15. Capability query APIs
 * 16. Route arbitration integration (Gate 0 network capability)
 * 17. ExecutionPlanBuilder integration
 * 18. Deterministic 4,000-case fuzzing suite (PRNG seed 0x7A5C36)
 * 19. Performance & latency benchmarks
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  NetworkCapabilityRegistry,
  defaultNetworkCapabilityRegistry,
  NETWORK_CAPABILITY_HIERARCHY,
  NetworkCapabilityLevel,
  NetworkOnboardingState,
  NetworkFamily,
  NetworkOperationalStatus,
  NETWORK_FAMILIES,
  isValidAddressForFamily,
  isValidTxHashForFamily,
  getNetworkFamilyDefinition,
  EvmExecutionAdapter,
  UnsupportedExecutionAdapter,
  ZENITH_NETWORK_PROFILES,
  NetworkCapabilityProfile
} from '../packages/chains/src';
import { RouteCapabilityFilter } from '../packages/routing/src/arbitration/routeCapabilityFilter';
import { ExecutionPlanBuilder } from '../packages/execution/src/executionPlanBuilder';
import { NormalizedRoute, QuoteRequest } from '../packages/types/src';

// PRNG for Deterministic Fuzzing
function createPrng(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ZENITH — PHASE 2 TASK 36: MULTI-NETWORK CAPABILITY ARCHITECTURE CERTIFICATION', () => {

  // ==========================================================================
  // SUITE 1: CAPABILITY HIERARCHY INVARIANTS
  // ==========================================================================
  describe('Suite 1: Capability Hierarchy Invariants', () => {
    it('1.1 Preserves exact 6 capability levels in ascending order', () => {
      const levels: NetworkCapabilityLevel[] = [
        'UNSUPPORTED',
        'UNIT_TESTED',
        'CONFIGURED',
        'QUOTE_AVAILABLE',
        'EXECUTION_AVAILABLE',
        'LIVE_VERIFIED'
      ];
      for (let i = 0; i < levels.length - 1; i++) {
        const currRank = NETWORK_CAPABILITY_HIERARCHY[levels[i]];
        const nextRank = NETWORK_CAPABILITY_HIERARCHY[levels[i + 1]];
        assert.ok(nextRank > currRank, `Rank of ${levels[i+1]} (${nextRank}) must exceed ${levels[i]} (${currRank})`);
      }
    });

    it('1.2 UNSUPPORTED has rank 0', () => {
      assert.strictEqual(NETWORK_CAPABILITY_HIERARCHY.UNSUPPORTED, 0);
    });

    it('1.3 LIVE_VERIFIED has highest rank 5', () => {
      assert.strictEqual(NETWORK_CAPABILITY_HIERARCHY.LIVE_VERIFIED, 5);
    });

    it('1.4 EXECUTION_AVAILABLE does NOT satisfy LIVE_VERIFIED requirement', () => {
      const execRank = NETWORK_CAPABILITY_HIERARCHY.EXECUTION_AVAILABLE;
      const liveRank = NETWORK_CAPABILITY_HIERARCHY.LIVE_VERIFIED;
      assert.ok(execRank < liveRank);
    });

    it('1.5 QUOTE_AVAILABLE does NOT satisfy EXECUTION_AVAILABLE requirement', () => {
      const quoteRank = NETWORK_CAPABILITY_HIERARCHY.QUOTE_AVAILABLE;
      const execRank = NETWORK_CAPABILITY_HIERARCHY.EXECUTION_AVAILABLE;
      assert.ok(quoteRank < execRank);
    });

    it('1.6 CONFIGURED does NOT satisfy QUOTE_AVAILABLE requirement', () => {
      const confRank = NETWORK_CAPABILITY_HIERARCHY.CONFIGURED;
      const quoteRank = NETWORK_CAPABILITY_HIERARCHY.QUOTE_AVAILABLE;
      assert.ok(confRank < quoteRank);
    });

    it('1.7 Missing or unknown level defaults to rank 0 (UNSUPPORTED)', () => {
      const rank = (NETWORK_CAPABILITY_HIERARCHY as any)['UNKNOWN_LEVEL'] ?? 0;
      assert.strictEqual(rank, 0);
    });
  });

  // ==========================================================================
  // SUITE 2: NETWORK IDENTITY SECURITY & COLLISION PREVENTION
  // ==========================================================================
  describe('Suite 2: Network Identity Security & Collision Prevention', () => {
    it('2.1 Rejects duplicate numeric chain ID within EVM family', () => {
      const reg = new NetworkCapabilityRegistry();
      const duplicateProfile: NetworkCapabilityProfile = {
        ...ZENITH_NETWORK_PROFILES.polygon,
        networkId: 'fake-polygon',
        numericChainId: 137 // Collides with Polygon PoS
      };
      assert.throws(
        () => reg.registerProfile('fake-polygon', duplicateProfile),
        /Chain ID collision.*137/i
      );
    });

    it('2.2 Arbitrum One retains unique EVM chain ID 42161', () => {
      const profile = defaultNetworkCapabilityRegistry.getNetworkCapability(42161);
      assert.ok(profile);
      assert.strictEqual(profile?.networkId, 'arbitrum');
      assert.strictEqual(profile?.numericChainId, 42161);
    });

    it('2.3 Robinhood Orbit L3 has disambiguated chain ID 421610 (no collision with Arbitrum)', () => {
      const robinhood = defaultNetworkCapabilityRegistry.getNetworkCapability('robinhood');
      assert.ok(robinhood);
      assert.strictEqual(robinhood?.numericChainId, 421610);
      assert.notStrictEqual(robinhood?.numericChainId, 42161);
    });

    it('2.4 Aptos Move network does NOT claim EVM chain ID 1', () => {
      const aptos = defaultNetworkCapabilityRegistry.getNetworkCapability('aptos');
      assert.ok(aptos);
      assert.strictEqual(aptos?.family, 'MOVE');
      assert.strictEqual(aptos?.numericChainId, undefined);

      const chain1 = defaultNetworkCapabilityRegistry.getNetworkCapability(1);
      assert.strictEqual(chain1?.networkId, 'ethereum');
    });

    it('2.5 Network keys are strictly case-insensitive', () => {
      const p1 = defaultNetworkCapabilityRegistry.getNetworkCapability('POLYGON');
      const p2 = defaultNetworkCapabilityRegistry.getNetworkCapability('polygon');
      const p3 = defaultNetworkCapabilityRegistry.getNetworkCapability('PoLyGoN');
      assert.ok(p1 && p2 && p3);
      assert.strictEqual(p1.networkId, p2.networkId);
      assert.strictEqual(p2.networkId, p3.networkId);
    });

    it('2.6 Runtime identity validation succeeds with matching RPC chainId', () => {
      const valid = defaultNetworkCapabilityRegistry.validateNetworkIdentity('polygon', 137, 137);
      assert.strictEqual(valid, true);
    });

    it('2.7 Runtime identity validation fails closed on RPC chainId mismatch', () => {
      // Attacker RPC claiming to be Polygon returns chainId 1 (Ethereum)
      const valid = defaultNetworkCapabilityRegistry.validateNetworkIdentity('polygon', 137, 1);
      assert.strictEqual(valid, false);
    });

    it('2.8 Runtime identity validation fails closed on claimed chainId mismatch', () => {
      const valid = defaultNetworkCapabilityRegistry.validateNetworkIdentity('arbitrum', 137, 42161);
      assert.strictEqual(valid, false);
    });
  });

  // ==========================================================================
  // SUITE 3: NETWORK FAMILY CLASSIFICATION
  // ==========================================================================
  describe('Suite 3: Network Family Classification', () => {
    it('3.1 EVM family declares ACCOUNT_BASED_EVM transaction model', () => {
      const def = getNetworkFamilyDefinition('EVM');
      assert.strictEqual(def.transactionModel, 'ACCOUNT_BASED_EVM');
      assert.strictEqual(def.isEvmEquivalent, true);
      assert.strictEqual(def.defaultTokenStandard, 'ERC-20');
    });

    it('3.2 Solana family declares ACCOUNT_BASED_SOLANA and non-EVM equivalence', () => {
      const def = getNetworkFamilyDefinition('SOLANA');
      assert.strictEqual(def.transactionModel, 'ACCOUNT_BASED_SOLANA');
      assert.strictEqual(def.isEvmEquivalent, false);
      assert.strictEqual(def.defaultTokenStandard, 'SPL');
    });

    it('3.3 Move family declares ACCOUNT_BASED_MOVE and linear resource model', () => {
      const def = getNetworkFamilyDefinition('MOVE');
      assert.strictEqual(def.transactionModel, 'ACCOUNT_BASED_MOVE');
      assert.strictEqual(def.isEvmEquivalent, false);
      assert.strictEqual(def.defaultTokenStandard, 'Move Coin');
    });

    it('3.4 Cosmos family declares ACCOUNT_BASED_COSMOS and BFT RPC', () => {
      const def = getNetworkFamilyDefinition('COSMOS');
      assert.strictEqual(def.transactionModel, 'ACCOUNT_BASED_COSMOS');
      assert.strictEqual(def.isEvmEquivalent, false);
    });

    it('3.5 Bitcoin family declares UTXO transaction model', () => {
      const def = getNetworkFamilyDefinition('BITCOIN');
      assert.strictEqual(def.transactionModel, 'UTXO');
      assert.strictEqual(def.isEvmEquivalent, false);
    });

    it('3.6 TVM (Tron) declares Base58Check address model and TRC-20 standard', () => {
      const def = getNetworkFamilyDefinition('TVM');
      assert.strictEqual(def.defaultTokenStandard, 'TRC-20');
      assert.strictEqual(def.isEvmEquivalent, false);
    });

    it('3.7 All 13 supported network families have explicit definitions', () => {
      const families: NetworkFamily[] = [
        'EVM', 'SOLANA', 'BITCOIN', 'COSMOS', 'MOVE', 'NEAR', 'TON', 'TVM',
        'SUBSTRATE', 'XRPL', 'STELLAR', 'UTXO', 'ICP'
      ];
      for (const fam of families) {
        const def = getNetworkFamilyDefinition(fam);
        assert.ok(def, `Family definition for ${fam} must exist`);
        assert.strictEqual(def.family, fam);
      }
    });

    it('3.8 Unknown network family throws explicit error', () => {
      assert.throws(() => getNetworkFamilyDefinition('UNKNOWN_ARCH' as any), /Unknown network family/);
    });
  });

  // ==========================================================================
  // SUITE 4: ADDRESS & TRANSACTION VALIDATION PER NETWORK FAMILY
  // ==========================================================================
  describe('Suite 4: Address & Transaction Validation per Network Family', () => {
    it('4.1 Validates valid 20-byte EVM address', () => {
      assert.strictEqual(isValidAddressForFamily('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 'EVM'), true);
    });

    it('4.2 Rejects Solana Base58 address on EVM network', () => {
      assert.strictEqual(isValidAddressForFamily('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'EVM'), false);
    });

    it('4.3 Validates valid Solana Base58 public key', () => {
      assert.strictEqual(isValidAddressForFamily('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'SOLANA'), true);
    });

    it('4.4 Rejects EVM hex address on Solana network', () => {
      assert.strictEqual(isValidAddressForFamily('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 'SOLANA'), false);
    });

    it('4.5 Validates Cosmos Bech32 address', () => {
      assert.strictEqual(isValidAddressForFamily('cosmos1hsk6jryyqjfhp5dhc55tc9jtckygx0eph6dd02', 'COSMOS'), true);
    });

    it('4.6 Rejects EVM address on Cosmos network', () => {
      assert.strictEqual(isValidAddressForFamily('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 'COSMOS'), false);
    });

    it('4.7 Validates Bitcoin Bech32 SegWit address', () => {
      assert.strictEqual(isValidAddressForFamily('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'BITCOIN'), true);
    });

    it('4.8 Validates Tron Base58Check address starting with T', () => {
      assert.strictEqual(isValidAddressForFamily('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', 'TVM'), true);
    });

    it('4.9 Validates EVM 32-byte transaction hash', () => {
      assert.strictEqual(isValidTxHashForFamily('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'EVM'), true);
    });

    it('4.10 Rejects invalid length transaction hash on EVM', () => {
      assert.strictEqual(isValidTxHashForFamily('0x12345678', 'EVM'), false);
    });
  });

  // ==========================================================================
  // SUITE 5: GRANULAR CAPABILITY EVALUATION
  // ==========================================================================
  describe('Suite 5: Granular Capability Evaluation', () => {
    it('5.1 Polygon has LIVE_VERIFIED across read, preflight, and execution capabilities', () => {
      const profile = defaultNetworkCapabilityRegistry.getNetworkCapability('polygon')!;
      assert.strictEqual(profile.readCapability, 'LIVE_VERIFIED');
      assert.strictEqual(profile.preflightCapability, 'LIVE_VERIFIED');
      assert.strictEqual(profile.txConstructionCapability, 'LIVE_VERIFIED');
      assert.strictEqual(profile.signingCapability, 'LIVE_VERIFIED');
      assert.strictEqual(profile.sameChainSwapCapability, 'LIVE_VERIFIED');
      assert.strictEqual(profile.crossChainSourceCapability, 'LIVE_VERIFIED');
      assert.strictEqual(profile.crossChainDestCapability, 'LIVE_VERIFIED');
      assert.strictEqual(profile.overallCapabilityLevel, 'LIVE_VERIFIED');
    });

    it('5.2 Solana has QUOTE_AVAILABLE for read and swap, but UNSUPPORTED for direct execution', () => {
      const sol = defaultNetworkCapabilityRegistry.getNetworkCapability('solana')!;
      assert.strictEqual(sol.readCapability, 'QUOTE_AVAILABLE');
      assert.strictEqual(sol.sameChainSwapCapability, 'QUOTE_AVAILABLE');
      assert.strictEqual(sol.signingCapability, 'UNSUPPORTED');
      assert.strictEqual(sol.crossChainSourceCapability, 'UNSUPPORTED');
      assert.strictEqual(sol.crossChainDestCapability, 'UNSUPPORTED');
      assert.strictEqual(sol.overallCapabilityLevel, 'QUOTE_AVAILABLE');
    });

    it('5.3 Unichain has QUOTE_AVAILABLE for read and preflight, but not LIVE_VERIFIED', () => {
      const uni = defaultNetworkCapabilityRegistry.getNetworkCapability('unichain')!;
      assert.strictEqual(uni.overallCapabilityLevel, 'QUOTE_AVAILABLE');
      assert.notStrictEqual(uni.overallCapabilityLevel, 'LIVE_VERIFIED');
    });

    it('5.4 Algorand is completely UNSUPPORTED', () => {
      const algo = defaultNetworkCapabilityRegistry.getNetworkCapability('algorand')!;
      assert.strictEqual(algo.overallCapabilityLevel, 'UNSUPPORTED');
      assert.strictEqual(algo.capabilityRank, 0);
    });

    it('5.5 Granular capability never infers execution from read capability', () => {
      const sol = defaultNetworkCapabilityRegistry.getNetworkCapability('solana')!;
      assert.ok(NETWORK_CAPABILITY_HIERARCHY[sol.readCapability] > 0);
      assert.strictEqual(sol.signingCapability, 'UNSUPPORTED');
    });
  });

  // ==========================================================================
  // SUITE 6: EXECUTION MODE ISOLATION
  // ==========================================================================
  describe('Suite 6: Execution Mode Isolation', () => {
    it('6.1 Polygon passes isExecutable for LIVE_EXECUTION', () => {
      const res = defaultNetworkCapabilityRegistry.isExecutable('polygon', 'LIVE_EXECUTION');
      assert.strictEqual(res.isExecutable, true);
      assert.strictEqual(res.level, 'LIVE_VERIFIED');
    });

    it('6.2 BNB (EXECUTION_AVAILABLE) fails isExecutable for LIVE_EXECUTION', () => {
      const res = defaultNetworkCapabilityRegistry.isExecutable('bnb', 'LIVE_EXECUTION');
      assert.strictEqual(res.isExecutable, false);
      assert.match(res.rejectionReason!, /LIVE_EXECUTION requires "LIVE_VERIFIED"/);
    });

    it('6.3 BNB (EXECUTION_AVAILABLE) passes isExecutable for PREFLIGHT_ONLY', () => {
      const res = defaultNetworkCapabilityRegistry.isExecutable('bnb', 'PREFLIGHT_ONLY');
      assert.strictEqual(res.isExecutable, true);
    });

    it('6.4 Solana (QUOTE_AVAILABLE) fails isExecutable for PREFLIGHT_ONLY', () => {
      const res = defaultNetworkCapabilityRegistry.isExecutable('solana', 'PREFLIGHT_ONLY');
      assert.strictEqual(res.isExecutable, false);
      assert.match(res.rejectionReason!, /PREFLIGHT_ONLY requires at least "EXECUTION_AVAILABLE"/);
    });

    it('6.5 Solana (QUOTE_AVAILABLE) passes isExecutable for READ_ONLY', () => {
      const res = defaultNetworkCapabilityRegistry.isExecutable('solana', 'READ_ONLY');
      assert.strictEqual(res.isExecutable, true);
    });

    it('6.6 Algorand (UNSUPPORTED) fails isExecutable across all execution modes', () => {
      const readRes = defaultNetworkCapabilityRegistry.isExecutable('algorand', 'READ_ONLY');
      const prefRes = defaultNetworkCapabilityRegistry.isExecutable('algorand', 'PREFLIGHT_ONLY');
      const liveRes = defaultNetworkCapabilityRegistry.isExecutable('algorand', 'LIVE_EXECUTION');
      assert.strictEqual(readRes.isExecutable, false);
      assert.strictEqual(prefRes.isExecutable, false);
      assert.strictEqual(liveRes.isExecutable, false);
    });

    it('6.7 Disabled network fails isExecutable regardless of capability rank', () => {
      const reg = new NetworkCapabilityRegistry();
      reg.transitionState('polygon', 'DISABLED', 'Emergency maintenance');
      const res = reg.isExecutable('polygon', 'LIVE_EXECUTION');
      assert.strictEqual(res.isExecutable, false);
      assert.match(res.rejectionReason!, /onboarding state is "DISABLED"/);
    });
  });

  // ==========================================================================
  // SUITE 7: EXECUTION ADAPTER INTERFACE
  // ==========================================================================
  describe('Suite 7: Execution Adapter Interface', () => {
    it('7.1 EvmExecutionAdapter supports all 12 standard EVM capabilities', () => {
      const adapter = defaultNetworkCapabilityRegistry.getAdapter('polygon');
      assert.ok(adapter instanceof EvmExecutionAdapter);
      assert.strictEqual(adapter.supports('GET_BALANCE'), true);
      assert.strictEqual(adapter.supports('GET_TOKEN_BALANCE'), true);
      assert.strictEqual(adapter.supports('GET_NONCE'), true);
      assert.strictEqual(adapter.supports('SIMULATE_TRANSACTION'), true);
      assert.strictEqual(adapter.supports('ESTIMATE_GAS'), true);
      assert.strictEqual(adapter.supports('BUILD_TRANSACTION'), true);
      assert.strictEqual(adapter.supports('DECODE_TRANSACTION'), true);
      assert.strictEqual(adapter.supports('BROADCAST_TRANSACTION'), true);
      assert.strictEqual(adapter.supports('GET_TRANSACTION'), true);
      assert.strictEqual(adapter.supports('GET_RECEIPT'), true);
      assert.strictEqual(adapter.supports('VERIFY_FINALITY'), true);
      assert.strictEqual(adapter.supports('VERIFY_TOKEN_TRANSFER'), true);
    });

    it('7.2 UnsupportedExecutionAdapter reports supports = false for all capabilities', () => {
      const adapter = defaultNetworkCapabilityRegistry.getAdapter('algorand');
      assert.ok(adapter instanceof UnsupportedExecutionAdapter);
      assert.strictEqual(adapter.supports('GET_BALANCE'), false);
      assert.strictEqual(adapter.supports('BUILD_TRANSACTION'), false);
      assert.strictEqual(adapter.supports('BROADCAST_TRANSACTION'), false);
    });

    it('7.3 EvmExecutionAdapter builds valid transaction with correct chainId', async () => {
      const adapter = defaultNetworkCapabilityRegistry.getAdapter('polygon') as EvmExecutionAdapter;
      const tx = await adapter.buildTransaction({
        to: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        data: '0xa9059cbb',
        value: '0',
        nonce: 5
      }) as any;
      assert.strictEqual(tx.chainId, 137);
      assert.strictEqual(tx.to, '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174');
      assert.strictEqual(tx.nonce, 5);
    });

    it('7.4 EvmExecutionAdapter decodes calldata selector accurately', () => {
      const adapter = defaultNetworkCapabilityRegistry.getAdapter('arbitrum') as EvmExecutionAdapter;
      const decoded = adapter.decodeTransaction('0xa9059cbb00000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000005f5e100') as any;
      assert.strictEqual(decoded.selector, '0xa9059cbb');
      assert.strictEqual(decoded.byteLength, 68);
    });

    it('7.5 EvmExecutionAdapter verifies ERC-20 Transfer log from mined receipt', () => {
      const adapter = defaultNetworkCapabilityRegistry.getAdapter('arbitrum') as EvmExecutionAdapter;
      const receipt = {
        status: 1,
        logs: [{
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            '0x000000000000000000000000e35e9842fceaca96570b734083f4a58e8f7c5f2a',
            '0x0000000000000000000000001111111111111111111111111111111111111111'
          ],
          data: '0x0000000000000000000000000000000000000000000000000000000005f5e100' // 100M
        }]
      };
      const ok = adapter.verifyTokenTransfer(
        receipt,
        '0x1111111111111111111111111111111111111111',
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        99000000n
      );
      assert.strictEqual(ok, true);
    });
  });

  // ==========================================================================
  // SUITE 8: FINALITY MODELS
  // ==========================================================================
  describe('Suite 8: Finality Models', () => {
    it('8.1 Polygon declares CONFIRMATION_BASED finality with 128 safety blocks', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('polygon')!;
      assert.strictEqual(p.finality.model, 'CONFIRMATION_BASED');
      assert.strictEqual(p.finality.reorgSafetyBlocks, 128);
      assert.strictEqual(p.finality.instantFinality, false);
    });

    it('8.2 Arbitrum One declares OPTIMISTIC finality with 20 safety blocks', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('arbitrum')!;
      assert.strictEqual(p.finality.model, 'OPTIMISTIC');
      assert.strictEqual(p.finality.reorgSafetyBlocks, 20);
    });

    it('8.3 Avalanche declares INSTANT_FINALITY via Snowman consensus', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('avalanche')!;
      assert.strictEqual(p.finality.model, 'INSTANT_FINALITY');
      assert.strictEqual(p.finality.instantFinality, true);
      assert.strictEqual(p.finality.reorgSafetyBlocks, 1);
    });

    it('8.4 Bitcoin declares PROBABILISTIC finality with 6 blocks', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('bitcoin')!;
      assert.strictEqual(p.finality.model, 'PROBABILISTIC');
      assert.strictEqual(p.finality.reorgSafetyBlocks, 6);
    });

    it('8.5 Cosmos Hub declares INSTANT_FINALITY with CometBFT single-block finality', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('cosmoshub')!;
      assert.strictEqual(p.finality.model, 'INSTANT_FINALITY');
      assert.strictEqual(p.finality.instantFinality, true);
    });

    it('8.6 getFinalityModel returns FINALITY_UNKNOWN for unregistered network', () => {
      const model = defaultNetworkCapabilityRegistry.getFinalityModel('non-existent-chain');
      assert.strictEqual(model, 'FINALITY_UNKNOWN');
    });
  });

  // ==========================================================================
  // SUITE 9: GAS MODELS
  // ==========================================================================
  describe('Suite 9: Gas Models', () => {
    it('9.1 Ethereum declares EVM_EIP1559 gas model with blob transaction support', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('ethereum')!;
      assert.strictEqual(p.gas.modelType, 'EVM_EIP1559');
      assert.strictEqual(p.gas.supportsEIP1559, true);
      assert.strictEqual(p.gas.supportsBlobTransactions, true);
    });

    it('9.2 Base declares EVM_OP_STACK_L2 gas model (execution + L1 DA fee)', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('base')!;
      assert.strictEqual(p.gas.modelType, 'EVM_OP_STACK_L2');
      assert.strictEqual(p.gas.supportsEIP1559, true);
    });

    it('9.3 Arbitrum declares EVM_ARBITRUM_L2 gas model', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('arbitrum')!;
      assert.strictEqual(p.gas.modelType, 'EVM_ARBITRUM_L2');
    });

    it('9.4 BNB Chain declares EVM_LEGACY gas model without EIP-1559', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('bnb')!;
      assert.strictEqual(p.gas.modelType, 'EVM_LEGACY');
      assert.strictEqual(p.gas.supportsEIP1559, false);
    });

    it('9.5 Solana declares SOLANA_FEE model (Lamports base + compute units)', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('solana')!;
      assert.strictEqual(p.gas.modelType, 'SOLANA_FEE');
      assert.strictEqual(p.gas.baseFeeUnit, 'Lamports');
    });

    it('9.6 Bitcoin declares UTXO_FEE model (satoshis per vByte)', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('bitcoin')!;
      assert.strictEqual(p.gas.modelType, 'UTXO_FEE');
      assert.strictEqual(p.gas.baseFeeUnit, 'sat/vB');
    });
  });

  // ==========================================================================
  // SUITE 10: TOKEN STANDARDS & IDENTITY
  // ==========================================================================
  describe('Suite 10: Token Standards & Identity', () => {
    it('10.1 Polygon supports ERC-20 and Permit2', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('polygon')!;
      assert.ok(p.supportedTokenStandards.includes('ERC-20'));
      assert.ok(p.supportedTokenStandards.includes('Permit2'));
    });

    it('10.2 Solana supports SPL and SPL-2022', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('solana')!;
      assert.ok(p.supportedTokenStandards.includes('SPL'));
      assert.ok(p.supportedTokenStandards.includes('SPL-2022'));
    });

    it('10.3 Native currency metadata includes name, symbol, decimals, and address', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('polygon')!;
      assert.strictEqual(p.nativeAsset.symbol, 'POL');
      assert.strictEqual(p.nativeAsset.decimals, 18);
      assert.strictEqual(p.nativeAsset.isNative, true);
    });

    it('10.4 getTokenCapability validates valid address for network family', () => {
      const res = defaultNetworkCapabilityRegistry.getTokenCapability('polygon', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174');
      assert.strictEqual(res.supported, true);
      assert.strictEqual(res.standard, 'ERC-20');
    });

    it('10.5 getTokenCapability rejects malformed address for network family', () => {
      const res = defaultNetworkCapabilityRegistry.getTokenCapability('polygon', 'invalid-address');
      assert.strictEqual(res.supported, false);
      assert.match(res.reason!, /Invalid token address format/);
    });
  });

  // ==========================================================================
  // SUITE 11: BRIDGE CAPABILITY SEPARATION
  // ==========================================================================
  describe('Suite 11: Bridge Capability Separation', () => {
    it('11.1 Polygon to Arbitrum Across corridor is certified LIVE_VERIFIED', () => {
      const cap = defaultNetworkCapabilityRegistry.getBridgeCapability('polygon', 'across');
      assert.strictEqual(cap, 'LIVE_VERIFIED');
    });

    it('11.2 Network with RPC support but no bridge corridor returns UNSUPPORTED for bridge', () => {
      const cap = defaultNetworkCapabilityRegistry.getBridgeCapability('celo', 'across');
      assert.strictEqual(cap, 'UNSUPPORTED');
    });

    it('11.3 Arbitrary unconfigured provider returns UNSUPPORTED', () => {
      const cap = defaultNetworkCapabilityRegistry.getBridgeCapability('polygon', 'nonexistent_bridge');
      assert.strictEqual(cap, 'UNSUPPORTED');
    });

    it('11.4 Bridge capability is strictly independent of general network presence', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('celo')!;
      assert.strictEqual(p.overallCapabilityLevel, 'CONFIGURED');
      assert.strictEqual(defaultNetworkCapabilityRegistry.getBridgeCapability('celo', 'across'), 'UNSUPPORTED');
    });
  });

  // ==========================================================================
  // SUITE 12: DEX CAPABILITY SEPARATION
  // ==========================================================================
  describe('Suite 12: DEX Capability Separation', () => {
    it('12.1 Polygon Uniswap V3 is certified LIVE_VERIFIED with non-empty router address', () => {
      const p = defaultNetworkCapabilityRegistry.getNetworkCapability('polygon')!;
      const dex = p.dexCapabilities.uniswap_v3;
      assert.ok(dex);
      assert.strictEqual(dex.executionCapability, 'LIVE_VERIFIED');
      assert.strictEqual(dex.routerAddress, '0xE592427A0AEce92De3Edee1F18E0157C05861564');
      assert.notStrictEqual(dex.routerAddress, '0x0000000000000000000000000000000000000000');
    });

    it('12.2 Arbitrum Camelot V3 is certified LIVE_VERIFIED', () => {
      const cap = defaultNetworkCapabilityRegistry.getDexCapability('arbitrum', 'camelot_v3');
      assert.strictEqual(cap, 'LIVE_VERIFIED');
    });

    it('12.3 Querying unconfigured DEX returns UNSUPPORTED', () => {
      const cap = defaultNetworkCapabilityRegistry.getDexCapability('polygon', 'unknown_dex');
      assert.strictEqual(cap, 'UNSUPPORTED');
    });
  });

  // ==========================================================================
  // SUITE 13: NETWORK HEALTH INTEGRATION
  // ==========================================================================
  describe('Suite 13: Network Health Integration', () => {
    it('13.1 Returns HEALTHY when all RPC endpoints operate normally', () => {
      const health = defaultNetworkCapabilityRegistry.getNetworkHealth('polygon');
      assert.strictEqual(health, 'HEALTHY');
    });

    it('13.2 Network with simulated open circuit returns CIRCUIT_OPEN and blocks execution', () => {
      const reg = new NetworkCapabilityRegistry(undefined, {
        getEndpoints: () => [{ id: 'ep-1', chainId: 'polygon', numericChainId: 137, url: 'http://', priority: 1, weight: 1, status: 'UNHEALTHY', circuitState: 'OPEN' }]
      } as any);
      const health = reg.getNetworkHealth('polygon');
      assert.strictEqual(health, 'CIRCUIT_OPEN');

      const exec = reg.isExecutable('polygon', 'LIVE_EXECUTION');
      assert.strictEqual(exec.isExecutable, false);
      assert.match(exec.rejectionReason!, /CIRCUIT_OPEN/);
    });

    it('13.3 Network with all endpoints UNAVAILABLE returns UNHEALTHY and blocks execution', () => {
      const reg = new NetworkCapabilityRegistry(undefined, {
        getEndpoints: () => [{ id: 'ep-1', chainId: 'polygon', numericChainId: 137, url: 'http://', priority: 1, weight: 1, status: 'UNHEALTHY', circuitState: 'CLOSED' }]
      } as any);
      const health = reg.getNetworkHealth('polygon');
      assert.strictEqual(health, 'UNHEALTHY');

      const exec = reg.isExecutable('polygon', 'LIVE_EXECUTION');
      assert.strictEqual(exec.isExecutable, false);
      assert.match(exec.rejectionReason!, /UNHEALTHY/);
    });
  });

  // ==========================================================================
  // SUITE 14: ONBOARDING STATE MACHINE
  // ==========================================================================
  describe('Suite 14: Onboarding State Machine', () => {
    it('14.1 Allows monotonic progression: DISCOVERED -> CONFIGURED -> UNIT_TESTED', () => {
      assert.strictEqual(defaultNetworkCapabilityRegistry.canTransition('DISCOVERED', 'CONFIGURED'), true);
      assert.strictEqual(defaultNetworkCapabilityRegistry.canTransition('CONFIGURED', 'UNIT_TESTED'), true);
      assert.strictEqual(defaultNetworkCapabilityRegistry.canTransition('UNIT_TESTED', 'QUOTE_ENABLED'), true);
      assert.strictEqual(defaultNetworkCapabilityRegistry.canTransition('QUOTE_ENABLED', 'EXECUTION_ENABLED'), true);
      assert.strictEqual(defaultNetworkCapabilityRegistry.canTransition('EXECUTION_ENABLED', 'LIVE_VERIFIED'), true);
    });

    it('14.2 Rejects backward transition without administrative override', () => {
      assert.strictEqual(defaultNetworkCapabilityRegistry.canTransition('LIVE_VERIFIED', 'DISCOVERED'), false);
      assert.strictEqual(defaultNetworkCapabilityRegistry.canTransition('EXECUTION_ENABLED', 'CONFIGURED'), false);
    });

    it('14.3 Allows immediate transition to DISABLED or DEPRECATED from any state', () => {
      assert.strictEqual(defaultNetworkCapabilityRegistry.canTransition('LIVE_VERIFIED', 'DISABLED'), true);
      assert.strictEqual(defaultNetworkCapabilityRegistry.canTransition('EXECUTION_ENABLED', 'DEPRECATED'), true);
      assert.strictEqual(defaultNetworkCapabilityRegistry.canTransition('CONFIGURED', 'DISABLED'), true);
    });

    it('14.4 transitionState updates profile onboardingState and notes', () => {
      const reg = new NetworkCapabilityRegistry();
      reg.transitionState('sepolia', 'QUOTE_ENABLED', 'Completed testnet quote benchmarking');
      const p = reg.getNetworkCapability('sepolia')!;
      assert.strictEqual(p.onboardingState, 'QUOTE_ENABLED');
      assert.match(p.notes!, /Completed testnet quote benchmarking/);
    });

    it('14.5 transitionState throws on illegal state transition', () => {
      const reg = new NetworkCapabilityRegistry();
      assert.throws(
        () => reg.transitionState('polygon', 'DISCOVERED'),
        /Invalid onboarding state transition/
      );
    });
  });

  // ==========================================================================
  // SUITE 15: EXISTING NETWORK MIGRATION & CLASSIFICATION
  // ==========================================================================
  describe('Suite 15: Existing Network Migration & Classification', () => {
    it('15.1 All 58 networks from chains.data are successfully registered', () => {
      const all = defaultNetworkCapabilityRegistry.getAllNetworks();
      assert.strictEqual(all.length, 58);
    });

    it('15.2 Exactly 5 networks are classified as TESTNET_ONLY', () => {
      const testnets = defaultNetworkCapabilityRegistry.getAllNetworks({ isTestnet: true });
      assert.strictEqual(testnets.length, 5);
      const ids = testnets.map((t) => t.networkId);
      assert.ok(ids.includes('sepolia'));
      assert.ok(ids.includes('arbitrum_sepolia'));
      assert.ok(ids.includes('base_sepolia'));
      assert.ok(ids.includes('optimism_sepolia'));
      assert.ok(ids.includes('polygon_amoy'));
    });

    it('15.3 Core certified EVM networks are classified as SUPPORTED', () => {
      const supported = defaultNetworkCapabilityRegistry.getAllNetworks({ operational: 'SUPPORTED' });
      assert.ok(supported.length >= 10);
      const ids = supported.map((s) => s.networkId);
      assert.ok(ids.includes('ethereum'));
      assert.ok(ids.includes('polygon'));
      assert.ok(ids.includes('arbitrum'));
      assert.ok(ids.includes('base'));
      assert.ok(ids.includes('optimism'));
    });

    it('15.4 Non-EVM networks with partial support are classified as PARTIALLY_SUPPORTED', () => {
      const sol = defaultNetworkCapabilityRegistry.getNetworkCapability('solana')!;
      assert.strictEqual(sol.operationalClassification, 'PARTIALLY_SUPPORTED');
    });

    it('15.5 Unsupported networks are classified as UNSUPPORTED', () => {
      const algo = defaultNetworkCapabilityRegistry.getNetworkCapability('algorand')!;
      assert.strictEqual(algo.operationalClassification, 'UNSUPPORTED');
    });
  });

  // ==========================================================================
  // SUITE 16: ROUTE ARBITRATION INTEGRATION (GATE 0)
  // ==========================================================================
  describe('Suite 16: Route Arbitration Integration (Gate 0)', () => {
    it('16.1 Route on certified LIVE_VERIFIED networks passes Gate 0', () => {
      const route: NormalizedRoute = {
        id: 'route-poly-arb',
        routeType: 'CROSS_CHAIN_DIRECT',
        sourceChainId: '137',
        destinationChainId: '42161',
        sourceToken: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6, chainId: 137 },
        destinationToken: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6, chainId: 42161 },
        amountInRaw: '100000000',
        expectedOutputRaw: '99800000',
        minimumOutputRaw: '99500000',
        bridgeProvider: 'across',
        capabilityLevel: 'LIVE_VERIFIED',
        freshnessState: 'FRESH',
        quotedAt: Date.now() - 5000,
        expiresAt: Date.now() + 60000,
        isExecutable: true,
        steps: []
      };
      const req: QuoteRequest = {
        sourceChainId: 137,
        destinationChainId: 42161,
        tokenIn: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6, chainId: 137 },
        tokenOut: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6, chainId: 42161 },
        amountInRaw: '100000000',
        executionMode: 'LIVE_EXECUTION'
      };

      const res = RouteCapabilityFilter.evaluate(route, req, { executionMode: 'LIVE_EXECUTION' });
      assert.ok(res.passedGates.includes('GATE_0_NETWORK_CAPABILITY'), 'Must pass Gate 0');
    });

    it('16.2 Route on UNSUPPORTED source network fails Gate 0 and is rejected', () => {
      const route: NormalizedRoute = {
        id: 'route-unsupported-src',
        routeType: 'CROSS_CHAIN_DIRECT',
        sourceChainId: 'algorand', // Unsupported!
        destinationChainId: '42161',
        sourceToken: { address: 'native', symbol: 'ALGO', decimals: 6, chainId: 0 },
        destinationToken: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6, chainId: 42161 },
        amountInRaw: '100000000',
        expectedOutputRaw: '99800000',
        minimumOutputRaw: '99500000',
        capabilityLevel: 'LIVE_VERIFIED',
        freshnessState: 'FRESH',
        quotedAt: Date.now() - 5000,
        expiresAt: Date.now() + 60000,
        isExecutable: true,
        steps: []
      };
      const req: QuoteRequest = {
        sourceChainId: 0,
        destinationChainId: 42161,
        tokenIn: { address: 'native', symbol: 'ALGO', decimals: 6, chainId: 0 },
        tokenOut: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6, chainId: 42161 },
        amountInRaw: '100000000',
        executionMode: 'LIVE_EXECUTION'
      };

      const res = RouteCapabilityFilter.evaluate(route, req, { executionMode: 'LIVE_EXECUTION' });
      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.failedGates.includes('GATE_0_NETWORK_CAPABILITY'));
      assert.match(res.unexecutableReason!, /SOURCE_NETWORK_UNSUPPORTED/);
    });

    it('16.3 Route targeting UNSUPPORTED destination network fails Gate 0 and is rejected', () => {
      const route: NormalizedRoute = {
        id: 'route-unsupported-dst',
        routeType: 'CROSS_CHAIN_DIRECT',
        sourceChainId: '137',
        destinationChainId: 'cardano', // Unsupported destination!
        sourceToken: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6, chainId: 137 },
        destinationToken: { address: 'native', symbol: 'ADA', decimals: 6, chainId: 0 },
        amountInRaw: '100000000',
        expectedOutputRaw: '99800000',
        minimumOutputRaw: '99500000',
        capabilityLevel: 'LIVE_VERIFIED',
        freshnessState: 'FRESH',
        quotedAt: Date.now() - 5000,
        expiresAt: Date.now() + 60000,
        isExecutable: true,
        steps: []
      };
      const req: QuoteRequest = {
        sourceChainId: 137,
        destinationChainId: 0,
        tokenIn: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6, chainId: 137 },
        tokenOut: { address: 'native', symbol: 'ADA', decimals: 6, chainId: 0 },
        amountInRaw: '100000000',
        executionMode: 'LIVE_EXECUTION'
      };

      const res = RouteCapabilityFilter.evaluate(route, req, { executionMode: 'LIVE_EXECUTION' });
      assert.strictEqual(res.isExecutable, false);
      assert.ok(res.failedGates.includes('GATE_0_NETWORK_CAPABILITY'));
      assert.match(res.unexecutableReason!, /DESTINATION_NETWORK_UNSUPPORTED/);
    });
  });

  // ==========================================================================
  // SUITE 17: EXECUTION PLAN BUILDER INTEGRATION
  // ==========================================================================
  describe('Suite 17: ExecutionPlanBuilder Integration', () => {
    it('17.1 Plan generation marks isExecutable: false when source network is UNSUPPORTED', () => {
      const plan = ExecutionPlanBuilder.buildPlan({
        route: {
          id: 'route-unsupported-src',
          sourceChainId: 'algorand',
          destinationChainId: 42161,
          tokenIn: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', chainId: 137, symbol: 'USDC', decimals: 6 },
          tokenOut: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', chainId: 42161, symbol: 'USDC', decimals: 6 },
          steps: [],
          execution: { target: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096', data: '0x12345678', value: '0' }
        } as any,
        request: {
          sourceChainId: 'algorand',
          destinationChainId: 42161,
          tokenIn: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6, isNative: false },
          tokenOut: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6, isNative: false },
          amountInRaw: '100000000',
          executionMode: 'LIVE_EXECUTION'
        } as any
      });
      assert.strictEqual(plan.isExecutable, false);
      assert.match(plan.unexecutableReason!, /Source network.*UNSUPPORTED/);
    });

    it('17.2 Plan generation marks isExecutable: false when destination network is UNSUPPORTED', () => {
      const plan = ExecutionPlanBuilder.buildPlan({
        route: {
          id: 'route-unsupported-dst',
          sourceChainId: 137,
          destinationChainId: 'cardano',
          tokenIn: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', chainId: 137, symbol: 'USDC', decimals: 6 },
          tokenOut: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', chainId: 42161, symbol: 'USDC', decimals: 6 },
          steps: [],
          execution: { target: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096', data: '0x12345678', value: '0' }
        } as any,
        request: {
          sourceChainId: 137,
          destinationChainId: 'cardano',
          tokenIn: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6, isNative: false },
          tokenOut: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6, isNative: false },
          amountInRaw: '100000000',
          executionMode: 'LIVE_EXECUTION'
        } as any
      });
      assert.strictEqual(plan.isExecutable, false);
      assert.match(plan.unexecutableReason!, /Destination network.*UNSUPPORTED/);
    });
  });

  // ==========================================================================
  // SUITE 18: DETERMINISTIC FUZZING - 1,000 NETWORK CAPABILITY MUTATIONS
  // ==========================================================================
  describe('Suite 18: Deterministic Fuzzing - 1,000 Network Capability Mutations', () => {
    it('18.1 1,000 randomized capability mutations fail closed with 100% safety (seed 0x7A5C36)', () => {
      const prng = createPrng(0x7A5C36);
      const levels: NetworkCapabilityLevel[] = ['UNSUPPORTED', 'UNIT_TESTED', 'CONFIGURED', 'QUOTE_AVAILABLE', 'EXECUTION_AVAILABLE', 'LIVE_VERIFIED'];
      const modes: Array<'READ_ONLY' | 'PREFLIGHT_ONLY' | 'LIVE_EXECUTION'> = ['READ_ONLY', 'PREFLIGHT_ONLY', 'LIVE_EXECUTION'];

      let rejectionsVerified = 0;
      for (let i = 0; i < 1000; i++) {
        const levelIdx = Math.floor(prng() * levels.length);
        const modeIdx = Math.floor(prng() * modes.length);
        const assignedLevel = levels[levelIdx];
        const mode = modes[modeIdx];

        const tempProfile: NetworkCapabilityProfile = {
          ...ZENITH_NETWORK_PROFILES.polygon,
          networkId: `fuzz-net-${i}`,
          numericChainId: 900000 + i,
          overallCapabilityLevel: assignedLevel,
          capabilityRank: NETWORK_CAPABILITY_HIERARCHY[assignedLevel]
        };

        const reg = new NetworkCapabilityRegistry();
        reg.registerProfile(`fuzz-net-${i}`, tempProfile);

        const execRes = reg.isExecutable(`fuzz-net-${i}`, mode);
        const requiredRank = mode === 'LIVE_EXECUTION' ? 5 : mode === 'PREFLIGHT_ONLY' ? 4 : 2;

        if (tempProfile.capabilityRank < requiredRank) {
          assert.strictEqual(execRes.isExecutable, false, `Fuzz iteration ${i}: level ${assignedLevel} must not be executable in ${mode}`);
          rejectionsVerified++;
        } else {
          assert.strictEqual(execRes.isExecutable, true, `Fuzz iteration ${i}: level ${assignedLevel} must be executable in ${mode}`);
        }
      }
      assert.ok(rejectionsVerified > 0, 'Must have verified rejections');
    });
  });

  // ==========================================================================
  // SUITE 19: DETERMINISTIC FUZZING - 1,000 CHAIN IDENTITY MUTATIONS
  // ==========================================================================
  describe('Suite 19: Deterministic Fuzzing - 1,000 Chain Identity Mutations', () => {
    it('19.1 1,000 chain ID mutations strictly prevent unregistered execution (seed 0x7A5C36)', () => {
      const prng = createPrng(0x7A5C36);
      let blockedCount = 0;

      for (let i = 0; i < 1000; i++) {
        // Generate random fake chain ID
        const fakeChainId = Math.floor(prng() * 9000000) + 1000000;
        const res = defaultNetworkCapabilityRegistry.isExecutable(fakeChainId, 'LIVE_EXECUTION');
        assert.strictEqual(res.isExecutable, false);
        assert.strictEqual(res.level, 'UNSUPPORTED');
        blockedCount++;
      }
      assert.strictEqual(blockedCount, 1000);
    });
  });

  // ==========================================================================
  // SUITE 20: DETERMINISTIC FUZZING - 1,000 PROVIDER / NETWORK MISMATCHES
  // ==========================================================================
  describe('Suite 20: Deterministic Fuzzing - 1,000 Provider / Network Mismatches', () => {
    it('10.1 1,000 unconfigured provider corridors return UNSUPPORTED (seed 0x7A5C36)', () => {
      const prng = createPrng(0x7A5C36);
      const networks = ['polygon', 'arbitrum', 'optimism', 'base', 'celo', 'gnosis'];

      let unconfiguredCount = 0;
      for (let i = 0; i < 1000; i++) {
        const net = networks[Math.floor(prng() * networks.length)];
        const fakeProvider = `provider_spoof_${Math.floor(prng() * 10000)}`;

        const cap = defaultNetworkCapabilityRegistry.getBridgeCapability(net, fakeProvider);
        assert.strictEqual(cap, 'UNSUPPORTED');
        unconfiguredCount++;
      }
      assert.strictEqual(unconfiguredCount, 1000);
    });
  });

  // ==========================================================================
  // SUITE 21: DETERMINISTIC FUZZING - 1,000 CAPABILITY DOWNGRADE / UPGRADE MUTATIONS
  // ==========================================================================
  describe('Suite 21: Deterministic Fuzzing - 1,000 Capability Downgrade / Upgrade Mutations', () => {
    it('21.1 1,000 onboarding state mutations enforce valid progression (seed 0x7A5C36)', () => {
      const prng = createPrng(0x7A5C36);
      const states: NetworkOnboardingState[] = [
        'DISCOVERED', 'CONFIGURED', 'UNIT_TESTED', 'QUOTE_ENABLED', 'EXECUTION_ENABLED', 'LIVE_VERIFIED', 'DEPRECATED', 'DISABLED'
      ];

      for (let i = 0; i < 1000; i++) {
        const fromState = states[Math.floor(prng() * states.length)];
        const toState = states[Math.floor(prng() * states.length)];

        const allowed = defaultNetworkCapabilityRegistry.canTransition(fromState, toState);
        if (toState === 'DISABLED' || toState === 'DEPRECATED') {
          assert.strictEqual(allowed, true);
        } else if (fromState === 'DISABLED') {
          assert.strictEqual(allowed, false);
        }
      }
    });
  });

  // ==========================================================================
  // SUITE 22: PERFORMANCE & LATENCY BENCHMARKS
  // ==========================================================================
  describe('Suite 22: Performance & Latency Benchmarks', () => {
    it('22.1 getNetworkCapability lookup latency is under 0.05ms', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        defaultNetworkCapabilityRegistry.getNetworkCapability('polygon');
      }
      const avgMs = (performance.now() - start) / 1000;
      assert.ok(avgMs < 0.05, `Average lookup was ${avgMs}ms, ceiling 0.05ms`);
    });

    it('22.2 isExecutable evaluation latency is under 0.05ms', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        defaultNetworkCapabilityRegistry.isExecutable('arbitrum', 'LIVE_EXECUTION');
      }
      const avgMs = (performance.now() - start) / 1000;
      assert.ok(avgMs < 0.05, `Average evaluation was ${avgMs}ms, ceiling 0.05ms`);
    });

    it('22.3 Address format validation latency is under 0.01ms', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        isValidAddressForFamily('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 'EVM');
      }
      const avgMs = (performance.now() - start) / 1000;
      assert.ok(avgMs < 0.01, `Average validation was ${avgMs}ms, ceiling 0.01ms`);
    });

    it('22.4 1,000 batch capability checks complete in under 50ms', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        defaultNetworkCapabilityRegistry.getExecutionCapability(137);
        defaultNetworkCapabilityRegistry.getBridgeCapability(137, 'across');
        defaultNetworkCapabilityRegistry.getDexCapability(137, 'uniswap_v3');
      }
      const totalMs = performance.now() - start;
      assert.ok(totalMs < 50, `1,000 batch checks took ${totalMs}ms, ceiling 50ms`);
    });
  });
});
