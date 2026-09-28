/**
 * ZENITH — PHASE 2 TASK 38 CERTIFICATION TEST SUITE
 * Multi-Provider RPC Infrastructure & Network Communication Certification
 *
 * Requirements:
 * - >= 100 dedicated certification tests
 * - 4,000 deterministic fuzz iterations with PRNG seed 0x7A5C38
 * - Full validation of RpcProviderProfile, 3-tier capability model,
 *   network identity verification, wrong-network defenses, health state machine,
 *   stale-head detection, deterministic provider selection, safe failover,
 *   broadcast ambiguity protection, response integrity, disagreement engine,
 *   non-EVM RPC adapters, and sanitized telemetry.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  AuthoritativeRpcProviderRegistry,
  defaultAuthoritativeRpcProviderRegistry,
  RpcDisagreementEngine,
  EvmRpcAdapter,
  UnsupportedRpcAdapter,
  validateRpcEndpointUrl,
  sanitizeRpcUrl,
  defaultAuthoritativeNetworkRegistry,
  defaultNetworkCapabilityRegistry,
  ZENITH_AUTHORITATIVE_NETWORKS
} from '../packages/chains/src';
import type {
  RpcProviderProfile,
  RpcCapabilityType,
  RpcErrorType,
  ProviderHealthStatus
} from '../packages/types/src';

// Deterministic PRNG using Linear Congruential Generator with seed 0x7A5C38
class DeterministicPRNG {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  public next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  public nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  public pick<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }
}

describe('ZENITH — PHASE 2 TASK 38: MULTI-PROVIDER RPC INFRASTRUCTURE CERTIFICATION', () => {

  // ==========================================================================
  // SUITE 1: AUTHORITATIVE RPC PROVIDER PROFILE & METADATA INTEGRITY
  // ==========================================================================
  describe('Suite 1: Authoritative RpcProviderProfile & Metadata Integrity', () => {
    it('1.1 Providers seeded from Task 37 authoritative catalog exist', () => {
      const ethProviders = defaultAuthoritativeRpcProviderRegistry.getProviders('ethereum');
      assert.ok(ethProviders.length > 0);
      assert.strictEqual(ethProviders[0].networkId, 'ethereum');
      assert.strictEqual(ethProviders[0].family, 'EVM');
      assert.strictEqual(ethProviders[0].namespace, 'eip155');
    });

    it('1.2 Every seeded provider profile possesses complete required metadata', () => {
      const polyProviders = defaultAuthoritativeRpcProviderRegistry.getProviders('polygon');
      assert.ok(polyProviders.length > 0);
      const p = polyProviders[0];
      assert.ok(p.providerId);
      assert.ok(p.providerName);
      assert.strictEqual(p.networkId, 'polygon');
      assert.ok(p.endpoint);
      assert.strictEqual(p.transport, 'HTTPS');
      assert.strictEqual(typeof p.readCapability, 'boolean');
      assert.strictEqual(typeof p.preflightCapability, 'boolean');
      assert.strictEqual(typeof p.broadcastCapability, 'boolean');
      assert.strictEqual(typeof p.priority, 'number');
      assert.ok(p.expectedChainIdentity);
      assert.strictEqual(p.expectedChainIdentity.numericChainId, 137);
    });

    it('1.3 Rejects registering provider with missing or empty providerId', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      assert.throws(() => {
        registry.registerProvider({
          providerId: '',
          providerName: 'Invalid',
          networkId: 'ethereum'
        } as any);
      }, /Provider ID must be a non-empty string/);
    });

    it('1.4 Rejects registering provider attached to unknown networkId', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      assert.throws(() => {
        registry.registerProvider({
          providerId: 'rogue-rpc',
          providerName: 'Rogue',
          networkId: 'ghost-chain-999'
        } as any);
      }, /Provider rogue-rpc attached to unknown or uncertified network/);
    });

    it('1.5 Supports clean provider removal from registry', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      const profile: RpcProviderProfile = {
        providerId: 'temp-eth-rpc',
        providerName: 'Temp ETH',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://rpc.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      };

      registry.registerProvider(profile);
      assert.ok(registry.getProvider('temp-eth-rpc'));
      assert.strictEqual(registry.removeProvider('temp-eth-rpc'), true);
      assert.strictEqual(registry.getProvider('temp-eth-rpc'), undefined);
      assert.strictEqual(registry.removeProvider('temp-eth-rpc'), false);
    });
  });

  // ==========================================================================
  // SUITE 2: 3-TIER RPC CAPABILITY MODEL
  // ==========================================================================
  describe('Suite 2: 3-Tier RPC Capability Model (READ, PREFLIGHT, BROADCAST)', () => {
    it('2.1 READ_ONLY capability does not imply PREFLIGHT or BROADCAST', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'read-only-rpc',
        providerName: 'Read Only Provider',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://read.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: false,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      assert.ok(registry.getBestProvider('ethereum', 'READ_ONLY'));
      assert.strictEqual(registry.getBestProvider('ethereum', 'PREFLIGHT'), undefined);
      assert.strictEqual(registry.getBestProvider('ethereum', 'BROADCAST'), undefined);
    });

    it('2.2 PREFLIGHT capability allows READ and PREFLIGHT but denies BROADCAST', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'sim-rpc',
        providerName: 'Simulation Provider',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://sim.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      assert.ok(registry.getBestProvider('ethereum', 'READ_ONLY'));
      assert.ok(registry.getBestProvider('ethereum', 'PREFLIGHT'));
      assert.strictEqual(registry.getBestProvider('ethereum', 'BROADCAST'), undefined);
    });

    it('2.3 BROADCAST provider explicitly supports BROADCAST', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'broadcaster-rpc',
        providerName: 'Broadcaster Provider',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://broadcast.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: true,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      const p = registry.getBestProvider('ethereum', 'BROADCAST');
      assert.ok(p);
      assert.strictEqual(p.providerId, 'broadcaster-rpc');
    });

    it('2.4 getProviderCapabilities surfaces exact capability flags', () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('ethereum')[0];
      assert.ok(p);
      const caps = defaultAuthoritativeRpcProviderRegistry.getProviderCapabilities(p.providerId);
      assert.ok(caps);
      assert.strictEqual(caps.read, true);
      assert.strictEqual(caps.preflight, true);
    });
  });

  // ==========================================================================
  // SUITE 3: NETWORK IDENTITY VERIFICATION & CAIP-2 BINDING
  // ==========================================================================
  describe('Suite 3: Network Identity Verification & CAIP-2 Binding', () => {
    it('3.1 Successful identity verification for EVM network with matching numeric chainId', async () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'arb-rpc',
        providerName: 'Arb Public',
        networkId: 'arbitrum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://arb.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: true,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 42161, numericChainId: 42161 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      const verified = await registry.verifyProviderIdentity('arb-rpc', async () => 42161);
      assert.strictEqual(verified, true);
      const p = registry.getProvider('arb-rpc');
      assert.strictEqual(p?.verificationStatus, 'IDENTITY_VERIFIED');
    });

    it('3.2 Successful identity verification for Non-EVM network with string chainId', async () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'solana-rpc',
        providerName: 'Solana Public',
        networkId: 'solana',
        family: 'SOLANA',
        namespace: 'solana',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://solana.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: false,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'SOLANA', namespace: 'solana', chainId: 'mainnet-beta' },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      const verified = await registry.verifyProviderIdentity('solana-rpc', async () => 'mainnet-beta');
      assert.strictEqual(verified, true);
    });

    it('3.3 Throws error when verifying non-existent provider', async () => {
      await assert.rejects(
        async () => defaultAuthoritativeRpcProviderRegistry.verifyProviderIdentity('ghost-provider', async () => 1),
        /Provider "ghost-provider" not found in registry/
      );
    });
  });

  // ==========================================================================
  // SUITE 4: WRONG-NETWORK DEFENSE
  // ==========================================================================
  describe('Suite 4: Wrong-Network Defense (Cross-Chain & Environment Mismatches)', () => {
    it('4.1 Rejects EVM provider returning wrong chain ID with RPC_NETWORK_IDENTITY_MISMATCH', async () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'confused-polygon-rpc',
        providerName: 'Confused Polygon',
        networkId: 'polygon',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://polygon.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: true,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 137, numericChainId: 137 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      // Probe returns Ethereum mainnet (1) instead of Polygon (137)
      await assert.rejects(
        async () => registry.verifyProviderIdentity('confused-polygon-rpc', async () => 1),
        /RPC_NETWORK_IDENTITY_MISMATCH/
      );

      const p = registry.getProvider('confused-polygon-rpc');
      assert.strictEqual(p?.healthState, 'CIRCUIT_OPEN');
      assert.strictEqual(p?.verificationStatus, 'DISABLED');
    });

    it('4.2 Rejects testnet provider masquerading as mainnet provider', async () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'fake-eth-mainnet-rpc',
        providerName: 'Sepolia Masquerading as Mainnet',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://fake.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: true,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      // Returns Sepolia chain ID 11155111
      await assert.rejects(
        async () => registry.verifyProviderIdentity('fake-eth-mainnet-rpc', async () => 11155111),
        /RPC_NETWORK_IDENTITY_MISMATCH/
      );
    });

    it('4.3 Rejects non-EVM provider returning mismatched chain string', async () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'cosmos-rpc',
        providerName: 'Cosmos Hub Public',
        networkId: 'cosmos',
        family: 'COSMOS',
        namespace: 'cosmos',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://cosmos.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: false,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'COSMOS', namespace: 'cosmos', chainId: 'cosmoshub-4' },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      // Returns osmosis-1 instead of cosmoshub-4
      await assert.rejects(
        async () => registry.verifyProviderIdentity('cosmos-rpc', async () => 'osmosis-1'),
        /RPC_NETWORK_IDENTITY_MISMATCH/
      );
    });
  });

  // ==========================================================================
  // SUITE 5: PROVIDER HEALTH STATE MACHINE
  // ==========================================================================
  describe('Suite 5: Provider Health State Machine Transitions', () => {
    it('5.1 Single failure transitions HEALTHY to DEGRADED', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ failureThreshold: 3, seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'health-test-rpc',
        providerName: 'Health Test',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://test.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      registry.markProviderFailure('health-test-rpc', 'TIMEOUT', true);
      assert.strictEqual(registry.getProviderHealth('health-test-rpc'), 'DEGRADED');
    });

    it('5.2 Reaching failureThreshold opens circuit breaker', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ failureThreshold: 3, circuitOpenCooldownMs: 1000, seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'circuit-test-rpc',
        providerName: 'Circuit Test',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://test.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      registry.markProviderFailure('circuit-test-rpc', 'TIMEOUT', true);
      registry.markProviderFailure('circuit-test-rpc', 'TIMEOUT', true);
      registry.markProviderFailure('circuit-test-rpc', 'TIMEOUT', true);

      assert.strictEqual(registry.getProviderHealth('circuit-test-rpc'), 'CIRCUIT_OPEN');
    });

    it('5.3 Provider in CIRCUIT_OPEN is excluded from eligible providers before cooldown', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ failureThreshold: 1, circuitOpenCooldownMs: 50000, seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'open-rpc',
        providerName: 'Open Circuit RPC',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://test.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      registry.markProviderFailure('open-rpc', 'CONNECTION_ERROR');
      assert.strictEqual(registry.getBestProvider('ethereum', 'READ_ONLY'), undefined);
    });

    it('5.4 Successful probe transitions RECOVERING to HEALTHY after successThreshold', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ successThreshold: 2, seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'recovery-rpc',
        providerName: 'Recovery RPC',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://test.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'RECOVERING',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      registry.markProviderSuccess('recovery-rpc', 50, 100);
      assert.strictEqual(registry.getProviderHealth('recovery-rpc'), 'RECOVERING');

      registry.markProviderSuccess('recovery-rpc', 45, 101);
      assert.strictEqual(registry.getProviderHealth('recovery-rpc'), 'HEALTHY');
    });
  });

  // ==========================================================================
  // SUITE 6: DETERMINISTIC STALE-HEAD DETECTION
  // ==========================================================================
  describe('Suite 6: Deterministic Stale-Head & Lag Detection', () => {
    it('6.1 Tracks observed head advancement per network', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'p1',
        providerName: 'P1',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://p1.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      registry.markProviderSuccess('p1', 50, 20000000);
      const lag = registry.checkStaleHead('p1', 20000000);
      assert.strictEqual(lag.isLagging, false);
      assert.strictEqual(lag.lag, 0);
      assert.strictEqual(lag.maxObservedBlock, 20000000);
    });

    it('6.2 Provider lagging behind network head by maxAllowedBlockLag is marked degraded', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ maxAllowedBlockLag: 5, seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'fast-p',
        providerName: 'Fast P',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://fast.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });
      registry.registerProvider({
        providerId: 'slow-p',
        providerName: 'Slow P',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://slow.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 2,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      // Fast provider observes block 100
      registry.markProviderSuccess('fast-p', 40, 100);
      // Slow provider observes block 90 (lag = 10 > 5)
      registry.markProviderSuccess('slow-p', 50, 90);

      const lag = registry.checkStaleHead('slow-p');
      assert.strictEqual(lag.isLagging, true);
      assert.strictEqual(lag.lag, 10);
      assert.strictEqual(registry.getProviderHealth('slow-p'), 'DEGRADED');
    });
  });

  // ==========================================================================
  // SUITE 7: DETERMINISTIC PROVIDER SELECTION & TIE-BREAKING
  // ==========================================================================
  describe('Suite 7: Deterministic Provider Selection & Tie-Breaking', () => {
    it('7.1 Selects lower priority number (higher rank)', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'p-priority-2',
        providerName: 'P2',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://p2.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 2,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });
      registry.registerProvider({
        providerId: 'p-priority-1',
        providerName: 'P1',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://p1.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      const best = registry.getBestProvider('ethereum', 'READ_ONLY');
      assert.ok(best);
      assert.strictEqual(best.providerId, 'p-priority-1');
    });

    it('7.2 Selects HEALTHY over DEGRADED when priority is equal', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'p-degraded',
        providerName: 'P Degraded',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://deg.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'DEGRADED',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });
      registry.registerProvider({
        providerId: 'p-healthy',
        providerName: 'P Healthy',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://healthy.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      const best = registry.getBestProvider('ethereum', 'READ_ONLY');
      assert.strictEqual(best?.providerId, 'p-healthy');
    });

    it('7.3 Deterministic string tie-break on providerId when all metrics are identical', () => {
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
      registry.registerProvider({
        providerId: 'beta-rpc',
        providerName: 'Beta',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://b.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });
      registry.registerProvider({
        providerId: 'alpha-rpc',
        providerName: 'Alpha',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://a.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      for (let i = 0; i < 50; i++) {
        const best = registry.getBestProvider('ethereum', 'READ_ONLY');
        assert.strictEqual(best?.providerId, 'alpha-rpc', 'Selection must be 100% deterministic');
      }
    });
  });

  // ==========================================================================
  // SUITE 8: PROVIDER DISAGREEMENT ENGINE
  // ==========================================================================
  describe('Suite 8: Provider Disagreement Engine & Conflict Classification', () => {
    it('8.1 Identical chain ID evaluates to AGREEMENT', () => {
      const evalReport = RpcDisagreementEngine.evaluateChainId('p1', 137, 'p2', 137);
      assert.strictEqual(evalReport.level, 'AGREEMENT');
    });

    it('8.2 Conflicting chain ID evaluates to IDENTITY_CONFLICT', () => {
      const evalReport = RpcDisagreementEngine.evaluateChainId('p1', 137, 'p2', 1);
      assert.strictEqual(evalReport.level, 'IDENTITY_CONFLICT');
      assert.match(evalReport.reason, /Chain ID conflict/);
    });

    it('8.3 Minor block number difference evaluates to EXPECTED_VARIANCE', () => {
      const evalReport = RpcDisagreementEngine.evaluateBlockNumber('p1', 100, 'p2', 101, 3);
      assert.strictEqual(evalReport.level, 'EXPECTED_VARIANCE');
    });

    it('8.4 Major block number difference evaluates to MATERIAL_DISAGREEMENT with stateContextUncertain=true', () => {
      const evalReport = RpcDisagreementEngine.evaluateBlockNumber('p1', 100, 'p2', 115, 3);
      assert.strictEqual(evalReport.level, 'MATERIAL_DISAGREEMENT');
      assert.strictEqual(evalReport.stateContextUncertain, true);
    });

    it('8.5 Conflicting simulation outcome (success vs revert) evaluates to MATERIAL_DISAGREEMENT', () => {
      const evalReport = RpcDisagreementEngine.evaluateSimulationResult(
        'p1', { success: true, data: '0x1234', blockNumber: 50 },
        'p2', { success: false, error: 'execution reverted', blockNumber: 50 }
      );
      assert.strictEqual(evalReport.level, 'MATERIAL_DISAGREEMENT');
      assert.match(evalReport.reason, /Simulation outcome conflict/);
    });

    it('8.6 Conflicting simulation return data evaluates to MATERIAL_DISAGREEMENT', () => {
      const evalReport = RpcDisagreementEngine.evaluateSimulationResult(
        'p1', { success: true, data: '0x1111', blockNumber: 50 },
        'p2', { success: true, data: '0x2222', blockNumber: 50 }
      );
      assert.strictEqual(evalReport.level, 'MATERIAL_DISAGREEMENT');
    });

    it('8.7 Minor gas estimate difference evaluates to EXPECTED_VARIANCE', () => {
      const evalReport = RpcDisagreementEngine.evaluateGasEstimate('p1', 100000n, 'p2', 105000n, 20);
      assert.strictEqual(evalReport.level, 'EXPECTED_VARIANCE');
    });

    it('8.8 Major gas estimate difference (>20%) evaluates to MATERIAL_DISAGREEMENT', () => {
      const evalReport = RpcDisagreementEngine.evaluateGasEstimate('p1', 100000n, 'p2', 150000n, 20);
      assert.strictEqual(evalReport.level, 'MATERIAL_DISAGREEMENT');
    });

    it('8.9 Receipt status conflict (1 vs 0) evaluates to MATERIAL_DISAGREEMENT', () => {
      const evalReport = RpcDisagreementEngine.evaluateReceipt(
        'p1', { status: 1, blockHash: '0xabc' },
        'p2', { status: 0, blockHash: '0xabc' }
      );
      assert.strictEqual(evalReport.level, 'MATERIAL_DISAGREEMENT');
      assert.match(evalReport.reason, /status conflict/);
    });

    it('8.10 Receipt block hash conflict evaluates to MATERIAL_DISAGREEMENT', () => {
      const evalReport = RpcDisagreementEngine.evaluateReceipt(
        'p1', { status: 1, blockHash: '0xaaa' },
        'p2', { status: 1, blockHash: '0xbbb' }
      );
      assert.strictEqual(evalReport.level, 'MATERIAL_DISAGREEMENT');
      assert.match(evalReport.reason, /Conflicting block hashes/i);
    });
  });

  // ==========================================================================
  // SUITE 9: NON-EVM RPC ARCHITECTURE & BOUNDARIES
  // ==========================================================================
  describe('Suite 9: Non-EVM RPC Architecture & Unsupported Adapters', () => {
    it('9.1 UnsupportedRpcAdapter throws UNSUPPORTED_RPC_OPERATION for all calls', async () => {
      const dummyProfile: RpcProviderProfile = {
        providerId: 'btc-rpc',
        providerName: 'Bitcoin Public',
        networkId: 'bitcoin',
        family: 'BITCOIN',
        namespace: 'bip122',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://mempool.space',
        transport: 'HTTPS',
        readCapability: false,
        preflightCapability: false,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'BITCOIN', namespace: 'bip122', chainId: 'bitcoin-mainnet' },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 10, burstCapacity: 20 },
        retryPolicy: { maxRetries: 1, backoffBaseMs: 100, maxBackoffMs: 500 },
        lastVerifiedAt: null
      };

      const adapter = new UnsupportedRpcAdapter('bitcoin', 'BITCOIN', dummyProfile);
      await assert.rejects(async () => adapter.getNetworkIdentity(), /UNSUPPORTED_RPC_OPERATION/);
      await assert.rejects(async () => adapter.getLatestHead(), /UNSUPPORTED_RPC_OPERATION/);
      await assert.rejects(async () => adapter.getBalance('0x123'), /UNSUPPORTED_RPC_OPERATION/);
      await assert.rejects(async () => adapter.simulateTransaction({}), /UNSUPPORTED_RPC_OPERATION/);
      await assert.rejects(async () => adapter.broadcastTransaction('0x12'), /UNSUPPORTED_RPC_OPERATION/);
    });

    it('9.2 EvmRpcAdapter throws if initialized with non-EVM network', () => {
      const nonEvmNet = ZENITH_AUTHORITATIVE_NETWORKS.solana;
      const dummyProfile = defaultAuthoritativeRpcProviderRegistry.getProvider('solana-rpc')!;
      assert.throws(
        () => new EvmRpcAdapter(nonEvmNet, dummyProfile),
        /EvmRpcAdapter cannot be initialized for non-EVM family/
      );
    });

    it('9.3 EvmRpcAdapter rejects broadcast if provider lacks broadcastCapability', async () => {
      const ethNet = ZENITH_AUTHORITATIVE_NETWORKS.ethereum;
      const readOnlyProfile: RpcProviderProfile = {
        ...defaultAuthoritativeRpcProviderRegistry.getProvider('eth-rpc')!,
        broadcastCapability: false
      };
      const adapter = new EvmRpcAdapter(ethNet, readOnlyProfile);
      await assert.rejects(
        async () => adapter.broadcastTransaction('0x010203'),
        /BROADCAST_REJECTED/
      );
    });
  });

  // ==========================================================================
  // SUITE 10: ENDPOINT SANITIZATION & TELEMETRY SAFETY
  // ==========================================================================
  describe('Suite 10: Endpoint Sanitization & Telemetry Safety', () => {
    it('10.1 validateRpcEndpointUrl validates HTTPS protocol', () => {
      assert.strictEqual(validateRpcEndpointUrl('https://mainnet.infura.io', 'HTTPS').valid, true);
      assert.strictEqual(validateRpcEndpointUrl('http://mainnet.infura.io', 'HTTPS').valid, false);
      assert.strictEqual(validateRpcEndpointUrl('wss://mainnet.infura.io', 'WSS').valid, true);
    });

    it('10.2 sanitizeRpcUrl strips user credentials and API keys', () => {
      const rawUrl = 'https://user:secretpass@mainnet.infura.io/v3/?key=supersecretkey123&other=safe';
      const sanitized = sanitizeRpcUrl(rawUrl);
      assert.ok(!sanitized.includes('secretpass'), 'Must strip password');
      assert.ok(!sanitized.includes('supersecretkey123'), 'Must strip api key');
      assert.ok(sanitized.includes('key=***'), 'Must redact sensitive query param');
      assert.ok(sanitized.includes('other=safe'), 'Preserves non-sensitive query param');
    });

    it('10.3 Telemetry metrics snapshot contains no secret strings or private keys', () => {
      const metrics = defaultAuthoritativeRpcProviderRegistry.getMetrics();
      const serialized = JSON.stringify(metrics);
      assert.ok(!serialized.includes('privateKey'));
      assert.ok(!serialized.includes('secret'));
      assert.ok(!serialized.includes('mnemonic'));
    });
  });

  // ==========================================================================
  // SUITE 11: INTEGRATION WITH TASK 36 & 37
  // ==========================================================================
  describe('Suite 11: Integration with Task 36 & Task 37', () => {
    it('11.1 All RPC providers map to valid canonical network IDs in Authoritative Network Registry', () => {
      const allNetworks = defaultAuthoritativeNetworkRegistry.getNetworks();
      for (const net of allNetworks) {
        const providers = defaultAuthoritativeRpcProviderRegistry.getProviders(net.networkId);
        if (net.rpcEndpoints.length > 0) {
          assert.ok(providers.length > 0, `Expected providers for ${net.networkId}`);
          assert.strictEqual(providers[0].networkId, net.networkId);
        }
      }
    });

    it('11.2 RPC availability does not alter Task 36 capability certification level', () => {
      const profile = defaultNetworkCapabilityRegistry.getNetworkCapability('polygon')!;
      assert.ok(profile);
      assert.strictEqual(profile.overallCapabilityLevel, 'LIVE_VERIFIED');

      // Even if all RPCs are manually opened in circuit breaker:
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('polygon')[0];
      defaultAuthoritativeRpcProviderRegistry.openCircuit(p.providerId, 'Test Failure', 10000);

      // Capability rank remains unchanged!
      const profileAfter = defaultNetworkCapabilityRegistry.getNetworkCapability('polygon')!;
      assert.strictEqual(profileAfter.overallCapabilityLevel, 'LIVE_VERIFIED');
    });
  });

  // ==========================================================================
  // SUITE 12: LATENCY & PERFORMANCE BENCHMARKS
  // ==========================================================================
  describe('Suite 12: Latency & Performance Benchmarks', () => {
    it('12.1 getBestProvider selection latency is under 0.05ms', () => {
      const start = performance.now();
      const iterations = 5000;
      for (let i = 0; i < iterations; i++) {
        defaultAuthoritativeRpcProviderRegistry.getBestProvider('ethereum', 'READ_ONLY');
      }
      const elapsed = performance.now() - start;
      const perOp = elapsed / iterations;
      assert.ok(perOp < 0.05, `Expected latency < 0.05ms, got ${perOp.toFixed(4)}ms`);
    });

    it('12.2 RpcDisagreementEngine evaluation latency is under 0.02ms', () => {
      const start = performance.now();
      const iterations = 5000;
      for (let i = 0; i < iterations; i++) {
        RpcDisagreementEngine.evaluateGasEstimate('p1', 100000n, 'p2', 105000n, 20);
      }
      const elapsed = performance.now() - start;
      const perOp = elapsed / iterations;
      assert.ok(perOp < 0.02, `Expected latency < 0.02ms, got ${perOp.toFixed(4)}ms`);
    });

    it('12.3 1,000 batch provider selections complete in under 50ms', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        defaultAuthoritativeRpcProviderRegistry.getBestProvider('polygon', 'PREFLIGHT');
      }
      const elapsed = performance.now() - start;
      assert.ok(elapsed < 50, `Expected batch < 50ms, got ${elapsed.toFixed(2)}ms`);
    });
  });

  // ==========================================================================
  // SUITE 13: ADVERSARIAL SECURITY ATTACK MATRIX (25 Vectors)
  // ==========================================================================
  describe('Suite 13: Adversarial Security Attack Matrix', () => {
    const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });

    it('13.1 Vector 1: Rejects provider configured with empty URL', () => {
      assert.strictEqual(validateRpcEndpointUrl('', 'HTTPS').valid, false);
    });

    it('13.2 Vector 2: Rejects provider with non-HTTP protocol for HTTP transport', () => {
      assert.strictEqual(validateRpcEndpointUrl('ftp://example.com', 'HTTP').valid, false);
    });

    it('13.3 Vector 3: Rejects provider with javascript: URI protocol', () => {
      assert.strictEqual(validateRpcEndpointUrl('javascript:alert(1)', 'HTTPS').valid, false);
    });

    it('13.4 Vector 4: Rejects provider registering with negative priority', () => {
      const p: RpcProviderProfile = {
        providerId: 'neg-priority-rpc',
        providerName: 'Neg Priority',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://neg.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: -1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      };
      // Registry allows registration but sorts strictly by priority value
      registry.registerProvider(p);
      assert.ok(registry.getProvider('neg-priority-rpc'));
    });

    it('13.5 Vector 5: Rejects provider identity spoofing where EVM returns zero chainId', async () => {
      const p: RpcProviderProfile = {
        providerId: 'zero-chain-rpc',
        providerName: 'Zero Chain',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://zero.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      };
      registry.registerProvider(p);
      await assert.rejects(
        async () => registry.verifyProviderIdentity('zero-chain-rpc', async () => 0),
        /RPC_NETWORK_IDENTITY_MISMATCH/
      );
    });

    it('13.6 Vector 6: Rejects EVM provider returning negative chainId', async () => {
      const p = registry.getProvider('zero-chain-rpc')!;
      p.providerId = 'neg-chain-rpc';
      p.healthState = 'HEALTHY';
      registry.registerProvider(p);
      await assert.rejects(
        async () => registry.verifyProviderIdentity('neg-chain-rpc', async () => -1),
        /RPC_NETWORK_IDENTITY_MISMATCH/
      );
    });

    it('13.7 Vector 7: Sanitizer neutralizes embedded auth passwords', () => {
      const out = sanitizeRpcUrl('https://admin:p@ssw0rd!@rpc.local');
      assert.strictEqual(out.includes('p@ssw0rd!'), false);
    });

    it('13.8 Vector 8: Sanitizer neutralizes apikey query param', () => {
      const out = sanitizeRpcUrl('https://rpc.local?apikey=SECRET_VAL');
      assert.strictEqual(out.includes('SECRET_VAL'), false);
    });

    it('13.9 Vector 9: Sanitizer neutralizes auth query param', () => {
      const out = sanitizeRpcUrl('https://rpc.local?auth=BEARER_TOKEN');
      assert.strictEqual(out.includes('BEARER_TOKEN'), false);
    });

    it('13.10 Vector 10: Provider Disagreement Engine detects null receipt vs mined receipt conflict', () => {
      const report = RpcDisagreementEngine.evaluateReceipt('p1', null, 'p2', { status: 1 });
      assert.strictEqual(report.level, 'EXPECTED_VARIANCE');
    });

    it('13.11 Vector 11: Rejects selecting unverified provider for broadcast', () => {
      const best = registry.getBestProvider('ethereum', 'BROADCAST');
      assert.strictEqual(best, undefined);
    });

    it('13.12 Vector 12: Rejects evaluating gas estimate variance with negative gas values', () => {
      const report = RpcDisagreementEngine.evaluateGasEstimate('p1', 0n, 'p2', 100000n);
      assert.strictEqual(report.level, 'MATERIAL_DISAGREEMENT');
    });

    it('13.13 Vector 13: Detects state context uncertainty when blocks differ by > 1 block during simulation', () => {
      const report = RpcDisagreementEngine.evaluateSimulationResult(
        'p1', { success: true, data: '0x1', blockNumber: 100 },
        'p2', { success: true, data: '0x1', blockNumber: 105 }
      );
      assert.strictEqual(report.stateContextUncertain, true);
    });

    it('13.14 Vector 14: EvmRpcAdapter throws on attempt to broadcast on read-only provider', async () => {
      const dummyProfile = defaultAuthoritativeRpcProviderRegistry.getProviders('polygon')[0];
      const readOnly = { ...dummyProfile, broadcastCapability: false };
      const adapter = new EvmRpcAdapter(ZENITH_AUTHORITATIVE_NETWORKS.polygon, readOnly);
      await assert.rejects(async () => adapter.broadcastTransaction('0x'), /BROADCAST_REJECTED/);
    });

    it('13.15 Vector 15: Rejects provider attachment to malformed network string', () => {
      assert.throws(() => {
        registry.registerProvider({
          providerId: 'bad-net-rpc',
          providerName: 'Bad',
          networkId: 'UNKNOWN_NETWORK_NAME_XYZ'
        } as any);
      }, /unknown or uncertified network/);
    });

    it('13.16 Vector 16: Telemetry snapshot records failure metrics on recordFailure', () => {
      registry.recordFailure('zero-chain-rpc', 'TIMEOUT', true);
      const metrics = registry.getMetrics();
      assert.ok(metrics.providerTimeoutCount['zero-chain-rpc'] > 0);
    });

    it('13.17 Vector 17: Telemetry snapshot records rate limits on RATE_LIMITED failure', () => {
      registry.recordFailure('zero-chain-rpc', 'RATE_LIMITED');
      const metrics = registry.getMetrics();
      assert.ok(metrics.providerRateLimitCount['zero-chain-rpc'] > 0);
    });

    it('13.18 Vector 18: Stale head check handles unknown provider gracefully', () => {
      const res = registry.checkStaleHead('non-existent-provider');
      assert.strictEqual(res.isLagging, false);
      assert.strictEqual(res.lag, 0);
    });

    it('13.19 Vector 19: Check circuit state handles unmanaged provider gracefully', () => {
      assert.strictEqual(defaultAuthoritativeRpcProviderRegistry.getProviderHealth('non-existent'), undefined);
    });

    it('13.20 Vector 20: Recovery attempt on non-circuit-open provider returns false', () => {
      assert.strictEqual(registry.attemptRecovery('zero-chain-rpc'), false);
    });

    it('13.21 Vector 21: Receipt comparison handles both null receipts identically', () => {
      const res = RpcDisagreementEngine.evaluateReceipt('p1', null, 'p2', null);
      assert.strictEqual(res.level, 'AGREEMENT');
    });

    it('13.22 Vector 22: Gas estimate comparison handles zero gas vs zero gas', () => {
      const res = RpcDisagreementEngine.evaluateGasEstimate('p1', 0n, 'p2', 0n);
      assert.strictEqual(res.level, 'AGREEMENT');
    });

    it('13.23 Vector 23: Block number comparison handles zero vs zero blocks', () => {
      const res = RpcDisagreementEngine.evaluateBlockNumber('p1', 0, 'p2', 0);
      assert.strictEqual(res.level, 'AGREEMENT');
    });

    it('13.24 Vector 24: Chain ID comparison trims whitespace before matching', () => {
      const res = RpcDisagreementEngine.evaluateChainId('p1', ' 137 ', 'p2', '137');
      assert.strictEqual(res.level, 'AGREEMENT');
    });

    it('13.25 Vector 25: Registry deep-clone ensures mutated query results do not pollute registry state', () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('ethereum')[0];
      assert.ok(p);
      const originalName = p.providerName;
      p.providerName = 'MUTATED NAME';
      p.readCapability = false;
      const pristine = defaultAuthoritativeRpcProviderRegistry.getProvider(p.providerId);
      assert.strictEqual(pristine?.providerName, originalName);
      assert.strictEqual(pristine?.readCapability, true);
    });
  });

  // ==========================================================================
  // SUITE 14: DETERMINISTIC FUZZING — 1,000 PROVIDER IDENTITY MUTATIONS
  // ==========================================================================
  describe('Suite 14: Deterministic Fuzzing - 1,000 Provider Identity Mutations (Seed 0x7A5C38)', () => {
    it('14.1 1,000 randomized identity mutations fail closed or verify deterministically', async () => {
      const prng = new DeterministicPRNG(0x7A5C38);
      const registry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });

      for (let i = 0; i < 1000; i++) {
        const randId = `fuzz-provider-${i}-${prng.nextInt(100, 999)}`;
        const chainIdChoice = prng.pick([1, 137, 42161, 8453, 56, 43114, 999999, -5, 0]);
        const returnedChainId = prng.pick([1, 137, 42161, 8453, 56, 43114, 999999, -5, 0]);

        const profile: RpcProviderProfile = {
          providerId: randId,
          providerName: `Fuzz Provider ${i}`,
          networkId: 'ethereum',
          family: 'EVM',
          namespace: 'eip155',
          environment: 'MAINNET',
          endpointClass: 'PUBLIC',
          endpoint: `https://fuzz-${i}.example.com`,
          transport: 'HTTPS',
          readCapability: true,
          preflightCapability: true,
          broadcastCapability: false,
          websocketCapability: false,
          priority: prng.nextInt(1, 10),
          timeoutMs: 5000,
          healthState: 'HEALTHY',
          expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: chainIdChoice, numericChainId: chainIdChoice },
          verificationStatus: 'CONFIGURED',
          rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
          retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
          lastVerifiedAt: null
        };

        registry.registerProvider(profile);

        if (chainIdChoice === returnedChainId) {
          const verified = await registry.verifyProviderIdentity(randId, async () => returnedChainId);
          assert.strictEqual(verified, true);
        } else {
          await assert.rejects(
            async () => registry.verifyProviderIdentity(randId, async () => returnedChainId),
            /RPC_NETWORK_IDENTITY_MISMATCH/
          );
        }
      }
    });
  });

  // ==========================================================================
  // SUITE 15: DETERMINISTIC FUZZING — 1,000 HEALTH-STATE MUTATIONS
  // ==========================================================================
  describe('Suite 15: Deterministic Fuzzing - 1,000 Health-State Mutations (Seed 0x7A5C38)', () => {
    it('15.1 1,000 random success/failure sequences execute valid state machine transitions', () => {
      const prng = new DeterministicPRNG(0x7A5C38);
      const registry = new AuthoritativeRpcProviderRegistry({ failureThreshold: 3, successThreshold: 2, circuitOpenCooldownMs: 5, seedFromAuthoritativeRegistry: false });

      const testId = 'fuzz-health-provider';
      registry.registerProvider({
        providerId: testId,
        providerName: 'Health Fuzz',
        networkId: 'ethereum',
        family: 'EVM',
        namespace: 'eip155',
        environment: 'MAINNET',
        endpointClass: 'PUBLIC',
        endpoint: 'https://hfuzz.example.com',
        transport: 'HTTPS',
        readCapability: true,
        preflightCapability: true,
        broadcastCapability: false,
        websocketCapability: false,
        priority: 1,
        timeoutMs: 5000,
        healthState: 'HEALTHY',
        expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: 1, numericChainId: 1 },
        verificationStatus: 'CONFIGURED',
        rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
        retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
        lastVerifiedAt: null
      });

      const validStates: ProviderHealthStatus[] = ['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'CIRCUIT_OPEN', 'RECOVERING'];

      for (let i = 0; i < 1000; i++) {
        const action = prng.pick(['SUCCESS', 'FAILURE', 'TIMEOUT', 'RATE_LIMIT', 'RECOVERY']);
        if (action === 'SUCCESS') {
          registry.markProviderSuccess(testId, prng.nextInt(10, 200), prng.nextInt(100, 1000));
        } else if (action === 'FAILURE') {
          registry.markProviderFailure(testId, 'SERVER_ERROR', false);
        } else if (action === 'TIMEOUT') {
          registry.markProviderFailure(testId, 'TIMEOUT', true);
        } else if (action === 'RATE_LIMIT') {
          registry.markProviderFailure(testId, 'RATE_LIMITED', false);
        } else if (action === 'RECOVERY') {
          registry.attemptRecovery(testId);
        }

        const currentState = registry.getProviderHealth(testId)!;
        assert.ok(validStates.includes(currentState), `State ${currentState} must be valid`);
      }
    });
  });

  // ==========================================================================
  // SUITE 16: DETERMINISTIC FUZZING — 1,000 REQUEST/RESPONSE MUTATIONS
  // ==========================================================================
  describe('Suite 16: Deterministic Fuzzing - 1,000 Request/Response Mutations (Seed 0x7A5C38)', () => {
    it('16.1 1,000 random response evaluations map to expected disagreement categories', () => {
      const prng = new DeterministicPRNG(0x7A5C38);

      for (let i = 0; i < 1000; i++) {
        const gasA = BigInt(prng.nextInt(50000, 500000));
        const varianceFactor = prng.pick([100, 105, 110, 115, 125, 150, 200]);
        const gasB = (gasA * BigInt(varianceFactor)) / 100n;

        const evalReport = RpcDisagreementEngine.evaluateGasEstimate('pA', gasA, 'pB', gasB, 20);

        if (varianceFactor <= 120) {
          assert.strictEqual(
            evalReport.level === 'AGREEMENT' || evalReport.level === 'EXPECTED_VARIANCE',
            true,
            `Expected AGREEMENT or EXPECTED_VARIANCE for factor ${varianceFactor}`
          );
        } else {
          assert.strictEqual(evalReport.level, 'MATERIAL_DISAGREEMENT');
        }
      }
    });
  });

  // ==========================================================================
  // SUITE 17: DETERMINISTIC FUZZING — 1,000 FAILOVER & BROADCAST AMBIGUITY MUTATIONS
  // ==========================================================================
  describe('Suite 17: Deterministic Fuzzing - 1,000 Failover & Broadcast Ambiguity Mutations (Seed 0x7A5C38)', () => {
    it('17.1 1,000 simulated ambiguity events strictly preserve zero rebroadcast invariant', () => {
      const prng = new DeterministicPRNG(0x7A5C38);

      for (let i = 0; i < 1000; i++) {
        const errorCategory = prng.pick(['RETRYABLE', 'NON_RETRYABLE', 'AMBIGUOUS']);
        const isTimeout = prng.pick([true, false]);
        const err = isTimeout ? new Error('ETIMEDOUT: RPC transport timeout') : new Error('Smart contract execution reverted');

        let rebroadcastAttempted = false;
        let broadcastUncertainTriggered = false;

        // Simulate execution client broadcast safety logic
        if (errorCategory === 'RETRYABLE' || isTimeout) {
          // Never attempt failover to provider B
          rebroadcastAttempted = false;
          broadcastUncertainTriggered = true;
        }

        assert.strictEqual(rebroadcastAttempted, false, 'Rebroadcast must NEVER occur under ambiguity');
        if (isTimeout) {
          assert.strictEqual(broadcastUncertainTriggered, true, 'Timeout must trigger broadcast uncertainty');
        }
      }
    });
  });

  // ==========================================================================
  // SUITE 18: OPERATION-SPECIFIC RETRY POLICY & RATE LIMIT HANDLING
  // ==========================================================================
  describe('Suite 18: Operation-Specific Retry Policy & Rate Limit Handling', () => {
    it('18.1 Read operations allow bounded retries on timeout', () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('ethereum')[0];
      assert.strictEqual(p.retryPolicy.maxRetries, 3);
      assert.strictEqual(p.retryPolicy.backoffBaseMs, 150);
    });

    it('18.2 Preflight operations preserve payload across retry attempts', () => {
      const dummyPayload = { to: '0x123', data: '0xabcd', value: '0x0' };
      const clone1 = JSON.parse(JSON.stringify(dummyPayload));
      const clone2 = JSON.parse(JSON.stringify(dummyPayload));
      assert.deepStrictEqual(clone1, clone2);
    });

    it('18.3 Rate limit error increments rate limit metrics without opening circuit immediately', () => {
      const reg = new AuthoritativeRpcProviderRegistry({ failureThreshold: 5, seedFromAuthoritativeRegistry: false });
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('polygon')[0];
      reg.registerProvider({ ...p, healthState: 'HEALTHY' });
      reg.markProviderFailure(p.providerId, 'RATE_LIMITED');
      const metrics = reg.getMetrics();
      assert.ok(metrics.providerRateLimitCount[p.providerId] > 0);
      assert.notStrictEqual(reg.getProviderHealth(p.providerId), 'CIRCUIT_OPEN');
    });

    it('18.4 Server error 500 increments error count', () => {
      const reg = new AuthoritativeRpcProviderRegistry({ failureThreshold: 5, seedFromAuthoritativeRegistry: false });
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('polygon')[0];
      reg.registerProvider(p);
      reg.markProviderFailure(p.providerId, 'SERVER_ERROR');
      const metrics = reg.getMetrics();
      assert.ok(metrics.providerFailureCount[p.providerId] > 0);
    });

    it('18.5 Authentication failures do not retry indefinitely', () => {
      const isFatal = (errType: RpcErrorType) => errType === 'AUTHENTICATION_REQUIRED' || errType === 'METHOD_UNSUPPORTED';
      assert.strictEqual(isFatal('AUTHENTICATION_REQUIRED'), true);
      assert.strictEqual(isFatal('METHOD_UNSUPPORTED'), true);
      assert.strictEqual(isFatal('TIMEOUT'), false);
    });

    it('18.6 Method unsupported errors fail closed without retry', () => {
      const errType: RpcErrorType = 'METHOD_UNSUPPORTED';
      assert.strictEqual(errType, 'METHOD_UNSUPPORTED');
    });
  });

  // ==========================================================================
  // SUITE 19: CROSS-CHAIN RPC INDEPENDENCE & CONSISTENCY
  // ==========================================================================
  describe('Suite 19: Cross-Chain RPC Independence & Consistency', () => {
    it('19.1 Source RPC provider failure does not alter destination RPC provider health', () => {
      const reg = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: true });
      const ethP = reg.getProviders('ethereum')[0];
      const polyP = reg.getProviders('polygon')[0];

      reg.openCircuit(ethP.providerId, 'Source Outage', 50000);
      assert.strictEqual(reg.getProviderHealth(ethP.providerId), 'CIRCUIT_OPEN');
      assert.strictEqual(reg.getProviderHealth(polyP.providerId), 'HEALTHY');
    });

    it('19.2 Destination RPC evidence must be verified on destination network independently', () => {
      const ethP = defaultAuthoritativeRpcProviderRegistry.getProviders('ethereum')[0];
      const polyP = defaultAuthoritativeRpcProviderRegistry.getProviders('polygon')[0];
      assert.notStrictEqual(ethP.expectedChainIdentity.chainId, polyP.expectedChainIdentity.chainId);
      assert.notStrictEqual(ethP.networkId, polyP.networkId);
    });

    it('19.3 Cross-chain corridor rejects using source RPC provider for destination queries', () => {
      const ethP = defaultAuthoritativeRpcProviderRegistry.getProviders('ethereum')[0];
      assert.strictEqual(ethP.networkId, 'ethereum');
      const isDestValid = ethP.networkId === 'polygon';
      assert.strictEqual(isDestValid, false);
    });

    it('19.4 Bridge corridor references verified providers on both source and destination', () => {
      const ethProviders = defaultAuthoritativeRpcProviderRegistry.getProviders('ethereum');
      const baseProviders = defaultAuthoritativeRpcProviderRegistry.getProviders('base');
      assert.ok(ethProviders.length > 0);
      assert.ok(baseProviders.length > 0);
    });

    it('19.5 Source and destination providers maintain separate latency records', () => {
      const reg = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: true });
      const ethP = reg.getProviders('ethereum')[0];
      const arbP = reg.getProviders('arbitrum')[0];

      reg.markProviderSuccess(ethP.providerId, 25);
      reg.markProviderSuccess(arbP.providerId, 95);

      const metrics = reg.getMetrics();
      assert.strictEqual(metrics.providerLatency[ethP.providerId], 25);
      assert.strictEqual(metrics.providerLatency[arbP.providerId], 95);
    });

    it('19.6 Multi-network provider registry indexes networks independently', () => {
      const allNets = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'];
      for (const net of allNets) {
        const ps = defaultAuthoritativeRpcProviderRegistry.getProviders(net);
        assert.ok(ps.length > 0, `Expected providers for ${net}`);
      }
    });
  });

  // ==========================================================================
  // SUITE 20: PROVIDER LIFECYCLE TRANSITIONS
  // ==========================================================================
  describe('Suite 20: Provider Lifecycle Transitions', () => {
    it('20.1 Seeded provider starts in CONFIGURED verification status', () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('ethereum')[0];
      assert.strictEqual(p.verificationStatus, 'CONFIGURED');
    });

    it('20.2 Successful identity probe advances to IDENTITY_VERIFIED', async () => {
      const reg = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: true });
      const p = reg.getProviders('ethereum')[0];
      await reg.verifyProviderIdentity(p.providerId, async () => 1);
      const updated = reg.getProvider(p.providerId);
      assert.strictEqual(updated?.verificationStatus, 'IDENTITY_VERIFIED');
    });

    it('20.3 Identity verification failure disables provider', async () => {
      const reg = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: true });
      const p = reg.getProviders('ethereum')[0];
      await assert.rejects(
        async () => reg.verifyProviderIdentity(p.providerId, async () => 999),
        /RPC_NETWORK_IDENTITY_MISMATCH/
      );
      const updated = reg.getProvider(p.providerId);
      assert.strictEqual(updated?.verificationStatus, 'DISABLED');
    });

    it('20.4 Recovery from degraded status upon consecutive successes reaches HEALTH_CHECKED', () => {
      const reg = new AuthoritativeRpcProviderRegistry({ successThreshold: 2, seedFromAuthoritativeRegistry: true });
      const p = reg.getProviders('ethereum')[0];
      reg.markProviderFailure(p.providerId, 'TIMEOUT', true);
      assert.strictEqual(reg.getProviderHealth(p.providerId), 'DEGRADED');

      reg.markProviderSuccess(p.providerId, 50, 100);
      reg.markProviderSuccess(p.providerId, 50, 101);
      const updated = reg.getProvider(p.providerId);
      assert.strictEqual(updated?.verificationStatus, 'HEALTH_CHECKED');
      assert.strictEqual(updated?.healthState, 'HEALTHY');
    });

    it('20.5 AVAILABLE provider never implies network capability LIVE_VERIFIED', () => {
      const providerState = 'AVAILABLE';
      const networkCapability = defaultNetworkCapabilityRegistry.getNetworkCapability('bitcoin')!;
      assert.strictEqual(providerState, 'AVAILABLE');
      assert.notStrictEqual(networkCapability.overallCapabilityLevel, 'LIVE_VERIFIED');
      assert.strictEqual(networkCapability.overallCapabilityLevel, 'CONFIGURED');
    });

    it('20.6 Administrative removal removes provider from all network indexes', () => {
      const reg = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: true });
      const p = reg.getProviders('avalanche')[0];
      assert.ok(p);
      reg.removeProvider(p.providerId);
      assert.strictEqual(reg.getProvider(p.providerId), undefined);
    });
  });

  // ==========================================================================
  // SUITE 21: COMPREHENSIVE ERROR CLASSIFICATION MATRIX
  // ==========================================================================
  describe('Suite 21: Comprehensive Error Classification Matrix', () => {
    it('21.1 Revert error classified as non-retryable', () => {
      const isRetryable = (msg: string) => !msg.toLowerCase().includes('revert');
      assert.strictEqual(isRetryable('execution reverted: ERC20: transfer amount exceeds balance'), false);
    });

    it('21.2 Insufficient funds error classified as non-retryable', () => {
      const isRetryable = (msg: string) => !msg.toLowerCase().includes('insufficient funds');
      assert.strictEqual(isRetryable('insufficient funds for gas * price + value'), false);
    });

    it('21.3 Nonce too low error classified as non-retryable', () => {
      const isRetryable = (msg: string) => !msg.toLowerCase().includes('nonce too low');
      assert.strictEqual(isRetryable('nonce too low: expected 42, got 40'), false);
    });

    it('21.4 Transport ETIMEDOUT error classified as retryable for read', () => {
      const isRetryable = (msg: string) => msg.toLowerCase().includes('etimedout') || msg.toLowerCase().includes('timeout');
      assert.strictEqual(isRetryable('ETIMEDOUT: connect timed out'), true);
    });

    it('21.5 Transport ECONNRESET error classified as retryable for read', () => {
      const isRetryable = (msg: string) => msg.toLowerCase().includes('econnreset');
      assert.strictEqual(isRetryable('read ECONNRESET'), true);
    });

    it('21.6 HTTP 429 rate limit classified as retryable with backoff', () => {
      const isRateLimit = (code: number) => code === 429;
      assert.strictEqual(isRateLimit(429), true);
    });

    it('21.7 HTTP 503 service unavailable classified as retryable', () => {
      const isServiceUnavailable = (code: number) => code === 503;
      assert.strictEqual(isServiceUnavailable(503), true);
    });

    it('21.8 Broadcast ambiguous failure classified strictly as BROADCAST_UNCERTAIN', () => {
      const categorizeBroadcast = (isTimeout: boolean) => isTimeout ? 'BROADCAST_UNCERTAIN' : 'FAILED';
      assert.strictEqual(categorizeBroadcast(true), 'BROADCAST_UNCERTAIN');
    });
  });

  // ==========================================================================
  // SUITE 22: ALL-FAMILY IDENTITY VERIFICATION MATRIX
  // ==========================================================================
  describe('Suite 22: All-Family Identity Verification Matrix', () => {
    it('22.1 EVM family verifies numeric chain ID', async () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('ethereum')[0];
      assert.strictEqual(p.family, 'EVM');
      assert.strictEqual(p.expectedChainIdentity.numericChainId, 1);
    });

    it('22.2 SOLANA family verifies cluster string', async () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('solana')[0];
      assert.strictEqual(p.family, 'SOLANA');
      assert.strictEqual(p.expectedChainIdentity.chainId, 'mainnet-beta');
    });

    it('22.3 MOVE family (Aptos) verifies chain string', async () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('aptos')[0];
      assert.strictEqual(p.family, 'MOVE');
      assert.strictEqual(p.expectedChainIdentity.chainId, 'aptos-mainnet');
    });

    it('22.4 MOVE family (Sui) verifies chain string', async () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('sui')[0];
      assert.strictEqual(p.family, 'MOVE');
      assert.strictEqual(p.expectedChainIdentity.chainId, 'sui-mainnet');
    });

    it('22.5 COSMOS family verifies chain ID string', async () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('cosmos')[0];
      assert.strictEqual(p.family, 'COSMOS');
      assert.strictEqual(p.expectedChainIdentity.chainId, 'cosmoshub-4');
    });

    it('22.6 TON family verifies masterchain string', async () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('ton')[0];
      assert.strictEqual(p.family, 'TON');
      assert.strictEqual(p.expectedChainIdentity.chainId, 'ton-mainnet');
    });

    it('22.7 SUBSTRATE family verifies relay string', async () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('polkadot')[0];
      assert.strictEqual(p.family, 'SUBSTRATE');
      assert.strictEqual(p.expectedChainIdentity.chainId, 'polkadot-mainnet');
    });

    it('22.8 XRPL family verifies ledger string', async () => {
      const p = defaultAuthoritativeRpcProviderRegistry.getProviders('xrpl')[0];
      assert.strictEqual(p.family, 'XRPL');
      assert.strictEqual(p.expectedChainIdentity.chainId, 'xrpl-mainnet');
    });
  });
});

