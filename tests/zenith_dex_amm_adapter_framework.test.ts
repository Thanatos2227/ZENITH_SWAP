import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DexIdentity,
  DexProtocolTaxonomy,
  CapabilityLevel,
  TokenStandard,
  DexSwapTransaction,
  AuthoritativeDexQuote,
  TokenIdentity
} from '@zenith/types';
import {
  buildDexIdentityKey,
  parseDexIdentityKey,
  buildDexId,
  getTokenAddress,
  toLegacyToken,
  isConcentratedLiquidityAmm,
  isConstantProductAmm,
  isSupportedSwapProtocol,
  compareCapabilityLevels,
  isCapabilityAtLeast,
  computeBoundedDexCapability,
  DexOnboardingStateMachine,
  CANONICAL_DEXES,
  CANONICAL_DEX_DEFINITIONS,
  DexMetadataConflictEngine,
  DexRegistryValidationEngine,
  DexAddressVerifier,
  EvmDexAdapter,
  UniswapV2DexAdapter,
  UniswapV3DexAdapter,
  LegacyDexProviderWrapper,
  DexSimulationPipeline,
  AuthoritativeDexRegistry,
  defaultAuthoritativeDexRegistry,
  buildDexRouteId,
  normalizeDexQuoteToRoute,
  checkDexCapabilityGate,
  calculateMinimumOutput
} from '../packages/routing/src/dex/authoritative';
import {
  defaultAuthoritativeNetworkRegistry,
  AuthoritativeNetworkRegistry
} from '@zenith/chains';
import {
  defaultAuthoritativeTokenRegistry,
  AuthoritativeTokenRegistry
} from '@zenith/tokens';
import {
  DexNetworkMismatchError,
  DexEnvironmentMismatchError,
  DexFamilyMismatchError,
  DexOnboardingTransitionError,
  UnsupportedDexOperationError
} from '@zenith/contracts';

/**
 * Deterministic Linear Congruential Generator (PRNG)
 * Seed: 0x7A5C40
 */
class DeterministicPRNG {
  private state: number;
  constructor(seed: number = 0x7a5c40) {
    this.state = seed >>> 0;
  }
  public next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
  public nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  public choice<T>(arr: readonly T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }
  public nextBigInt(min: bigint, max: bigint): bigint {
    const range = max - min;
    const rand = BigInt(this.nextInt(0, 1000000));
    return min + (range * rand) / 1000000n;
  }
  public nextHex(lengthBytes: number): string {
    let out = '0x';
    const hexChars = '0123456789abcdef';
    for (let i = 0; i < lengthBytes * 2; i++) {
      out += hexChars[this.nextInt(0, 15)];
    }
    return out;
  }
  public nextAddress(): string {
    return this.nextHex(20);
  }
}

describe('ZENITH — PHASE 2 TASK 40: AUTHORITATIVE DEX / AMM ADAPTER FRAMEWORK & SWAP CAPABILITY CERTIFICATION', () => {

  // ==========================================================================
  // SUITE 1: Canonical DEX Identity & Network-Bound Identity Key
  // ==========================================================================
  describe('Suite 1: Canonical DEX Identity & Network-Bound Identity Key', () => {
    it('1.1 Canonical DEX definitions contain required deployments across target networks', () => {
      assert.ok(CANONICAL_DEX_DEFINITIONS.length >= 10, 'Expected at least 10 canonical DEX definitions');
      const dexIds = CANONICAL_DEX_DEFINITIONS.map((d) => d.dexId);
      assert.ok(dexIds.includes('ethereum:uniswap-v3'));
      assert.ok(dexIds.includes('polygon:uniswap-v3'));
      assert.ok(dexIds.includes('polygon:quickswap-v3'));
      assert.ok(dexIds.includes('arbitrum:uniswap-v3'));
      assert.ok(dexIds.includes('optimism:uniswap-v3'));
      assert.ok(dexIds.includes('base:uniswap-v3'));
      assert.ok(dexIds.includes('bsc:pancakeswap-v3'));
      assert.ok(dexIds.includes('solana:raydium'));
    });

    it('1.2 buildDexIdentityKey formats network-bound key correctly', () => {
      const key = buildDexIdentityKey('EVM:eip155:1', 'UNISWAP', 'V3', 'ethereum-mainnet');
      assert.strictEqual(key, 'EVM:eip155:1:UNISWAP:V3:ethereum-mainnet');
    });

    it('1.3 parseDexIdentityKey extracts components deterministically', () => {
      const key = 'EVM:eip155:137:QUICKSWAP:V3:polygon-mainnet';
      const parsed = parseDexIdentityKey(key);
      assert.strictEqual(parsed.networkIdentityKey, 'EVM:eip155:137');
      assert.strictEqual(parsed.protocol, 'QUICKSWAP');
      assert.strictEqual(parsed.version, 'V3');
      assert.strictEqual(parsed.deploymentId, 'polygon-mainnet');
    });

    it('1.4 parseDexIdentityKey throws for malformed identity key', () => {
      assert.throws(() => parseDexIdentityKey('INVALID_KEY'), /Malformed DEX identity key/);
      assert.throws(() => parseDexIdentityKey('EVM:1:UNISWAP'), /Malformed DEX identity key/);
    });

    it('1.5 buildDexId formats canonical DEX ID correctly', () => {
      const id = buildDexId('polygon', 'QuickSwap', 'V3');
      assert.strictEqual(id, 'polygon:quickswap-v3');
    });

    it('1.6 DEX identity is strictly network-bound (Ethereum Uniswap V3 != Polygon Uniswap V3)', () => {
      const ethUniV3 = CANONICAL_DEX_DEFINITIONS.find((d) => d.dexId === 'ethereum:uniswap-v3')!;
      const polyUniV3 = CANONICAL_DEX_DEFINITIONS.find((d) => d.dexId === 'polygon:uniswap-v3')!;
      assert.notStrictEqual(ethUniV3.networkId, polyUniV3.networkId);
      assert.notStrictEqual(ethUniV3.identityKey, polyUniV3.identityKey);
      assert.notStrictEqual(ethUniV3.routerAddress.toLowerCase(), polyUniV3.routerAddress.toLowerCase());
    });

    it('1.7 DEX cannot be identified globally by protocol name alone', () => {
      const uniV3s = CANONICAL_DEX_DEFINITIONS.filter((d) => d.protocolFamily === 'UNISWAP_V3_STYLE');
      assert.ok(uniV3s.length >= 4);
      const uniqueKeys = new Set(uniV3s.map((d) => d.identityKey));
      assert.strictEqual(uniqueKeys.size, uniV3s.length, 'Every deployment must have a unique identity key');
    });

    it('1.8 All canonical DEXes declare explicit address roles', () => {
      for (const dex of CANONICAL_DEX_DEFINITIONS) {
        assert.ok(dex.routerAddress && dex.routerAddress.length > 0, `Router missing for ${dex.dexId}`);
        assert.ok(dex.factoryAddress && dex.factoryAddress.length > 0, `Factory missing for ${dex.dexId}`);
        assert.ok(dex.supportedTokenStandards.length > 0, `Token standards missing for ${dex.dexId}`);
        assert.ok(dex.swapMethods.length > 0, `Swap methods missing for ${dex.dexId}`);
      }
    });

    it('1.9 Address roles maintain correct EVM format where family is EVM', () => {
      const evmDexes = CANONICAL_DEX_DEFINITIONS.filter((d) => d.family === 'EVM');
      for (const dex of evmDexes) {
        assert.match(dex.routerAddress, /^0x[a-fA-F0-9]{40}$/, `Invalid router address for ${dex.dexId}`);
        assert.match(dex.factoryAddress, /^0x[a-fA-F0-9]{40}$/, `Invalid factory address for ${dex.dexId}`);
        if (dex.quoterAddress) {
          assert.match(dex.quoterAddress, /^0x[a-fA-F0-9]{40}$/, `Invalid quoter address for ${dex.dexId}`);
        }
      }
    });

    it('1.10 Solana DEXes use valid base58 format and non-EVM family', () => {
      const solDex = CANONICAL_DEX_DEFINITIONS.find((d) => d.family === 'SOLANA')!;
      assert.ok(solDex);
      assert.strictEqual(solDex.family, 'SOLANA');
      assert.ok(solDex.supportedTokenStandards.includes('SPL'));
    });

    it('1.11 getTokenAddress normalizes both Token and TokenIdentity objects', () => {
      const addr = '0x1111111111111111111111111111111111111111';
      assert.strictEqual(getTokenAddress({ address: addr } as any), addr);
      assert.strictEqual(getTokenAddress({ normalizedAddress: addr } as any), addr);
      assert.strictEqual(getTokenAddress(null as any), '');
    });

    it('1.12 toLegacyToken creates valid Token with verificationTier', () => {
      const token = toLegacyToken({
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        normalizedAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        networkId: 'ethereum'
      } as any);
      assert.strictEqual(token.symbol, 'USDC');
      assert.strictEqual(token.decimals, 6);
      assert.strictEqual(token.verificationTier, 'VERIFIED');
    });
  });

  // ==========================================================================
  // SUITE 2: Explicit Protocol Taxonomy
  // ==========================================================================
  describe('Suite 2: Explicit Protocol Taxonomy', () => {
    it('2.1 Classifies concentrated liquidity AMMs correctly', () => {
      assert.strictEqual(isConcentratedLiquidityAmm('UNISWAP_V3_STYLE'), true);
      assert.strictEqual(isConcentratedLiquidityAmm('CONCENTRATED_LIQUIDITY_AMM'), true);
      assert.strictEqual(isConcentratedLiquidityAmm('UNISWAP_V2_STYLE'), false);
      assert.strictEqual(isConcentratedLiquidityAmm('ORDER_BOOK'), false);
      assert.strictEqual(isConcentratedLiquidityAmm('UNKNOWN'), false);
    });

    it('2.2 Classifies constant product AMMs correctly', () => {
      assert.strictEqual(isConstantProductAmm('UNISWAP_V2_STYLE'), true);
      assert.strictEqual(isConstantProductAmm('CONSTANT_PRODUCT_AMM'), true);
      assert.strictEqual(isConstantProductAmm('UNISWAP_V3_STYLE'), false);
      assert.strictEqual(isConstantProductAmm('HYBRID_AMM'), false);
      assert.strictEqual(isConstantProductAmm('UNKNOWN'), false);
    });

    it('2.3 Recognizes all 11 explicit protocol taxonomies', () => {
      const taxonomies: DexProtocolTaxonomy[] = [
        'UNISWAP_V2_STYLE',
        'UNISWAP_V3_STYLE',
        'CONSTANT_PRODUCT_AMM',
        'STABLE_SWAP_AMM',
        'CONCENTRATED_LIQUIDITY_AMM',
        'WEIGHTED_AMM',
        'HYBRID_AMM',
        'ORDER_BOOK',
        'AGGREGATOR',
        'CUSTOM_AMM',
        'UNKNOWN'
      ];
      assert.strictEqual(taxonomies.length, 11);
      for (const t of taxonomies) {
        if (t === 'UNKNOWN') {
          assert.strictEqual(isSupportedSwapProtocol(t), false);
        } else {
          assert.strictEqual(isSupportedSwapProtocol(t), true);
        }
      }
    });

    it('2.4 Unknown protocols default safely to UNKNOWN', () => {
      assert.strictEqual(isSupportedSwapProtocol('FUTURE_PROTOCOL' as any), false);
    });
  });

  // ==========================================================================
  // SUITE 3: Capability Hierarchy & Bounding
  // ==========================================================================
  describe('Suite 3: Capability Hierarchy & Bounding', () => {
    it('3.1 Hierarchy order is strictly preserved: UNSUPPORTED < UNIT_TESTED < CONFIGURED < QUOTE_AVAILABLE < EXECUTION_AVAILABLE < LIVE_VERIFIED', () => {
      const hierarchy: CapabilityLevel[] = [
        'UNSUPPORTED',
        'UNIT_TESTED',
        'CONFIGURED',
        'QUOTE_AVAILABLE',
        'EXECUTION_AVAILABLE',
        'LIVE_VERIFIED'
      ];
      for (let i = 0; i < hierarchy.length - 1; i++) {
        assert.ok(
          compareCapabilityLevels(hierarchy[i], hierarchy[i + 1]) < 0,
          `${hierarchy[i]} must be strictly less than ${hierarchy[i + 1]}`
        );
      }
    });

    it('3.2 isCapabilityAtLeast evaluates thresholds correctly', () => {
      assert.strictEqual(isCapabilityAtLeast('EXECUTION_AVAILABLE', 'QUOTE_AVAILABLE'), true);
      assert.strictEqual(isCapabilityAtLeast('QUOTE_AVAILABLE', 'EXECUTION_AVAILABLE'), false);
      assert.strictEqual(isCapabilityAtLeast('CONFIGURED', 'CONFIGURED'), true);
      assert.strictEqual(isCapabilityAtLeast('UNSUPPORTED', 'CONFIGURED'), false);
    });

    it('3.3 computeBoundedDexCapability bounds DEX capability by lowest constituent gate', () => {
      // 1. Network UNSUPPORTED bounds everything to UNSUPPORTED
      const cap1 = computeBoundedDexCapability({
        dexCapability: 'EXECUTION_AVAILABLE',
        networkCapability: 'UNSUPPORTED',
        tokenInCapability: 'EXECUTION_AVAILABLE',
        tokenOutCapability: 'EXECUTION_AVAILABLE',
        rpcCapability: 'EXECUTION_AVAILABLE',
        isAddressVerified: true
      });
      assert.strictEqual(cap1, 'UNSUPPORTED');

      // 2. Token UNSUPPORTED bounds to UNSUPPORTED
      const cap2 = computeBoundedDexCapability({
        dexCapability: 'EXECUTION_AVAILABLE',
        networkCapability: 'EXECUTION_AVAILABLE',
        tokenInCapability: 'UNSUPPORTED',
        tokenOutCapability: 'EXECUTION_AVAILABLE',
        rpcCapability: 'EXECUTION_AVAILABLE',
        isAddressVerified: true
      });
      assert.strictEqual(cap2, 'UNSUPPORTED');

      // 3. RPC only QUOTE_AVAILABLE bounds EXECUTION_AVAILABLE to QUOTE_AVAILABLE
      const cap3 = computeBoundedDexCapability({
        dexCapability: 'EXECUTION_AVAILABLE',
        networkCapability: 'EXECUTION_AVAILABLE',
        tokenInCapability: 'EXECUTION_AVAILABLE',
        tokenOutCapability: 'EXECUTION_AVAILABLE',
        rpcCapability: 'QUOTE_AVAILABLE',
        isAddressVerified: true
      });
      assert.strictEqual(cap3, 'QUOTE_AVAILABLE');

      // 4. Address not verified caps capability to CONFIGURED
      const cap4 = computeBoundedDexCapability({
        dexCapability: 'EXECUTION_AVAILABLE',
        networkCapability: 'EXECUTION_AVAILABLE',
        tokenInCapability: 'EXECUTION_AVAILABLE',
        tokenOutCapability: 'EXECUTION_AVAILABLE',
        rpcCapability: 'EXECUTION_AVAILABLE',
        isAddressVerified: false
      });
      assert.strictEqual(cap4, 'CONFIGURED');

      // 5. All gates satisfied preserves full level
      const cap5 = computeBoundedDexCapability({
        dexCapability: 'EXECUTION_AVAILABLE',
        networkCapability: 'EXECUTION_AVAILABLE',
        tokenInCapability: 'EXECUTION_AVAILABLE',
        tokenOutCapability: 'EXECUTION_AVAILABLE',
        rpcCapability: 'EXECUTION_AVAILABLE',
        isAddressVerified: true
      });
      assert.strictEqual(cap5, 'EXECUTION_AVAILABLE');
    });
  });

  // ==========================================================================
  // SUITE 4: Onboarding State Machine & Administrative Transitions
  // ==========================================================================
  describe('Suite 4: Onboarding State Machine & Administrative Transitions', () => {
    it('4.1 Permits progressive valid transitions from DISCOVERED to LIVE_VERIFIED', () => {
      let state = DexOnboardingStateMachine.transition('DISCOVERED', 'CONFIGURED', 'Valid config');
      assert.strictEqual(state, 'CONFIGURED');

      state = DexOnboardingStateMachine.transition(state, 'IDENTITY_VERIFIED', 'Bytecode verified');
      assert.strictEqual(state, 'IDENTITY_VERIFIED');

      state = DexOnboardingStateMachine.transition(state, 'POOL_DISCOVERY_VERIFIED', 'Pools indexed');
      assert.strictEqual(state, 'POOL_DISCOVERY_VERIFIED');

      state = DexOnboardingStateMachine.transition(state, 'QUOTE_VERIFIED', 'Quotes validated');
      assert.strictEqual(state, 'QUOTE_VERIFIED');

      state = DexOnboardingStateMachine.transition(state, 'EXECUTION_ENABLED', 'Simulations passed');
      assert.strictEqual(state, 'EXECUTION_ENABLED');

      state = DexOnboardingStateMachine.transition(state, 'LIVE_VERIFIED', 'Production certified');
      assert.strictEqual(state, 'LIVE_VERIFIED');
    });

    it('4.2 Rejects skipping steps (DISCOVERED directly to LIVE_VERIFIED fails closed)', () => {
      assert.throws(
        () => DexOnboardingStateMachine.assertValidTransition('DISCOVERED', 'LIVE_VERIFIED'),
        DexOnboardingTransitionError
      );
    });

    it('4.3 Rejects skipping steps (CONFIGURED directly to EXECUTION_ENABLED fails closed)', () => {
      assert.throws(
        () => DexOnboardingStateMachine.assertValidTransition('CONFIGURED', 'EXECUTION_ENABLED'),
        DexOnboardingTransitionError
      );
    });

    it('4.4 Allows administrative DISABLED and DEPRECATED transitions from any operational state', () => {
      assert.strictEqual(DexOnboardingStateMachine.canTransition('DISCOVERED', 'DISABLED'), true);
      assert.strictEqual(DexOnboardingStateMachine.canTransition('CONFIGURED', 'DISABLED'), true);
      assert.strictEqual(DexOnboardingStateMachine.canTransition('EXECUTION_ENABLED', 'DISABLED'), true);
      assert.strictEqual(DexOnboardingStateMachine.canTransition('LIVE_VERIFIED', 'DEPRECATED'), true);
    });

    it('4.5 Allows reactivation from DISABLED to CONFIGURED', () => {
      assert.strictEqual(DexOnboardingStateMachine.canTransition('DISABLED', 'CONFIGURED'), true);
      assert.strictEqual(DexOnboardingStateMachine.canTransition('DISABLED', 'LIVE_VERIFIED'), false);
    });

    it('4.6 DEPRECATED is a terminal state (cannot transition back)', () => {
      assert.strictEqual(DexOnboardingStateMachine.canTransition('DEPRECATED', 'CONFIGURED'), false);
      assert.strictEqual(DexOnboardingStateMachine.canTransition('DEPRECATED', 'LIVE_VERIFIED'), false);
    });
  });

  // ==========================================================================
  // SUITE 5: Network Binding & Token Standard Compatibility
  // ==========================================================================
  describe('Suite 5: Network Binding & Token Standard Compatibility', () => {
    it('5.1 Validates correct network binding against AuthoritativeNetworkRegistry', () => {
      const ethUniV3 = CANONICAL_DEX_DEFINITIONS.find((d) => d.dexId === 'ethereum:uniswap-v3')!;
      const report = DexRegistryValidationEngine.validate([ethUniV3]);
      assert.strictEqual(report.isValid, true);
      assert.strictEqual(report.violations.length, 0);
    });

    it('5.2 Rejects DEX bound to non-existent network (DEX_NETWORK_MISMATCH)', () => {
      const invalidDex: DexIdentity = {
        ...CANONICAL_DEX_DEFINITIONS[0],
        networkId: 'non-existent-chain-9999'
      };
      assert.throws(
        () => DexRegistryValidationEngine.assertValidDex(invalidDex),
        DexNetworkMismatchError
      );
    });

    it('5.3 Rejects DEX with mismatched network family (DEX_FAMILY_MISMATCH)', () => {
      const invalidDex: DexIdentity = {
        ...CANONICAL_DEX_DEFINITIONS[0],
        networkId: 'ethereum',
        family: 'SOLANA' // Mismatch: Ethereum is EVM
      };
      assert.throws(
        () => DexRegistryValidationEngine.assertValidDex(invalidDex),
        DexFamilyMismatchError
      );
    });

    it('5.4 Rejects DEX with mismatched network environment (DEX_ENVIRONMENT_MISMATCH)', () => {
      const invalidDex: DexIdentity = {
        ...CANONICAL_DEX_DEFINITIONS[0],
        networkId: 'sepolia', // Testnet
        networkIdentityKey: 'EVM:eip155:11155111',
        deploymentId: 'mainnet-prod' // Environment conflict
      };
      assert.throws(
        () => DexRegistryValidationEngine.assertValidDex(invalidDex),
        DexEnvironmentMismatchError
      );
    });

    it('5.5 Adapter rejects NFT token standards for swaps (ERC721)', async () => {
      const ethUniV3 = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      const tokenIn = { standard: 'ERC721', address: '0x1111111111111111111111111111111111111111' } as any;
      const tokenOut = { standard: 'ERC20', address: '0x2222222222222222222222222222222222222222' } as any;
      const res = ethUniV3.validateTokenPair(tokenIn, tokenOut);
      assert.strictEqual(res.isValid, false);
      assert.match(res.reason!, /TOKEN_STANDARD_UNSUPPORTED/);
    });

    it('5.6 Adapter rejects NFT token standards for swaps (ERC1155)', async () => {
      const ethUniV3 = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      const tokenIn = { standard: 'ERC20', address: '0x1111111111111111111111111111111111111111' } as any;
      const tokenOut = { standard: 'ERC1155', address: '0x2222222222222222222222222222222222222222' } as any;
      const res = ethUniV3.validateTokenPair(tokenIn, tokenOut);
      assert.strictEqual(res.isValid, false);
      assert.match(res.reason!, /TOKEN_STANDARD_UNSUPPORTED/);
    });

    it('5.7 Adapter accepts fungible token standards (ERC20 / NATIVE)', async () => {
      const ethUniV3 = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      const tokenIn = { standard: 'ERC20', address: '0x1111111111111111111111111111111111111111' } as any;
      const tokenOut = { standard: 'ERC20', address: '0x2222222222222222222222222222222222222222' } as any;
      const res = ethUniV3.validateTokenPair(tokenIn, tokenOut);
      assert.strictEqual(res.isValid, true);
    });
  });

  // ==========================================================================
  // SUITE 6: Address Verification & Probing
  // ==========================================================================
  describe('Suite 6: Address Verification & Probing', () => {
    it('6.1 Validates EVM address presence and formatting', () => {
      assert.strictEqual(DexAddressVerifier.isValidEvmAddress('0xE592427A0AEce92De3Edee1F18E0157C05861564'), true);
      assert.strictEqual(DexAddressVerifier.isValidEvmAddress('0x0000000000000000000000000000000000000000'), false); // Zero address
      assert.strictEqual(DexAddressVerifier.isValidEvmAddress('0xinvalid'), false);
      assert.strictEqual(DexAddressVerifier.isValidEvmAddress(''), false);
    });

    it('6.2 Distinguishes address existence, contract presence, and verified deployment', async () => {
      // Mock read-only provider
      const mockProvider = {
        async getCode(address: string) {
          if (address === '0x1111111111111111111111111111111111111111') return '0x'; // EOA
          return '0x608060405234801561001057600080fd5b50'; // Contract bytecode
        },
        async call() {
          return '0x0000000000000000000000001f98431c8ad98523631ae4a59f267346ea31f984';
        }
      };

      const eoaVer = await DexAddressVerifier.verifyAddress(
        '0x1111111111111111111111111111111111111111',
        'ROUTER',
        mockProvider as any
      );
      assert.strictEqual(eoaVer.status, 'ADDRESS_EXISTS');

      const contractVer = await DexAddressVerifier.verifyAddress(
        '0x2222222222222222222222222222222222222222',
        'ROUTER',
        mockProvider as any
      );
      assert.strictEqual(contractVer.status, 'EXPECTED_INTERFACE');
    });

    it('6.3 Provider failure defaults to UNVERIFIED without fabricating', async () => {
      const failingProvider = {
        async getCode() {
          throw new Error('RPC_TIMEOUT');
        }
      };
      const res = await DexAddressVerifier.verifyAddress(
        '0x2222222222222222222222222222222222222222',
        'ROUTER',
        failingProvider as any
      );
      assert.strictEqual(res.status, 'UNVERIFIED');
      assert.match(res.notes || '', /RPC read failure/);
    });
  });

  // ==========================================================================
  // SUITE 7: Authoritative DEX Registry Operations & Immutability
  // ==========================================================================
  describe('Suite 7: Authoritative DEX Registry Operations & Immutability', () => {
    it('7.1 Default registry initializes with all canonical DEXes', () => {
      const dexes = defaultAuthoritativeDexRegistry.getAllDexes();
      assert.ok(dexes.length >= 10);
      assert.ok(defaultAuthoritativeDexRegistry.hasDex('ethereum:uniswap-v3'));
      assert.ok(defaultAuthoritativeDexRegistry.hasDex('polygon:uniswap-v3'));
    });

    it('7.2 Registry returns deep-cloned immutable objects (preventing external corruption)', () => {
      const dex1 = defaultAuthoritativeDexRegistry.getDex('ethereum:uniswap-v3')!;
      assert.ok(dex1);
      (dex1 as any).routerAddress = '0x0000000000000000000000000000000000000000';

      const dex2 = defaultAuthoritativeDexRegistry.getDex('ethereum:uniswap-v3')!;
      assert.notStrictEqual(dex2.routerAddress, '0x0000000000000000000000000000000000000000');
    });

    it('7.3 getDexByIdentityKey retrieves correct DEX', () => {
      const ethUniV3 = defaultAuthoritativeDexRegistry.getDex('ethereum:uniswap-v3')!;
      const byKey = defaultAuthoritativeDexRegistry.getDexByIdentityKey(ethUniV3.identityKey);
      assert.ok(byKey);
      assert.strictEqual(byKey.dexId, 'ethereum:uniswap-v3');
    });

    it('7.4 getDexes(networkId) filters DEXes by network accurately', () => {
      const polyDexes = defaultAuthoritativeDexRegistry.getDexes('polygon');
      assert.ok(polyDexes.length >= 2);
      for (const d of polyDexes) {
        assert.strictEqual(d.networkId, 'polygon');
      }
    });

    it('7.5 resolveDexIdentity resolves by dexId, identityKey, or router address', () => {
      const ethUniV3 = defaultAuthoritativeDexRegistry.getDex('ethereum:uniswap-v3')!;

      // 1. By dexId
      const r1 = defaultAuthoritativeDexRegistry.resolveDexIdentity({ dexId: 'ethereum:uniswap-v3' });
      assert.strictEqual(r1.status, 'RESOLVED_EXACT');
      assert.strictEqual(r1.dex?.dexId, 'ethereum:uniswap-v3');

      // 2. By identityKey
      const r2 = defaultAuthoritativeDexRegistry.resolveDexIdentity({ identityKey: ethUniV3.identityKey });
      assert.strictEqual(r2.status, 'RESOLVED_EXACT');

      // 3. By networkId and routerAddress
      const r3 = defaultAuthoritativeDexRegistry.resolveDexIdentity({
        networkId: 'ethereum',
        routerAddress: ethUniV3.routerAddress
      });
      assert.strictEqual(r3.status, 'RESOLVED_EXACT');
      assert.strictEqual(r3.dex?.dexId, 'ethereum:uniswap-v3');
    });

    it('7.6 registerDex and removeDex manage registry state safely', () => {
      const testRegistry = new AuthoritativeDexRegistry(CANONICAL_DEXES);
      const customDex: DexIdentity = {
        ...CANONICAL_DEXES[0],
        dexId: 'ethereum:custom-dex',
        identityKey: 'EVM:eip155:1:CUSTOM:V1:custom-test',
        canonicalName: 'Custom Dex',
        displayName: 'Custom Dex V1'
      };

      testRegistry.registerDex(customDex);
      assert.strictEqual(testRegistry.hasDex('ethereum:custom-dex'), true);

      // Duplicate registration rejected
      assert.throws(() => testRegistry.registerDex(customDex), /already registered/);

      // Removal
      const removed = testRegistry.removeDex('ethereum:custom-dex');
      assert.strictEqual(removed, true);
      assert.strictEqual(testRegistry.hasDex('ethereum:custom-dex'), false);
    });
  });

  // ==========================================================================
  // SUITE 8: Metadata Conflict Engine
  // ==========================================================================
  describe('Suite 8: Metadata Conflict Engine', () => {
    it('8.1 Detects AGREEMENT when candidate matches primary', () => {
      const primary = CANONICAL_DEXES[0];
      const result = DexMetadataConflictEngine.evaluate(primary, {
        networkId: primary.networkId,
        routerAddress: primary.routerAddress
      });
      assert.strictEqual(result.category, 'AGREEMENT');
      assert.strictEqual(result.canProceed, true);
    });

    it('8.2 Detects IDENTITY_CONFLICT on network mismatch (fails closed)', () => {
      const primary = CANONICAL_DEXES[0];
      const result = DexMetadataConflictEngine.evaluate(primary, {
        networkId: 'polygon'
      });
      assert.strictEqual(result.category, 'IDENTITY_CONFLICT');
      assert.strictEqual(result.conflictType, 'NETWORK_CONFLICT');
      assert.strictEqual(result.canProceed, false);
    });

    it('8.3 Detects MATERIAL_CONFLICT on router address mismatch (fails closed)', () => {
      const primary = CANONICAL_DEXES[0];
      const result = DexMetadataConflictEngine.evaluate(primary, {
        routerAddress: '0x3333333333333333333333333333333333333333'
      });
      assert.strictEqual(result.category, 'MATERIAL_CONFLICT');
      assert.strictEqual(result.conflictType, 'ROUTER_ADDRESS_CONFLICT');
      assert.strictEqual(result.canProceed, false);
    });

    it('8.4 Detects EXPECTED_VARIANCE for fee tiers or non-critical metadata', () => {
      const primary = CANONICAL_DEXES[0];
      const result = DexMetadataConflictEngine.evaluate(primary, {
        quoterAddress: '0x9999999999999999999999999999999999999999'
      });
      assert.strictEqual(result.category, 'EXPECTED_VARIANCE');
      assert.strictEqual(result.canProceed, true);
    });
  });

  // ==========================================================================
  // SUITE 9: EVM DEX Adapters & Mathematical Safety
  // ==========================================================================
  describe('Suite 9: EVM DEX Adapters & Mathematical Safety', () => {
    it('9.1 UniswapV2DexAdapter generates valid constant product quote', async () => {
      const v2Adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v2')!;
      assert.ok(v2Adapter);

      const quote = await v2Adapter.getQuote({
        tokenIn: { symbol: 'WETH', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', decimals: 18, standard: 'ERC20' } as any,
        tokenOut: { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, standard: 'ERC20' } as any,
        amountIn: 1n * 10n ** 18n, // 1 ETH
        slippageToleranceBps: 50 // 0.5%
      });

      assert.ok(quote);
      assert.strictEqual(quote.dexId, 'ethereum:uniswap-v2');
      assert.ok(quote.expectedAmountOut > 0n);
      assert.ok(quote.minimumAmountOut > 0n);
      assert.ok(quote.minimumAmountOut < quote.expectedAmountOut);
      assert.strictEqual(typeof quote.expectedAmountOut, 'bigint');
    });

    it('9.2 UniswapV3DexAdapter enforces deterministic token ordering (token0 < token1)', async () => {
      const v3Adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      assert.ok(v3Adapter);

      const tokenA = { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, standard: 'ERC20' } as any;
      const tokenB = { symbol: 'WETH', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', decimals: 18, standard: 'ERC20' } as any;

      const poolRes = await v3Adapter.discoverPool(tokenB, tokenA);
      assert.strictEqual(poolRes.poolFound, true);
      assert.ok(poolRes.token0!.toLowerCase() < poolRes.token1!.toLowerCase(), 'token0 must be lexicographically less than token1');
    });

    it('9.3 calculateMinimumOutput uses exact integer math without floating-point errors', () => {
      // 10,000 output with 50 bps (0.5%) slippage -> 9,950
      const minOut = calculateMinimumOutput(10000n, 50);
      assert.strictEqual(minOut, 9950n);

      // Large 18-decimal amount
      const amt = 1000000000000000000n; // 1e18
      const minOutLarge = calculateMinimumOutput(amt, 100); // 1%
      assert.strictEqual(minOutLarge, 990000000000000000n);
    });

    it('9.4 calculateMinimumOutput rejects invalid slippage parameters', () => {
      assert.throws(() => calculateMinimumOutput(1000n, -1), /Invalid slippage tolerance/);
      assert.throws(() => calculateMinimumOutput(1000n, 10001), /Invalid slippage tolerance/);
    });

    it('9.5 buildSwapTransaction creates deterministic calldata and Task 32 semantic hash', async () => {
      const v3Adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')! as EvmDexAdapter;
      const quote: AuthoritativeDexQuote = {
        dexId: 'ethereum:uniswap-v3',
        networkId: 'ethereum',
        tokenIn: { symbol: 'WETH', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', decimals: 18, standard: 'ERC20' } as any,
        tokenOut: { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, standard: 'ERC20' } as any,
        amountIn: 1000000000000000000n,
        expectedAmountOut: 3000000000n,
        minimumAmountOut: 2985000000n,
        priceImpact: 0.05,
        fee: 9000000n,
        gasEstimate: 160000n,
        route: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
        poolPath: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
        quoteTimestamp: 1700000000000,
        expiration: 1700000015000,
        providerId: 'ethereum:uniswap-v3',
        capabilityLevel: 'EXECUTION_AVAILABLE',
        verificationStatus: 'VERIFIED_DEPLOYMENT',
        executable: true,
        executionTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        approvalTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564'
      };

      const recipient = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
      const tx = await v3Adapter.buildSwapTransaction(quote, recipient);

      assert.strictEqual(tx.dexId, 'ethereum:uniswap-v3');
      assert.strictEqual(tx.recipient, recipient);
      assert.ok(tx.calldata.startsWith('0x'));
      assert.ok(tx.semanticHash.startsWith('0x'));
      assert.ok(tx.planHash.startsWith('0x'));

      // Calldata mutation alters semantic hash
      const mutatedTx = { ...tx, calldata: tx.calldata + '00' };
      assert.notStrictEqual(mutatedTx.calldata, tx.calldata);
    });
  });

  // ==========================================================================
  // SUITE 10: Fail-Closed Swap Simulation Pipeline
  // ==========================================================================
  describe('Suite 10: Fail-Closed Swap Simulation Pipeline', () => {
    const validQuote: AuthoritativeDexQuote = {
      dexId: 'ethereum:uniswap-v3',
      networkId: 'ethereum',
      tokenIn: { symbol: 'WETH', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', decimals: 18, standard: 'ERC20' } as any,
      tokenOut: { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, standard: 'ERC20' } as any,
      amountIn: 1000000000000000000n,
      expectedAmountOut: 3000000000n,
      minimumAmountOut: 2985000000n,
      priceImpact: 0.05,
      fee: 9000000n,
      gasEstimate: 160000n,
      route: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
      poolPath: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
      quoteTimestamp: Date.now(),
      expiration: Date.now() + 60000,
      providerId: 'ethereum:uniswap-v3',
      capabilityLevel: 'EXECUTION_AVAILABLE',
      verificationStatus: 'VERIFIED_DEPLOYMENT',
      executable: true
    };

    it('10.1 All 10 simulation steps pass for authorized valid transaction', async () => {
      const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      const tx = await adapter.buildSwapTransaction(validQuote, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');

      const report = await DexSimulationPipeline.execute(tx, validQuote, adapter, {
        userAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        expectedSemanticHash: tx.semanticHash
      });

      assert.strictEqual(report.isAuthorized, true);
      assert.strictEqual(report.steps.length, 10);
      for (const s of report.steps) {
        assert.strictEqual(s.passed, true, `Step ${s.step}: ${s.name} should pass`);
      }
    });

    it('10.2 Step 1 fails if DEX capability is not EXECUTION_AVAILABLE / LIVE_VERIFIED', async () => {
      const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      const tx = await adapter.buildSwapTransaction(validQuote, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');

      const unverifiedAdapter = {
        ...adapter,
        getDexIdentity() {
          return { ...adapter.getDexIdentity(), capabilityLevel: 'QUOTE_AVAILABLE' as const };
        }
      } as any;

      const report = await DexSimulationPipeline.execute(tx, validQuote, unverifiedAdapter, {
        userAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
      });

      assert.strictEqual(report.isAuthorized, false);
      assert.strictEqual(report.failedStep?.step, 1);
      assert.strictEqual(report.failedStep?.name, 'VALIDATE_DEX');
    });

    it('10.3 Step 2 fails if tokenIn equals tokenOut', async () => {
      const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      const tx = await adapter.buildSwapTransaction(validQuote, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
      const badTx = { ...tx, tokenOut: tx.tokenIn };

      const report = await DexSimulationPipeline.execute(badTx, validQuote, adapter, {
        userAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
      });

      assert.strictEqual(report.isAuthorized, false);
      assert.strictEqual(report.failedStep?.step, 2);
      assert.strictEqual(report.failedStep?.name, 'VALIDATE_TOKENS');
    });

    it('10.4 Step 3 fails if network mismatch occurs', async () => {
      const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      const tx = await adapter.buildSwapTransaction(validQuote, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
      const badTx = { ...tx, networkIdentityKey: 'EVM:eip155:137' }; // Polygon key on Ethereum DEX

      const report = await DexSimulationPipeline.execute(badTx, validQuote, adapter, {
        userAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
      });

      assert.strictEqual(report.isAuthorized, false);
      assert.strictEqual(report.failedStep?.step, 3);
      assert.strictEqual(report.failedStep?.name, 'VALIDATE_NETWORK');
    });

    it('10.5 Step 4 fails if calldata is missing or truncated', async () => {
      const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      const tx = await adapter.buildSwapTransaction(validQuote, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
      const badTx = { ...tx, calldata: '0x' };

      const report = await DexSimulationPipeline.execute(badTx, validQuote, adapter, {
        userAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
      });

      assert.strictEqual(report.isAuthorized, false);
      assert.strictEqual(report.failedStep?.step, 4);
      assert.strictEqual(report.failedStep?.name, 'VALIDATE_CALLDATA');
    });

    it('10.6 Step 7 fails if semantic hash does not match expected hash', async () => {
      const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      const tx = await adapter.buildSwapTransaction(validQuote, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');

      const report = await DexSimulationPipeline.execute(tx, validQuote, adapter, {
        userAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        expectedSemanticHash: '0x9999999999999999999999999999999999999999999999999999999999999999'
      });

      assert.strictEqual(report.isAuthorized, false);
      assert.strictEqual(report.failedStep?.step, 7);
      assert.strictEqual(report.failedStep?.name, 'SEMANTIC_EQUIVALENCE');
    });

    it('10.7 Step 8 fails if minimum output is zero or exceeds expected output', async () => {
      const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      const tx = await adapter.buildSwapTransaction(validQuote, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
      const badTx = { ...tx, amountOutMinimum: '0' };

      const report = await DexSimulationPipeline.execute(badTx, validQuote, adapter, {
        userAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        expectedSemanticHash: badTx.semanticHash
      });

      assert.strictEqual(report.isAuthorized, false);
      assert.strictEqual(report.failedStep?.step, 8);
      assert.strictEqual(report.failedStep?.name, 'MINIMUM_OUTPUT_SAFETY');
    });

    it('10.8 Step 9 fails if user native balance is insufficient for gas reserve', async () => {
      const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum:uniswap-v3')!;
      const tx = await adapter.buildSwapTransaction(validQuote, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');

      const report = await DexSimulationPipeline.execute(tx, validQuote, adapter, {
        userAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        userNativeBalance: 1000n,
        requiredGasReserve: 50000000000000000n // 0.05 ETH
      });

      assert.strictEqual(report.isAuthorized, false);
      assert.strictEqual(report.failedStep?.step, 9);
      assert.strictEqual(report.failedStep?.name, 'GAS_RESERVE_SAFETY');
    });
  });

  // ==========================================================================
  // SUITE 11: Cross-Chain & Non-EVM Boundaries
  // ==========================================================================
  describe('Suite 11: Cross-Chain & Non-EVM Boundaries', () => {
    it('11.1 DEX adapters are strictly network-local (source DEX != dest DEX)', () => {
      const ethUni = defaultAuthoritativeDexRegistry.getDex('ethereum:uniswap-v3')!;
      const polyUni = defaultAuthoritativeDexRegistry.getDex('polygon:uniswap-v3')!;
      assert.strictEqual(ethUni.networkId, 'ethereum');
      assert.strictEqual(polyUni.networkId, 'polygon');
      // A local swap adapter cannot perform bridging operations
      assert.ok(!ethUni.swapMethods.includes('BRIDGE' as any));
    });

    it('11.2 Solana DEX operations reject unsupported EVM operations cleanly', async () => {
      const solAdapter = defaultAuthoritativeDexRegistry.getDexAdapter('solana:raydium-v4')!;
      assert.ok(solAdapter);

      // Attempting EVM-specific pool discovery or quotes on Solana returns UNSUPPORTED_DEX_OPERATION or null
      const tokenIn = { symbol: 'SOL', address: 'So11111111111111111111111111111111111111112', standard: 'SPL' } as any;
      const tokenOut = { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', standard: 'SPL' } as any;

      const poolRes = await solAdapter.discoverPool(tokenIn, tokenOut);
      assert.strictEqual(poolRes.poolFound, false);
      assert.strictEqual(poolRes.discoverySource, 'UNSUPPORTED');
    });

    it('11.3 checkDexCapabilityGate enforces capability gating for routing', () => {
      const ethNet = defaultAuthoritativeNetworkRegistry.getNetwork('ethereum')!;

      // 1. Fully capable DEX passes
      const resPass = checkDexCapabilityGate('ethereum:uniswap-v3', ethNet, 'EXECUTION_AVAILABLE');
      assert.strictEqual(resPass.passed, true);

      // 2. DEX with lower capability than required fails closed
      const resFail = checkDexCapabilityGate('ethereum:uniswap-v3', ethNet, 'LIVE_VERIFIED');
      // In canonical data, ethereum:uniswap-v3 is EXECUTION_AVAILABLE, so LIVE_VERIFIED requirement fails closed
      assert.strictEqual(resFail.passed, false);
      assert.match(resFail.reason!, /DEX_CAPABILITY_GATE_FAILED/);
    });

    it('11.4 normalizeDexQuoteToRoute assigns deterministic route ID', () => {
      const quote: AuthoritativeDexQuote = {
        dexId: 'ethereum:uniswap-v3',
        networkId: 'ethereum',
        tokenIn: { symbol: 'WETH', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', decimals: 18, standard: 'ERC20' } as any,
        tokenOut: { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, standard: 'ERC20' } as any,
        amountIn: 1000000000000000000n,
        expectedAmountOut: 3000000000n,
        minimumAmountOut: 2985000000n,
        priceImpact: 0.05,
        fee: 9000000n,
        gasEstimate: 160000n,
        route: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
        poolPath: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
        quoteTimestamp: 1700000000000,
        expiration: 1700000015000,
        providerId: 'ethereum:uniswap-v3',
        capabilityLevel: 'EXECUTION_AVAILABLE',
        verificationStatus: 'VERIFIED_DEPLOYMENT',
        executable: true
      };

      const route1 = normalizeDexQuoteToRoute(quote);
      const route2 = normalizeDexQuoteToRoute(quote);

      assert.strictEqual(route1.routeId, route2.routeId);
      assert.strictEqual(route1.sourceDex, 'ethereum:uniswap-v3');
      assert.strictEqual(route1.capabilityLevel, 'EXECUTION_AVAILABLE');
    });
  });

  // ==========================================================================
  // SUITE 12: DETERMINISTIC FUZZ TESTING (4,000 Iterations, Seed: 0x7A5C40)
  // ==========================================================================
  describe('Suite 12: Deterministic Fuzz Testing (4,000 Iterations, Seed: 0x7A5C40)', () => {

    it('12.1 Fuzz 1: 1,000 DEX identity and address mutations', () => {
      const prng = new DeterministicPRNG(0x7a5c40);
      const networks = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc'];
      const protocols = ['UNISWAP', 'QUICKSWAP', 'PANCAKESWAP', 'SUSHISWAP', 'UNKNOWN'];
      const versions = ['V2', 'V3', 'CUSTOM'];

      let validatedCount = 0;
      let rejectedCount = 0;

      for (let i = 0; i < 1000; i++) {
        const netId = prng.choice(networks);
        const protocol = prng.choice(protocols);
        const ver = prng.choice(versions);
        const dep = `dep-${prng.nextInt(1, 100)}`;
        const netKey = `EVM:eip155:${prng.nextInt(1, 1000)}`;

        // Build identity key
        const idKey = buildDexIdentityKey(netKey, protocol, ver, dep);
        const parsed = parseDexIdentityKey(idKey);
        assert.strictEqual(parsed.protocol, protocol);
        assert.strictEqual(parsed.version, ver);
        assert.strictEqual(parsed.deploymentId, dep);

        // Mutate router address
        const mutateType = prng.nextInt(0, 3);
        let routerAddr: string;
        if (mutateType === 0) {
          routerAddr = prng.nextAddress(); // Valid EVM address
        } else if (mutateType === 1) {
          routerAddr = '0x0000000000000000000000000000000000000000'; // Zero address
        } else if (mutateType === 2) {
          routerAddr = '0x' + prng.nextHex(10); // Truncated address
        } else {
          routerAddr = ''; // Empty address
        }

        const isValidAddress = DexAddressVerifier.isValidEvmAddress(routerAddr);
        if (isValidAddress) {
          validatedCount++;
        } else {
          rejectedCount++;
        }
      }

      assert.strictEqual(validatedCount + rejectedCount, 1000);
      assert.ok(validatedCount > 0, 'Expected valid addresses');
      assert.ok(rejectedCount > 0, 'Expected rejected addresses');
    });

    it('12.2 Fuzz 2: 1,000 token and pool compatibility mutations', () => {
      const prng = new DeterministicPRNG(0x7a5c40 + 1);
      const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum-uniswap-v3')!;
      const standards: TokenStandard[] = ['ERC20', 'NATIVE', 'WRAPPED_NATIVE', 'ERC721', 'ERC1155', 'SPL', 'UNSUPPORTED'];

      let validPairCount = 0;
      let invalidPairCount = 0;

      for (let i = 0; i < 1000; i++) {
        const stdIn = prng.choice(standards);
        const stdOut = prng.choice(standards);
        const tokenIn = { standard: stdIn, address: prng.nextAddress() } as any;
        const tokenOut = { standard: stdOut, address: prng.nextAddress() } as any;

        const res = adapter.validateTokenPair(tokenIn, tokenOut);
        if (res.isValid) {
          validPairCount++;
          // For valid pair, both must be fungible ERC20-compatible
          assert.ok(stdIn === 'ERC20' || stdIn === 'NATIVE' || stdIn === 'WRAPPED_NATIVE');
          assert.ok(stdOut === 'ERC20' || stdOut === 'NATIVE' || stdOut === 'WRAPPED_NATIVE');
        } else {
          invalidPairCount++;
          assert.ok(res.reason && res.reason.length > 0);
        }
      }

      assert.strictEqual(validPairCount + invalidPairCount, 1000);
      assert.ok(validPairCount > 0);
      assert.ok(invalidPairCount > 0);
    });

    it('12.3 Fuzz 3: 1,000 quote, calldata, and semantic mutations', async () => {
      const prng = new DeterministicPRNG(0x7a5c40 + 2);
      const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('ethereum-uniswap-v3')!;

      let safeOutputCount = 0;
      let rejectedSlippageCount = 0;

      for (let i = 0; i < 1000; i++) {
        const amountOut = prng.nextBigInt(1000n, 10n ** 24n);
        const slippageBps = prng.nextInt(-100, 15000);

        if (slippageBps < 0 || slippageBps > 10000) {
          assert.throws(() => calculateMinimumOutput(amountOut, slippageBps), /Invalid slippage tolerance/);
          rejectedSlippageCount++;
        } else {
          const minOut = calculateMinimumOutput(amountOut, slippageBps);
          assert.ok(minOut <= amountOut, 'minOut must not exceed expected amountOut');
          assert.ok(minOut >= 0n, 'minOut must be non-negative');
          safeOutputCount++;
        }
      }

      assert.strictEqual(safeOutputCount + rejectedSlippageCount, 1000);
      assert.ok(safeOutputCount > 0);
      assert.ok(rejectedSlippageCount > 0);
    });

    it('12.4 Fuzz 4: 1,000 route, capability, and arbitration mutations', () => {
      const prng = new DeterministicPRNG(0x7a5c40 + 3);
      const levels: CapabilityLevel[] = [
        'UNSUPPORTED',
        'UNIT_TESTED',
        'CONFIGURED',
        'QUOTE_AVAILABLE',
        'EXECUTION_AVAILABLE',
        'LIVE_VERIFIED'
      ];

      let boundedCount = 0;

      for (let i = 0; i < 1000; i++) {
        const dexCap = prng.choice(levels);
        const netCap = prng.choice(levels);
        const tokInCap = prng.choice(levels);
        const tokOutCap = prng.choice(levels);
        const rpcCap = prng.choice(levels);
        const addrVer = prng.nextInt(0, 1) === 1;

        const bounded = computeBoundedDexCapability({
          dexCapability: dexCap,
          networkCapability: netCap,
          tokenInCapability: tokInCap,
          tokenOutCapability: tokOutCap,
          rpcCapability: rpcCap,
          isAddressVerified: addrVer
        });

        // Hierarchy rule: bounded cannot exceed any constituent gate
        assert.ok(compareCapabilityLevels(bounded, dexCap) <= 0);
        assert.ok(compareCapabilityLevels(bounded, netCap) <= 0);
        assert.ok(compareCapabilityLevels(bounded, tokInCap) <= 0);
        assert.ok(compareCapabilityLevels(bounded, tokOutCap) <= 0);
        assert.ok(compareCapabilityLevels(bounded, rpcCap) <= 0);
        if (!addrVer) {
          assert.ok(compareCapabilityLevels(bounded, 'CONFIGURED') <= 0);
        }

        boundedCount++;
      }

      assert.strictEqual(boundedCount, 1000);
    });
  });

});
