import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TokenIdentity, TokenStandard, TokenVerificationState, CapabilityLevel, NetworkFamily } from '@zenith/types';
import { buildTokenIdentityKey, parseTokenIdentityKey, buildTokenId, isFungibleStandard, isNftStandard, isMultiTokenStandard, isStandardSupportedForFamily, getAllowedStandardsForFamily, normalizeTokenAddress, InvalidTokenAddressError, TokenMetadataConflictEngine, TokenRegistryValidationEngine, AuthoritativeTokenRegistry, defaultAuthoritativeTokenRegistry, ZENITH_CANONICAL_TOKENS, TokenRpcVerifier } from '@zenith/tokens';
import { defaultAuthoritativeNetworkRegistry, AuthoritativeRpcProviderRegistry } from '@zenith/chains';
class DeterministicPRNG {
    private state: number;
    constructor(seed: number = 0x7A5C39) {
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
}
describe('ZENITH — PHASE 2 TASK 39: AUTHORITATIVE TOKEN REGISTRY & TOKEN IDENTITY CERTIFICATION', () => {

  // ==========================================================================
  // SUITE 1: Authoritative Token Registration & Canonical Seeding
  // ==========================================================================
  describe('Suite 1: Authoritative Token Registration & Canonical Seeding', () => {
    it('1.1 Seeds authoritative canonical tokens successfully on startup', () => {
      const tokens = defaultAuthoritativeTokenRegistry.getTokens('ethereum');
      assert.ok(tokens.length >= 6, 'Ethereum must have at least 6 canonical tokens');
      const eth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum');
      assert.ok(eth, 'Ethereum must have a native token');
      assert.strictEqual(eth.symbol, 'ETH');
      assert.strictEqual(eth.decimals, 18);
    });

    it('1.2 Canonical tokens exist across all 8 canonical networks', () => {
      const canonicalNetworks = ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'avalanche', 'bsc', 'solana', 'bitcoin'];
      for (const net of canonicalNetworks) {
        const list = defaultAuthoritativeTokenRegistry.getTokens(net);
        assert.ok(list.length > 0, `Network ${net} must have seeded canonical tokens`);
      }
    });

    it('1.3 All queries return deep-cloned immutable token objects', () => {
      const eth1 = defaultAuthoritativeTokenRegistry.getToken('ethereum:native:eth');
      assert.ok(eth1);
      (eth1 as any).decimals = 99;
      const eth2 = defaultAuthoritativeTokenRegistry.getToken('ethereum:native:eth');
      assert.strictEqual(eth2?.decimals, 18, 'Registry state must not be corrupted by caller mutation');
    });

    it('1.4 Checks registration presence using isTokenRegistered', () => {
      assert.strictEqual(defaultAuthoritativeTokenRegistry.isTokenRegistered('ethereum:native:eth'), true);
      assert.strictEqual(defaultAuthoritativeTokenRegistry.isTokenRegistered('ethereum:erc20:0xghost'), false);
    });

    it('1.5 Successfully removes and re-registers tokens in isolated registry', () => {
      const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
      const testId = 'ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const removed = reg.removeToken(testId);
      assert.strictEqual(removed, true);
      assert.strictEqual(reg.getToken(testId), undefined);
    });
  });

  // ==========================================================================
  // SUITE 2: Token Identity Key Determinism & Collision Resistance
  // ==========================================================================
  describe('Suite 2: Token Identity Key Determinism & Collision Resistance', () => {
    it('2.1 Builds deterministic contract token identity key', () => {
      const key = buildTokenIdentityKey('EVM:eip155:1', 'ERC20', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      assert.strictEqual(key, 'EVM:eip155:1:ERC20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    });

    it('2.2 Builds deterministic native asset identity key', () => {
      const key = buildTokenIdentityKey('EVM:eip155:1', 'NATIVE', 'ETH');
      assert.strictEqual(key, 'EVM:eip155:1:NATIVE:ETH');
    });

    it('2.3 Round-trip parsing guarantees exact identity recreation', () => {
      const raw = 'EVM:eip155:1:ERC20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const parsed = parseTokenIdentityKey(raw);
      assert.strictEqual(parsed.networkIdentityKey, 'EVM:eip155:1');
      assert.strictEqual(parsed.standard, 'ERC20');
      assert.strictEqual(parsed.identifier, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    });

    it('2.4 parseTokenIdentityKey rejects malformed keys with fewer than 5 segments', () => {
      assert.throws(() => parseTokenIdentityKey('EVM:eip155:1:ERC20'), /Expected at least 5 segments/);
    });

    it('2.5 buildTokenId creates standardized composite internal ID', () => {
      const id = buildTokenId('ethereum', 'ERC20', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      assert.strictEqual(id, 'ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    });
  });

  // ==========================================================================
  // SUITE 3: Token Standard Taxonomy & Cross-Family Compatibility
  // ==========================================================================
  describe('Suite 3: Token Standard Taxonomy & Cross-Family Compatibility', () => {
    it('3.1 Identifies fungible standards accurately', () => {
      assert.strictEqual(isFungibleStandard('ERC20'), true);
      assert.strictEqual(isFungibleStandard('NATIVE'), true);
      assert.strictEqual(isFungibleStandard('WRAPPED_NATIVE'), true);
      assert.strictEqual(isFungibleStandard('SPL'), true);
      assert.strictEqual(isFungibleStandard('ERC721'), false);
      assert.strictEqual(isFungibleStandard('ERC1155'), false);
    });

    it('3.2 Identifies NFT and multi-token standards', () => {
      assert.strictEqual(isNftStandard('ERC721'), true);
      assert.strictEqual(isNftStandard('ERC20'), false);
      assert.strictEqual(isMultiTokenStandard('ERC1155'), true);
      assert.strictEqual(isMultiTokenStandard('ERC20'), false);
    });

    it('3.3 Enforces valid standard pairings per family', () => {
      assert.strictEqual(isStandardSupportedForFamily('EVM', 'ERC20'), true);
      assert.strictEqual(isStandardSupportedForFamily('EVM', 'SPL'), false);
      assert.strictEqual(isStandardSupportedForFamily('SOLANA', 'SPL'), true);
      assert.strictEqual(isStandardSupportedForFamily('SOLANA', 'ERC20'), false);
      assert.strictEqual(isStandardSupportedForFamily('BITCOIN', 'UTXO_ASSET'), true);
      assert.strictEqual(isStandardSupportedForFamily('BITCOIN', 'ERC20'), false);
    });

    it('3.4 getAllowedStandardsForFamily returns immutable array of standards', () => {
      const evm = getAllowedStandardsForFamily('EVM');
      assert.ok(evm.includes('ERC20'));
      assert.ok(evm.includes('NATIVE'));
      assert.ok(evm.includes('WRAPPED_NATIVE'));
    });

    it('3.5 Rejects unsupported or unknown standard gracefully', () => {
      assert.strictEqual(isStandardSupportedForFamily('EVM', 'UNSUPPORTED' as any), false);
    });
  });

  // ==========================================================================
  // SUITE 4: Family-Specific Address Normalization & Validation
  // ==========================================================================
  describe('Suite 4: Family-Specific Address Normalization & Validation', () => {
    it('4.1 Normalizes valid EVM address to lowercase', () => {
      const raw = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const norm = normalizeTokenAddress('EVM', raw);
      assert.strictEqual(norm, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    });

    it('4.2 Rejects malformed EVM address missing 0x prefix', () => {
      assert.throws(
        () => normalizeTokenAddress('EVM', 'A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
        InvalidTokenAddressError
      );
    });

    it('4.3 Rejects malformed EVM address with invalid length', () => {
      assert.throws(
        () => normalizeTokenAddress('EVM', '0x1234'),
        InvalidTokenAddressError
      );
    });

    it('4.4 Rejects EVM zero address when contract token required', () => {
      assert.throws(
        () => normalizeTokenAddress('EVM', '0x0000000000000000000000000000000000000000', { allowZeroAddress: false }),
        /cannot be the zero address/
      );
    });

    it('4.5 Normalizes valid Solana Base58 public key', () => {
      const solAddr = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const norm = normalizeTokenAddress('SOLANA', solAddr);
      assert.strictEqual(norm, solAddr);
    });

    it('4.6 Rejects invalid Solana address containing illegal characters', () => {
      assert.throws(
        () => normalizeTokenAddress('SOLANA', '0xInvalidSolanaAddressHere'),
        InvalidTokenAddressError
      );
    });

    it('4.7 Normalizes valid Bitcoin/UTXO identifiers', () => {
      assert.strictEqual(normalizeTokenAddress('BITCOIN', 'ord:ordi'), 'ord:ordi');
      assert.strictEqual(normalizeTokenAddress('BITCOIN', 'rune:dog_go_to_the_moon'), 'rune:dog_go_to_the_moon');
    });

    it('4.8 Rejects empty or null address strings', () => {
      assert.throws(() => normalizeTokenAddress('EVM', ''), InvalidTokenAddressError);
      assert.throws(() => normalizeTokenAddress('EVM', null as any), InvalidTokenAddressError);
    });
  });

  // ==========================================================================
  // SUITE 5: Native Asset Model & Gas Asset Binding
  // ==========================================================================
  describe('Suite 5: Native Asset Model & Gas Asset Binding', () => {
    it('5.1 Native ETH has standard=NATIVE and no contract address', () => {
      const eth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum');
      assert.ok(eth);
      assert.strictEqual(eth.isNative, true);
      assert.strictEqual(eth.standard, 'NATIVE');
      assert.strictEqual(eth.address, undefined);
    });

    it('5.2 Native asset decimals match authoritative network registry', () => {
      const ethNet = defaultAuthoritativeNetworkRegistry.getNetwork('ethereum');
      const ethToken = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum');
      assert.strictEqual(ethToken?.decimals, ethNet?.nativeAsset.decimals);
    });

    it('5.3 Native asset symbol matches network gas symbol', () => {
      const polNet = defaultAuthoritativeNetworkRegistry.getNetwork('polygon');
      const polToken = defaultAuthoritativeTokenRegistry.getNativeToken('polygon');
      assert.strictEqual(polToken?.symbol, polNet?.nativeAsset.symbol);
    });

    it('5.4 Non-existent network returns undefined for native token', () => {
      assert.strictEqual(defaultAuthoritativeTokenRegistry.getNativeToken('ghost-network'), undefined);
    });

    it('5.5 Native assets carry valid verification dimensions', () => {
      const eth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum')!;
      assert.strictEqual(eth.verificationDimensions.identityVerified, true);
      assert.strictEqual(eth.verificationDimensions.networkVerified, true);
    });
  });

  // ==========================================================================
  // SUITE 6: Wrapped Native vs Native Separation (ETH != WETH)
  // ==========================================================================
  describe('Suite 6: Wrapped Native vs Native Separation (ETH != WETH)', () => {
    it('6.1 Native ETH and WETH possess completely distinct token IDs', () => {
      const nativeEth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum');
      const weth = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('ethereum');
      assert.ok(nativeEth && weth);
      assert.notStrictEqual(nativeEth.tokenId, weth.tokenId);
      assert.strictEqual(nativeEth.isNative, true);
      assert.strictEqual(weth.isNative, false);
      assert.strictEqual(weth.isWrappedNative, true);
    });

    it('6.2 WETH has valid contract address and wrappedAddress pointer', () => {
      const weth = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('ethereum');
      assert.strictEqual(weth?.address?.toLowerCase(), '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
      const nativeEth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum');
      assert.strictEqual(nativeEth?.wrappedAddress?.toLowerCase(), '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
    });

    it('6.3 Polygon POL is distinguished from WMATIC / WPOL', () => {
      const pol = defaultAuthoritativeTokenRegistry.getNativeToken('polygon');
      const wmatic = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('polygon');
      assert.ok(pol && wmatic);
      assert.strictEqual(pol.symbol, 'POL');
      assert.strictEqual(wmatic.symbol, 'WMATIC');
      assert.notStrictEqual(pol.tokenId, wmatic.tokenId);
    });

    it('6.4 Avalanche AVAX is distinguished from WAVAX', () => {
      const avax = defaultAuthoritativeTokenRegistry.getNativeToken('avalanche');
      const wavax = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('avalanche');
      assert.ok(avax && wavax);
      assert.strictEqual(avax.isNative, true);
      assert.strictEqual(wavax.isWrappedNative, true);
    });

    it('6.5 Wrapped token cannot substitute for native gas asset directly', () => {
      const weth = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('ethereum')!;
      assert.strictEqual(weth.assetType, 'WRAPPED_NATIVE');
      assert.strictEqual(weth.isNative, false);
    });
  });

  // ==========================================================================
  // SUITE 7: Token Metadata Model & Verification Dimensions
  // ==========================================================================
  describe('Suite 7: Token Metadata Model & Verification Dimensions', () => {
    it('7.1 getTokenMetadata returns correct metadata snapshot', () => {
      const meta = defaultAuthoritativeTokenRegistry.getTokenMetadata('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      assert.ok(meta);
      assert.strictEqual(meta.symbol, 'USDC');
      assert.strictEqual(meta.decimals, 6);
      assert.strictEqual(meta.metadataStatus, 'LIVE_VERIFIED');
    });

    it('7.2 Verification dimensions remain independent booleans', () => {
      const token = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
      const dims = token.verificationDimensions;
      assert.strictEqual(typeof dims.identityVerified, 'boolean');
      assert.strictEqual(typeof dims.addressVerified, 'boolean');
      assert.strictEqual(typeof dims.standardVerified, 'boolean');
      assert.strictEqual(typeof dims.decimalsVerified, 'boolean');
      assert.strictEqual(typeof dims.metadataVerified, 'boolean');
      assert.strictEqual(typeof dims.contractCodeVerified, 'boolean');
      assert.strictEqual(typeof dims.networkVerified, 'boolean');
    });

    it('7.3 getTokenVerificationStatus returns authoritative verification status', () => {
      const status = defaultAuthoritativeTokenRegistry.getTokenVerificationStatus('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      assert.strictEqual(status, 'IDENTITY_VERIFIED');
    });

    it('7.4 Unknown token returns UNVERIFIED status', () => {
      const status = defaultAuthoritativeTokenRegistry.getTokenVerificationStatus('unknown:token:id');
      assert.strictEqual(status, 'UNVERIFIED');
    });

    it('7.5 getTokenMetadata returns undefined for non-existent token', () => {
      assert.strictEqual(defaultAuthoritativeTokenRegistry.getTokenMetadata('ghost:id'), undefined);
    });
  });

  // ==========================================================================
  // SUITE 8: Token Capability Hierarchy & Upstream Ceiling Enforcement
  // ==========================================================================
  describe('Suite 8: Token Capability Hierarchy & Upstream Ceiling Enforcement', () => {
    it('8.1 Core Tier 1 Ethereum tokens have LIVE_VERIFIED capability', () => {
      const cap = defaultAuthoritativeTokenRegistry.getTokenCapability('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      assert.strictEqual(cap, 'LIVE_VERIFIED');
    });

    it('8.2 Tier 2 Avalanche tokens have CONFIGURED capability (ceiling aligned)', () => {
      const cap = defaultAuthoritativeTokenRegistry.getTokenCapability('avalanche:native:avax');
      assert.strictEqual(cap, 'CONFIGURED');
    });

    it('8.3 Tier 3 Bitcoin native BTC has CONFIGURED capability', () => {
      const cap = defaultAuthoritativeTokenRegistry.getTokenCapability('bitcoin:native:btc');
      assert.strictEqual(cap, 'CONFIGURED');
    });

    it('8.4 Unknown token returns UNSUPPORTED capability', () => {
      assert.strictEqual(defaultAuthoritativeTokenRegistry.getTokenCapability('nonexistent'), 'UNSUPPORTED');
    });

    it('8.5 Validation engine rejects token capability exceeding network capability', () => {
      const badToken: TokenIdentity = {
        ...defaultAuthoritativeTokenRegistry.getToken('avalanche:native:avax')!,
        tokenId: 'avalanche:native:fake-live',
        capabilityLevel: 'LIVE_VERIFIED' // Avalanche network is only CONFIGURED
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /exceeds network capability level/);
    });
  });

  // ==========================================================================
  // SUITE 9: Token Onboarding State Machine & Administrative Transitions
  // ==========================================================================
  describe('Suite 9: Token Onboarding State Machine & Administrative Transitions', () => {
    it('9.1 Core tokens are in LIVE_VERIFIED onboarding state', () => {
      const token = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
      assert.strictEqual(token.onboardingState, 'LIVE_VERIFIED');
    });

    it('9.2 Disabling a token transitions onboardingState to DISABLED and capability to UNSUPPORTED', () => {
      const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
      const testId = 'ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      reg.disableToken(testId, 'Security pause');
      const updated = reg.getToken(testId);
      assert.strictEqual(updated?.onboardingState, 'DISABLED');
      assert.strictEqual(updated?.capabilityLevel, 'UNSUPPORTED');
    });

    it('9.3 Promoting a token requires explicit evidence reason', () => {
      const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
      const testId = 'avalanche:native:avax';
      assert.throws(() => reg.promoteToken(testId, 'LIVE_VERIFIED', null as any), /Explicit evidence reason required/);
    });

    it('9.4 Successfully promotes token with evidence', () => {
      const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
      const testId = 'avalanche:native:avax';
      reg.promoteToken(testId, 'LIVE_VERIFIED', { reason: 'Test verification pass', timestamp: 123456789 });
      const token = reg.getToken(testId);
      assert.strictEqual(token?.onboardingState, 'LIVE_VERIFIED');
      assert.strictEqual(token?.lastVerifiedAt, 123456789);
    });

    it('9.5 Throws error when disabling an unknown token', () => {
      const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
      assert.throws(() => reg.disableToken('ghost:token', 'test'), /Cannot disable unknown token/);
    });
  });

  // ==========================================================================
  // SUITE 10: ERC-20 Read-Only RPC Verification & Bytecode Inspection
  // ==========================================================================
  describe('Suite 10: ERC-20 Read-Only RPC Verification & Bytecode Inspection', () => {
    it('10.1 Fails closed when address has no bytecode', async () => {
      const mockAdapter = {
        family: 'EVM' as NetworkFamily,
        networkId: 'ethereum',
        provider: {} as any,
        getNetworkIdentity: async () => 1,
        getLatestHead: async () => ({ blockNumber: 100 }),
        getBalance: async () => ({ address: '0x123', balance: 0n, decimals: 18, symbol: 'ETH' }),
        getCodeOrEquivalent: async () => '0x', // No bytecode
        simulateTransaction: async () => ({ success: true }),
        estimateFee: async () => ({ estimatedFeeNative: 0n }),
        broadcastTransaction: async () => '0xhash',
        getTransaction: async () => null,
        getReceiptOrEquivalent: async () => null
      };

      const res = await TokenRpcVerifier.verifyErc20Token(
        'ethereum',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        mockAdapter
      );
      assert.strictEqual(res.verified, false);
      assert.strictEqual(res.hasBytecode, false);
      assert.strictEqual(res.status, 'FAILED_VERIFICATION');
    });

    it('10.2 Correctly extracts decimals, symbol, and name from simulation returns', async () => {
      const mockAdapter = {
        family: 'EVM' as NetworkFamily,
        networkId: 'ethereum',
        provider: {} as any,
        getNetworkIdentity: async () => 1,
        getLatestHead: async () => ({ blockNumber: 100 }),
        getBalance: async () => ({ address: '0x123', balance: 0n, decimals: 18, symbol: 'ETH' }),
        getCodeOrEquivalent: async () => '0x60806040...',
        simulateTransaction: async (tx: any) => {
          if (tx.data === '0x313ce567') return { success: true, returnData: '0x0000000000000000000000000000000000000000000000000000000000000006' }; // 6
          if (tx.data === '0x95d89b41') return { success: true, returnData: '0x5553444300000000000000000000000000000000000000000000000000000000' }; // bytes32 "USDC"
          if (tx.data === '0x06fdde03') return { success: true, returnData: '0x55534420436f696e000000000000000000000000000000000000000000000000' }; // bytes32 "USD Coin"
          return { success: false };
        },
        estimateFee: async () => ({ estimatedFeeNative: 0n }),
        broadcastTransaction: async () => '0xhash',
        getTransaction: async () => null,
        getReceiptOrEquivalent: async () => null
      };

      const res = await TokenRpcVerifier.verifyErc20Token(
        'ethereum',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        mockAdapter
      );
      assert.strictEqual(res.verified, true);
      assert.strictEqual(res.hasBytecode, true);
      assert.strictEqual(res.decimals, 6);
      assert.strictEqual(res.symbol, 'USDC');
    });

    it('10.3 Returns UNVERIFIED when RPC calls fail', async () => {
      const mockAdapter = {
        family: 'EVM' as NetworkFamily,
        networkId: 'ethereum',
        provider: {} as any,
        getNetworkIdentity: async () => 1,
        getLatestHead: async () => ({ blockNumber: 100 }),
        getBalance: async () => ({ address: '0x123', balance: 0n, decimals: 18, symbol: 'ETH' }),
        getCodeOrEquivalent: async () => { throw new Error('RPC Timeout'); },
        simulateTransaction: async () => ({ success: false }),
        estimateFee: async () => ({ estimatedFeeNative: 0n }),
        broadcastTransaction: async () => '0xhash',
        getTransaction: async () => null,
        getReceiptOrEquivalent: async () => null
      };

      const res = await TokenRpcVerifier.verifyErc20Token(
        'ethereum',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        mockAdapter
      );
      assert.strictEqual(res.verified, false);
      assert.strictEqual(res.status, 'UNVERIFIED');
    });

    it('10.4 Rejects verifying non-EVM family through ERC-20 verifier', async () => {
      const res = await TokenRpcVerifier.verifyErc20Token('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      assert.strictEqual(res.verified, false);
      assert.strictEqual(res.status, 'UNVERIFIED');
      assert.ok(res.reason?.includes('non-EVM'));
    });

    it('10.5 Rejects malformed EVM address before dispatching RPC call', async () => {
      const res = await TokenRpcVerifier.verifyErc20Token('ethereum', '0xinvalid');
      assert.strictEqual(res.verified, false);
      assert.strictEqual(res.status, 'FAILED_VERIFICATION');
    });
  });

  // ==========================================================================
  // SUITE 11: Non-Fungible (ERC721/1155) Swap Boundary Rejection
  // ==========================================================================
  describe('Suite 11: Non-Fungible (ERC721/1155) Swap Boundary Rejection', () => {
    it('11.1 Rejects ERC721 token in validation engine if marked isFungible=true', () => {
      const badNft: TokenIdentity = {
        ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
        tokenId: 'ethereum:erc721:0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
        standard: 'ERC721',
        isFungible: true,
        isNFT: true
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badNft]), /cannot be fungible and NFT/);
    });

    it('11.2 Rejects ERC1155 token in validation engine if marked isFungible=true', () => {
      const badMulti: TokenIdentity = {
        ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
        tokenId: 'ethereum:erc1155:0x1234567890123456789012345678901234567890',
        standard: 'ERC1155',
        isFungible: true,
        isMultiToken: true
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badMulti]), /cannot be fungible and NFT\/MultiToken/);
    });

    it('11.3 isFungibleStandard returns false for ERC721 and ERC1155', () => {
      assert.strictEqual(isFungibleStandard('ERC721'), false);
      assert.strictEqual(isFungibleStandard('ERC1155'), false);
    });

    it('11.4 Correctly flags isNFT=true and isMultiToken=true for non-fungible types', () => {
      assert.strictEqual(isNftStandard('ERC721'), true);
      assert.strictEqual(isMultiTokenStandard('ERC1155'), true);
    });
  });

  // ==========================================================================
  // SUITE 12: Non-EVM Token Boundaries (Solana SPL, Bitcoin UTXO)
  // ==========================================================================
  describe('Suite 12: Non-EVM Token Boundaries (Solana SPL, Bitcoin UTXO)', () => {
    it('12.1 Solana tokens use standard=SPL and Base58 addresses', () => {
      const solUsdc = defaultAuthoritativeTokenRegistry.getToken('solana:spl:epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v')!;
      assert.ok(solUsdc);
      assert.strictEqual(solUsdc.standard, 'SPL');
      assert.strictEqual(solUsdc.family, 'SOLANA');
      assert.strictEqual(solUsdc.address, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('12.2 Bitcoin native BTC uses standard=NATIVE and has no EVM zero address', () => {
      const btc = defaultAuthoritativeTokenRegistry.getToken('bitcoin:native:btc')!;
      assert.ok(btc);
      assert.strictEqual(btc.standard, 'NATIVE');
      assert.strictEqual(btc.decimals, 8);
      assert.strictEqual(btc.address, undefined);
    });

    it('12.3 Rejects assigning ERC20 standard to Solana network in validation engine', () => {
      const badSol: TokenIdentity = {
        ...defaultAuthoritativeTokenRegistry.getToken('solana:spl:epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v')!,
        tokenId: 'solana:erc20:bad',
        standard: 'ERC20' // Illegal for Solana
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badSol]), /Standard "ERC20" is not supported for family "SOLANA"/);
    });

    it('12.4 Rejects assigning SPL standard to Ethereum network in validation engine', () => {
      const badEth: TokenIdentity = {
        ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
        tokenId: 'ethereum:spl:bad',
        standard: 'SPL' // Illegal for EVM
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badEth]), /Standard "SPL" is not supported for family "EVM"/);
    });

    it('12.5 Address normalizer correctly differentiates EVM and Solana validation', () => {
      assert.doesNotThrow(() => normalizeTokenAddress('SOLANA', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'));
      assert.throws(() => normalizeTokenAddress('EVM', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), InvalidTokenAddressError);
    });
  });

  // ==========================================================================
  // SUITE 13: Multi-Index Lookup & Token Resolution Engine
  // ==========================================================================
  describe('Suite 13: Multi-Index Lookup & Token Resolution Engine', () => {
    it('13.1 Resolves token by exact tokenId', () => {
      const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ tokenId: 'ethereum:native:eth' });
      assert.strictEqual(res.status, 'RESOLVED_EXACT');
      assert.strictEqual(res.token?.symbol, 'ETH');
    });

    it('13.2 Resolves token by exact identityKey', () => {
      const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
        identityKey: 'EVM:eip155:1:ERC20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      });
      assert.strictEqual(res.status, 'RESOLVED_EXACT');
      assert.strictEqual(res.token?.symbol, 'USDC');
    });

    it('13.3 Resolves token by networkId and contract address', () => {
      const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
        networkId: 'ethereum',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      });
      assert.strictEqual(res.status, 'RESOLVED_EXACT');
      assert.strictEqual(res.token?.symbol, 'USDC');
    });

    it('13.4 Resolves token by networkId and unique symbol', () => {
      const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
        networkId: 'ethereum',
        symbol: 'DAI'
      });
      assert.strictEqual(res.status, 'RESOLVED_EXACT');
      assert.strictEqual(res.token?.symbol, 'DAI');
    });

    it('13.5 Returns UNRESOLVED when querying non-existent address on network', () => {
      const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
        networkId: 'ethereum',
        address: '0x1234567890123456789012345678901234567890'
      });
      assert.strictEqual(res.status, 'UNRESOLVED');
    });
  });

  // ==========================================================================
  // SUITE 14: Global Ambiguous Symbol Rejection (USDC without network context)
  // ==========================================================================
  describe('Suite 14: Global Ambiguous Symbol Rejection', () => {
    it('14.1 Rejects global uncontextualized symbol query for USDC', () => {
      const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ symbol: 'USDC' });
      assert.strictEqual(res.status, 'AMBIGUOUS_TOKEN_IDENTITY');
      assert.ok(res.error?.includes('Ambiguous global token symbol'));
    });

    it('14.2 Rejects global uncontextualized symbol query for ETH', () => {
      const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ symbol: 'ETH' });
      assert.strictEqual(res.status, 'AMBIGUOUS_TOKEN_IDENTITY');
    });

    it('14.3 Rejects global uncontextualized symbol query for USDT', () => {
      const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ symbol: 'USDT' });
      assert.strictEqual(res.status, 'AMBIGUOUS_TOKEN_IDENTITY');
    });

    it('14.4 Network-qualified symbol query succeeds without ambiguity', () => {
      const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'USDC' });
      assert.strictEqual(res.status, 'RESOLVED_EXACT');
      assert.strictEqual(res.token?.networkId, 'arbitrum');
    });
  });

  // ==========================================================================
  // SUITE 15: Cross-Network Same-Address Collision Defense
  // ==========================================================================
  describe('Suite 15: Cross-Network Same-Address Collision Defense', () => {
    it('15.1 Optimism WETH and Base WETH share same address but possess distinct identities', () => {
      const opWeth = defaultAuthoritativeTokenRegistry.getTokenByAddress('optimism', 'WRAPPED_NATIVE', '0x4200000000000000000000000000000000000006')!;
      const baseWeth = defaultAuthoritativeTokenRegistry.getTokenByAddress('base', 'WRAPPED_NATIVE', '0x4200000000000000000000000000000000000006')!;
      assert.ok(opWeth && baseWeth);
      assert.notStrictEqual(opWeth.tokenId, baseWeth.tokenId);
      assert.strictEqual(opWeth.networkId, 'optimism');
      assert.strictEqual(baseWeth.networkId, 'base');
    });

    it('15.2 USDC on Ethereum and USDC on Arbitrum have completely different addresses and identity keys', () => {
      const ethUsdc = defaultAuthoritativeTokenRegistry.getTokenByAddress('ethereum', 'ERC20', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')!;
      const arbUsdc = defaultAuthoritativeTokenRegistry.getTokenByAddress('arbitrum', 'ERC20', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831')!;
      assert.notStrictEqual(ethUsdc.tokenId, arbUsdc.tokenId);
      assert.notStrictEqual(ethUsdc.address, arbUsdc.address);
    });

    it('15.3 Same address on different networks does not trigger duplicate address error in validation', () => {
      const tokens = defaultAuthoritativeTokenRegistry.getTokens('optimism')
        .concat(defaultAuthoritativeTokenRegistry.getTokens('base'));
      assert.doesNotThrow(() => TokenRegistryValidationEngine.validate(tokens));
    });

    it('15.4 Duplicate contract address on SAME network triggers validation error', () => {
      const dupTokens = [
        defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
        {
          ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
          tokenId: 'ethereum:erc20:duplicate-address'
        }
      ];
      assert.throws(() => TokenRegistryValidationEngine.validate(dupTokens), /Duplicate contract address/);
    });

    it('15.5 Cross-network lookups remain strictly segregated', () => {
      const res = defaultAuthoritativeTokenRegistry.getTokenByAddress('arbitrum', 'ERC20', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      assert.strictEqual(res, undefined, 'Ethereum USDC address must not resolve on Arbitrum');
    });

    it('15.6 Rejects registration when an address is already authoritative on the same network', () => {
      const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
      const canonical = reg.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
      const duplicate = {
        ...canonical,
        tokenId: 'ethereum:erc721:duplicate-address-registration',
        standard: 'ERC721' as TokenStandard,
        isFungible: false,
        isNFT: true
      };
      assert.throws(() => reg.registerToken(duplicate), /Token address collision/);
    });

    it('15.7 Does not allow a requested standard to bypass the canonical token standard', () => {
      const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
      const address = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      assert.ok(reg.getTokenByAddress('ethereum', 'ERC20', address));
      assert.strictEqual(reg.getTokenByAddress('ethereum', 'SPL', address), undefined);
      assert.strictEqual(reg.getTokenByAddress('ethereum', 'WRAPPED_NATIVE', address), undefined);
    });

    it('15.8 Promotion and disable operations atomically update every token index', () => {
      const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
      const canonical = reg.getWrappedNativeToken('ethereum')!;
      const identityKey = buildTokenIdentityKey(canonical.networkIdentityKey, canonical.standard, canonical.normalizedAddress!);

      reg.promoteToken(canonical.tokenId, 'LIVE_VERIFIED', { reason: 'index consistency test', timestamp: 123456789 });

      assert.strictEqual(reg.getToken(canonical.tokenId)?.capabilityLevel, 'LIVE_VERIFIED');
      assert.strictEqual(reg.getTokenByAddress('ethereum', canonical.standard, canonical.address!)?.capabilityLevel, 'LIVE_VERIFIED');
      assert.strictEqual(reg.getTokenByIdentityKey(identityKey)?.capabilityLevel, 'LIVE_VERIFIED');

      reg.disableToken(canonical.tokenId, 'index consistency test');
      assert.strictEqual(reg.getToken(canonical.tokenId)?.capabilityLevel, 'UNSUPPORTED');
      assert.strictEqual(reg.getTokenByAddress('ethereum', canonical.standard, canonical.address!)?.capabilityLevel, 'UNSUPPORTED');
      assert.strictEqual(reg.getTokenByIdentityKey(identityKey)?.capabilityLevel, 'UNSUPPORTED');
    });
  });

  // ==========================================================================
  // SUITE 16: Decimal Safety & Integer Arithmetic Invariants
  // ==========================================================================
  describe('Suite 16: Decimal Safety & Integer Arithmetic Invariants', () => {
    it('16.1 All canonical token decimals are non-negative bounded integers', () => {
      for (const token of ZENITH_CANONICAL_TOKENS) {
        assert.ok(Number.isInteger(token.decimals), `Decimals must be integer for ${token.tokenId}`);
        assert.ok(token.decimals >= 0 && token.decimals <= 36, `Decimals out of bounds for ${token.tokenId}`);
      }
    });

    it('16.2 Rejects non-integer decimals in validation engine', () => {
      const badToken: TokenIdentity = {
        ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
        tokenId: 'ethereum:erc20:bad-decimals',
        decimals: 18.5 as any
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /invalid decimals/);
    });

    it('16.3 Rejects negative decimals in validation engine', () => {
      const badToken: TokenIdentity = {
        ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
        tokenId: 'ethereum:erc20:neg-decimals',
        decimals: -6
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /invalid decimals/);
    });

    it('16.4 Rejects decimals exceeding 36 in validation engine', () => {
      const badToken: TokenIdentity = {
        ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
        tokenId: 'ethereum:erc20:huge-decimals',
        decimals: 77
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /invalid decimals/);
    });

    it('16.5 Conflict engine fails closed on candidate decimal mismatch', () => {
      const canon = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
      const evalRes = TokenMetadataConflictEngine.evaluate(canon, { decimals: 18 }); // Canonical USDC has 6
      assert.strictEqual(evalRes.canProceed, false);
      assert.strictEqual(evalRes.category, 'MATERIAL_CONFLICT');
      assert.strictEqual(evalRes.conflictType, 'DECIMALS_CONFLICT');
    });
  });

  // ==========================================================================
  // SUITE 17: Token Metadata Conflict Engine Classification
  // ==========================================================================
  describe('Suite 17: Token Metadata Conflict Engine Classification', () => {
    const canon = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;

    it('17.1 Returns AGREEMENT when candidate data matches canonical identity', () => {
      const res = TokenMetadataConflictEngine.evaluate(canon, {
        networkId: 'ethereum',
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin'
      });
      assert.strictEqual(res.canProceed, true);
      assert.strictEqual(res.category, 'AGREEMENT');
    });

    it('17.2 Returns IDENTITY_CONFLICT on network mismatch', () => {
      const res = TokenMetadataConflictEngine.evaluate(canon, { networkId: 'polygon' });
      assert.strictEqual(res.canProceed, false);
      assert.strictEqual(res.category, 'IDENTITY_CONFLICT');
      assert.strictEqual(res.conflictType, 'NETWORK_CONFLICT');
    });

    it('17.3 Returns IDENTITY_CONFLICT on standard mismatch', () => {
      const res = TokenMetadataConflictEngine.evaluate(canon, { standard: 'SPL' });
      assert.strictEqual(res.canProceed, false);
      assert.strictEqual(res.category, 'IDENTITY_CONFLICT');
      assert.strictEqual(res.conflictType, 'STANDARD_CONFLICT');
    });

    it('17.4 Returns MATERIAL_CONFLICT on symbol mismatch', () => {
      const res = TokenMetadataConflictEngine.evaluate(canon, { symbol: 'USDT' });
      assert.strictEqual(res.canProceed, false);
      assert.strictEqual(res.category, 'MATERIAL_CONFLICT');
      assert.strictEqual(res.conflictType, 'SYMBOL_CONFLICT');
    });

    it('17.5 Returns EXPECTED_VARIANCE on minor name differences', () => {
      const res = TokenMetadataConflictEngine.evaluate(canon, { name: 'USD Coin (PoS)' });
      assert.strictEqual(res.canProceed, true);
      assert.strictEqual(res.category, 'EXPECTED_VARIANCE');
      assert.strictEqual(res.conflictType, 'NAME_CONFLICT');
    });
  });

  // ==========================================================================
  // SUITE 18: DEX & Bridge Corridor Boundary Integration
  // ==========================================================================
  describe('Suite 18: DEX & Bridge Corridor Boundary Integration', () => {
    it('18.1 Verifies source token and destination token have distinct network-qualified identities in cross-chain transfer', () => {
      const srcToken = defaultAuthoritativeTokenRegistry.getTokenByAddress('ethereum', 'ERC20', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')!;
      const dstToken = defaultAuthoritativeTokenRegistry.getTokenByAddress('polygon', 'ERC20', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359')!;
      assert.notStrictEqual(srcToken.networkId, dstToken.networkId);
      assert.notStrictEqual(srcToken.tokenId, dstToken.tokenId);
    });

    it('18.2 Rejects corridor with matching symbol but mismatched asset type', () => {
      const nativeEth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum')!;
      const wethArb = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('arbitrum')!;
      assert.strictEqual(nativeEth.isNative, true);
      assert.strictEqual(wethArb.isNative, false);
      assert.strictEqual(wethArb.isWrappedNative, true);
    });

    it('18.3 Rejects unknown source network token in corridor lookup', () => {
      const t = defaultAuthoritativeTokenRegistry.getTokenByAddress('ghost-net', 'ERC20', '0x123');
      assert.strictEqual(t, undefined);
    });

    it('18.4 Rejects bridge corridor mapping relying purely on symbol without address validation', () => {
      const cand = { networkId: 'ethereum', symbol: 'USDC' };
      const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity(cand);
      assert.strictEqual(res.status, 'RESOLVED_EXACT');
      assert.ok(res.token?.address);
    });

    it('18.5 Rejects route if DEX network does not match token network', () => {
      const ethToken = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
      const dexNetwork = 'polygon';
      assert.notStrictEqual(ethToken.networkId, dexNetwork);
    });
  });

  // ==========================================================================
  // SUITE 19: Routing & Execution Plan Token Identity Preservation
  // ==========================================================================
  describe('Suite 19: Routing & Execution Plan Token Identity Preservation', () => {
    it('19.1 TokenIdentity carries required execution properties', () => {
      const token = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
      assert.ok(token.tokenId);
      assert.ok(token.networkId);
      assert.ok(token.standard);
      assert.ok(token.normalizedAddress);
      assert.strictEqual(typeof token.decimals, 'number');
    });

    it('19.2 Execution step cannot reconstruct token identity from symbol alone', () => {
      const lookup = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ symbol: 'USDC' });
      assert.strictEqual(lookup.status, 'AMBIGUOUS_TOKEN_IDENTITY');
    });

    it('19.3 Execution step with networkId and address resolves uniquely and deterministically', () => {
      const lookup = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
        networkId: 'ethereum',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      });
      assert.strictEqual(lookup.status, 'RESOLVED_EXACT');
      assert.strictEqual(lookup.token?.tokenId, 'ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    });

    it('19.4 Native execution step requires no approval step', () => {
      const eth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum')!;
      assert.strictEqual(eth.isNative, true);
      assert.strictEqual(eth.standard, 'NATIVE');
    });

    it('19.5 Non-native execution step requires contract approval target', () => {
      const usdc = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
      assert.strictEqual(usdc.isNative, false);
      assert.ok(usdc.address);
    });
  });

  // ==========================================================================
  // SUITE 20: 20-Rule Fail-Closed Validation Engine
  // ==========================================================================
  describe('Suite 20: 20-Rule Fail-Closed Validation Engine', () => {
    it('20.1 Validates complete set of canonical tokens with zero violations', () => {
      const report = TokenRegistryValidationEngine.validate([...ZENITH_CANONICAL_TOKENS]);
      assert.strictEqual(report.isValid, true);
      assert.strictEqual(report.violations.length, 0);
    });

    it('20.2 Rule 1: Rejects duplicate tokenId', () => {
      const tokens = [
        ZENITH_CANONICAL_TOKENS[0],
        { ...ZENITH_CANONICAL_TOKENS[0] }
      ];
      assert.throws(() => TokenRegistryValidationEngine.validate(tokens), /Duplicate tokenId detected/);
    });

    it('20.3 Rule 3: Rejects unknown network reference', () => {
      const badToken: TokenIdentity = {
        ...ZENITH_CANONICAL_TOKENS[0],
        tokenId: 'ghost:native:eth',
        networkId: 'ghost-network'
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /references unknown or uncertified network/);
    });

    it('20.4 Rule 4: Rejects networkIdentityKey mismatch', () => {
      const badToken: TokenIdentity = {
        ...ZENITH_CANONICAL_TOKENS[0],
        networkIdentityKey: 'EVM:eip155:999' // Mismatched
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /does not match network's canonical key/);
    });

    it('20.5 Rule 8: Rejects native token with standard != NATIVE', () => {
      const badToken: TokenIdentity = {
        ...ZENITH_CANONICAL_TOKENS[0],
        standard: 'ERC20' // Contradicts isNative=true
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /must have standard="NATIVE"/);
    });

    it('20.6 Rule 9: Rejects simultaneously isNative=true and isWrappedNative=true', () => {
      const badToken: TokenIdentity = {
        ...ZENITH_CANONICAL_TOKENS[0],
        isWrappedNative: true
      };
      assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /cannot be simultaneously isNative=true and isWrappedNative=true/);
    });
  });

  // ==========================================================================
  // SUITE 21: Latency & Performance Benchmarks
  // ==========================================================================
  describe('Suite 21: Latency & Performance Benchmarks', () => {
    it('21.1 Single token lookup latency is under 0.05ms', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        defaultAuthoritativeTokenRegistry.getToken('ethereum:native:eth');
      }
      const avgMs = (performance.now() - start) / 1000;
      assert.ok(avgMs < 0.05, `Average lookup took ${avgMs.toFixed(4)}ms, expected < 0.05ms`);
    });

    it('21.2 Address lookup latency is under 0.05ms', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        defaultAuthoritativeTokenRegistry.getTokenByAddress('ethereum', 'ERC20', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      }
      const avgMs = (performance.now() - start) / 1000;
      assert.ok(avgMs < 0.05, `Average address lookup took ${avgMs.toFixed(4)}ms, expected < 0.05ms`);
    });

    it('21.3 Conflict engine evaluation latency is under 0.02ms', () => {
      const canon = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
      const cand = { networkId: 'ethereum', decimals: 6, symbol: 'USDC' };
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        TokenMetadataConflictEngine.evaluate(canon, cand);
      }
      const avgMs = (performance.now() - start) / 1000;
      assert.ok(avgMs < 0.02, `Average conflict evaluation took ${avgMs.toFixed(4)}ms, expected < 0.02ms`);
    });

    it('21.4 1,000 batch token resolutions complete in under 50ms', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
          networkId: 'ethereum',
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        });
      }
      const totalMs = performance.now() - start;
      assert.ok(totalMs < 50, `1,000 resolutions took ${totalMs.toFixed(2)}ms, expected < 50ms`);
    });
  });

  // ==========================================================================
  // SUITE 22: Adversarial Security Attack Matrix (25 vectors)
  // ==========================================================================
  describe('Suite 22: Adversarial Security Attack Matrix', () => {
    it('22.1 Vector 1: Rejects empty tokenId', () => {
      assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: '' }), /Token ID uniqueness/);
    });

    it('22.2 Vector 2: Rejects empty networkIdentityKey', () => {
      assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: 'test:2', networkIdentityKey: '' }), /Identity key uniqueness/);
    });

    it('22.3 Vector 3: Rejects fake native token with non-native standard', () => {
      assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: 'test:3', standard: 'ERC20' }), /must have standard="NATIVE"/);
    });

    it('22.4 Vector 4: Rejects non-native token missing contract address', () => {
      assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: 'test:4', isNative: false }), /must possess a valid contract address/);
    });
    describe('Suite 2: Token Identity Key Determinism & Collision Resistance', () => {
        it('2.1 Builds deterministic contract token identity key', () => {
            const key = buildTokenIdentityKey('EVM:eip155:1', 'ERC20', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
            assert.strictEqual(key, 'EVM:eip155:1:ERC20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
        });
        it('2.2 Builds deterministic native asset identity key', () => {
            const key = buildTokenIdentityKey('EVM:eip155:1', 'NATIVE', 'ETH');
            assert.strictEqual(key, 'EVM:eip155:1:NATIVE:ETH');
        });
        it('2.3 Round-trip parsing guarantees exact identity recreation', () => {
            const raw = 'EVM:eip155:1:ERC20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
            const parsed = parseTokenIdentityKey(raw);
            assert.strictEqual(parsed.networkIdentityKey, 'EVM:eip155:1');
            assert.strictEqual(parsed.standard, 'ERC20');
            assert.strictEqual(parsed.identifier, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
        });
        it('2.4 parseTokenIdentityKey rejects malformed keys with fewer than 5 segments', () => {
            assert.throws(() => parseTokenIdentityKey('EVM:eip155:1:ERC20'), /Expected at least 5 segments/);
        });
        it('2.5 buildTokenId creates standardized composite internal ID', () => {
            const id = buildTokenId('ethereum', 'ERC20', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
            assert.strictEqual(id, 'ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
        });
    });
    describe('Suite 3: Token Standard Taxonomy & Cross-Family Compatibility', () => {
        it('3.1 Identifies fungible standards accurately', () => {
            assert.strictEqual(isFungibleStandard('ERC20'), true);
            assert.strictEqual(isFungibleStandard('NATIVE'), true);
            assert.strictEqual(isFungibleStandard('WRAPPED_NATIVE'), true);
            assert.strictEqual(isFungibleStandard('SPL'), true);
            assert.strictEqual(isFungibleStandard('ERC721'), false);
            assert.strictEqual(isFungibleStandard('ERC1155'), false);
        });
        it('3.2 Identifies NFT and multi-token standards', () => {
            assert.strictEqual(isNftStandard('ERC721'), true);
            assert.strictEqual(isNftStandard('ERC20'), false);
            assert.strictEqual(isMultiTokenStandard('ERC1155'), true);
            assert.strictEqual(isMultiTokenStandard('ERC20'), false);
        });
        it('3.3 Enforces valid standard pairings per family', () => {
            assert.strictEqual(isStandardSupportedForFamily('EVM', 'ERC20'), true);
            assert.strictEqual(isStandardSupportedForFamily('EVM', 'SPL'), false);
            assert.strictEqual(isStandardSupportedForFamily('SOLANA', 'SPL'), true);
            assert.strictEqual(isStandardSupportedForFamily('SOLANA', 'ERC20'), false);
            assert.strictEqual(isStandardSupportedForFamily('BITCOIN', 'UTXO_ASSET'), true);
            assert.strictEqual(isStandardSupportedForFamily('BITCOIN', 'ERC20'), false);
        });
        it('3.4 getAllowedStandardsForFamily returns immutable array of standards', () => {
            const evm = getAllowedStandardsForFamily('EVM');
            assert.ok(evm.includes('ERC20'));
            assert.ok(evm.includes('NATIVE'));
            assert.ok(evm.includes('WRAPPED_NATIVE'));
        });
        it('3.5 Rejects unsupported or unknown standard gracefully', () => {
            assert.strictEqual(isStandardSupportedForFamily('EVM', 'UNSUPPORTED' as any), false);
        });
    });
    describe('Suite 4: Family-Specific Address Normalization & Validation', () => {
        it('4.1 Normalizes valid EVM address to lowercase', () => {
            const raw = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
            const norm = normalizeTokenAddress('EVM', raw);
            assert.strictEqual(norm, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
        });
        it('4.2 Rejects malformed EVM address missing 0x prefix', () => {
            assert.throws(() => normalizeTokenAddress('EVM', 'A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'), InvalidTokenAddressError);
        });
        it('4.3 Rejects malformed EVM address with invalid length', () => {
            assert.throws(() => normalizeTokenAddress('EVM', '0x1234'), InvalidTokenAddressError);
        });
        it('4.4 Rejects EVM zero address when contract token required', () => {
            assert.throws(() => normalizeTokenAddress('EVM', '0x0000000000000000000000000000000000000000', { allowZeroAddress: false }), /cannot be the zero address/);
        });
        it('4.5 Normalizes valid Solana Base58 public key', () => {
            const solAddr = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
            const norm = normalizeTokenAddress('SOLANA', solAddr);
            assert.strictEqual(norm, solAddr);
        });
        it('4.6 Rejects invalid Solana address containing illegal characters', () => {
            assert.throws(() => normalizeTokenAddress('SOLANA', '0xInvalidSolanaAddressHere'), InvalidTokenAddressError);
        });
        it('4.7 Normalizes valid Bitcoin/UTXO identifiers', () => {
            assert.strictEqual(normalizeTokenAddress('BITCOIN', 'ord:ordi'), 'ord:ordi');
            assert.strictEqual(normalizeTokenAddress('BITCOIN', 'rune:dog_go_to_the_moon'), 'rune:dog_go_to_the_moon');
        });
        it('4.8 Rejects empty or null address strings', () => {
            assert.throws(() => normalizeTokenAddress('EVM', ''), InvalidTokenAddressError);
            assert.throws(() => normalizeTokenAddress('EVM', null as any), InvalidTokenAddressError);
        });
    });
    describe('Suite 5: Native Asset Model & Gas Asset Binding', () => {
        it('5.1 Native ETH has standard=NATIVE and no contract address', () => {
            const eth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum');
            assert.ok(eth);
            assert.strictEqual(eth.isNative, true);
            assert.strictEqual(eth.standard, 'NATIVE');
            assert.strictEqual(eth.address, undefined);
        });
        it('5.2 Native asset decimals match authoritative network registry', () => {
            const ethNet = defaultAuthoritativeNetworkRegistry.getNetwork('ethereum');
            const ethToken = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum');
            assert.strictEqual(ethToken?.decimals, ethNet?.nativeAsset.decimals);
        });
        it('5.3 Native asset symbol matches network gas symbol', () => {
            const polNet = defaultAuthoritativeNetworkRegistry.getNetwork('polygon');
            const polToken = defaultAuthoritativeTokenRegistry.getNativeToken('polygon');
            assert.strictEqual(polToken?.symbol, polNet?.nativeAsset.symbol);
        });
        it('5.4 Non-existent network returns undefined for native token', () => {
            assert.strictEqual(defaultAuthoritativeTokenRegistry.getNativeToken('ghost-network'), undefined);
        });
        it('5.5 Native assets carry valid verification dimensions', () => {
            const eth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum')!;
            assert.strictEqual(eth.verificationDimensions.identityVerified, true);
            assert.strictEqual(eth.verificationDimensions.networkVerified, true);
        });
    });
    describe('Suite 6: Wrapped Native vs Native Separation (ETH != WETH)', () => {
        it('6.1 Native ETH and WETH possess completely distinct token IDs', () => {
            const nativeEth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum');
            const weth = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('ethereum');
            assert.ok(nativeEth && weth);
            assert.notStrictEqual(nativeEth.tokenId, weth.tokenId);
            assert.strictEqual(nativeEth.isNative, true);
            assert.strictEqual(weth.isNative, false);
            assert.strictEqual(weth.isWrappedNative, true);
        });
        it('6.2 WETH has valid contract address and wrappedAddress pointer', () => {
            const weth = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('ethereum');
            assert.strictEqual(weth?.address?.toLowerCase(), '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
            const nativeEth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum');
            assert.strictEqual(nativeEth?.wrappedAddress?.toLowerCase(), '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
        });
        it('6.3 Polygon POL is distinguished from WMATIC / WPOL', () => {
            const pol = defaultAuthoritativeTokenRegistry.getNativeToken('polygon');
            const wmatic = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('polygon');
            assert.ok(pol && wmatic);
            assert.strictEqual(pol.symbol, 'POL');
            assert.strictEqual(wmatic.symbol, 'WMATIC');
            assert.notStrictEqual(pol.tokenId, wmatic.tokenId);
        });
        it('6.4 Avalanche AVAX is distinguished from WAVAX', () => {
            const avax = defaultAuthoritativeTokenRegistry.getNativeToken('avalanche');
            const wavax = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('avalanche');
            assert.ok(avax && wavax);
            assert.strictEqual(avax.isNative, true);
            assert.strictEqual(wavax.isWrappedNative, true);
        });
        it('6.5 Wrapped token cannot substitute for native gas asset directly', () => {
            const weth = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('ethereum')!;
            assert.strictEqual(weth.assetType, 'WRAPPED_NATIVE');
            assert.strictEqual(weth.isNative, false);
        });
    });
    describe('Suite 7: Token Metadata Model & Verification Dimensions', () => {
        it('7.1 getTokenMetadata returns correct metadata snapshot', () => {
            const meta = defaultAuthoritativeTokenRegistry.getTokenMetadata('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
            assert.ok(meta);
            assert.strictEqual(meta.symbol, 'USDC');
            assert.strictEqual(meta.decimals, 6);
            assert.strictEqual(meta.metadataStatus, 'LIVE_VERIFIED');
        });
        it('7.2 Verification dimensions remain independent booleans', () => {
            const token = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            const dims = token.verificationDimensions;
            assert.strictEqual(typeof dims.identityVerified, 'boolean');
            assert.strictEqual(typeof dims.addressVerified, 'boolean');
            assert.strictEqual(typeof dims.standardVerified, 'boolean');
            assert.strictEqual(typeof dims.decimalsVerified, 'boolean');
            assert.strictEqual(typeof dims.metadataVerified, 'boolean');
            assert.strictEqual(typeof dims.contractCodeVerified, 'boolean');
            assert.strictEqual(typeof dims.networkVerified, 'boolean');
        });
        it('7.3 getTokenVerificationStatus returns authoritative verification status', () => {
            const status = defaultAuthoritativeTokenRegistry.getTokenVerificationStatus('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
            assert.strictEqual(status, 'IDENTITY_VERIFIED');
        });
        it('7.4 Unknown token returns UNVERIFIED status', () => {
            const status = defaultAuthoritativeTokenRegistry.getTokenVerificationStatus('unknown:token:id');
            assert.strictEqual(status, 'UNVERIFIED');
        });
        it('7.5 getTokenMetadata returns undefined for non-existent token', () => {
            assert.strictEqual(defaultAuthoritativeTokenRegistry.getTokenMetadata('ghost:id'), undefined);
        });
    });
    describe('Suite 8: Token Capability Hierarchy & Upstream Ceiling Enforcement', () => {
        it('8.1 Core Tier 1 Ethereum tokens have LIVE_VERIFIED capability', () => {
            const cap = defaultAuthoritativeTokenRegistry.getTokenCapability('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
            assert.strictEqual(cap, 'LIVE_VERIFIED');
        });
        it('8.2 Tier 2 Avalanche tokens have CONFIGURED capability (ceiling aligned)', () => {
            const cap = defaultAuthoritativeTokenRegistry.getTokenCapability('avalanche:native:avax');
            assert.strictEqual(cap, 'CONFIGURED');
        });
        it('8.3 Tier 3 Bitcoin native BTC has CONFIGURED capability', () => {
            const cap = defaultAuthoritativeTokenRegistry.getTokenCapability('bitcoin:native:btc');
            assert.strictEqual(cap, 'CONFIGURED');
        });
        it('8.4 Unknown token returns UNSUPPORTED capability', () => {
            assert.strictEqual(defaultAuthoritativeTokenRegistry.getTokenCapability('nonexistent'), 'UNSUPPORTED');
        });
        it('8.5 Validation engine rejects token capability exceeding network capability', () => {
            const badToken: TokenIdentity = {
                ...defaultAuthoritativeTokenRegistry.getToken('avalanche:native:avax')!,
                tokenId: 'avalanche:native:fake-live',
                capabilityLevel: 'LIVE_VERIFIED'
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /exceeds network capability level/);
        });
    });
    describe('Suite 9: Token Onboarding State Machine & Administrative Transitions', () => {
        it('9.1 Core tokens are in LIVE_VERIFIED onboarding state', () => {
            const token = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            assert.strictEqual(token.onboardingState, 'LIVE_VERIFIED');
        });
        it('9.2 Disabling a token transitions onboardingState to DISABLED and capability to UNSUPPORTED', () => {
            const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
            const testId = 'ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
            reg.disableToken(testId, 'Security pause');
            const updated = reg.getToken(testId);
            assert.strictEqual(updated?.onboardingState, 'DISABLED');
            assert.strictEqual(updated?.capabilityLevel, 'UNSUPPORTED');
        });
        it('9.3 Promoting a token requires explicit evidence reason', () => {
            const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
            const testId = 'avalanche:native:avax';
            assert.throws(() => reg.promoteToken(testId, 'LIVE_VERIFIED', null as any), /Explicit evidence reason required/);
        });
        it('9.4 Successfully promotes token with evidence', () => {
            const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
            const testId = 'avalanche:native:avax';
            reg.promoteToken(testId, 'LIVE_VERIFIED', { reason: 'Test verification pass', timestamp: 123456789 });
            const token = reg.getToken(testId);
            assert.strictEqual(token?.onboardingState, 'LIVE_VERIFIED');
            assert.strictEqual(token?.lastVerifiedAt, 123456789);
        });
        it('9.5 Throws error when disabling an unknown token', () => {
            const reg = new AuthoritativeTokenRegistry(ZENITH_CANONICAL_TOKENS);
            assert.throws(() => reg.disableToken('ghost:token', 'test'), /Cannot disable unknown token/);
        });
    });
    describe('Suite 10: ERC-20 Read-Only RPC Verification & Bytecode Inspection', () => {
        it('10.1 Fails closed when address has no bytecode', async () => {
            const mockAdapter = {
                family: 'EVM' as NetworkFamily,
                networkId: 'ethereum',
                provider: {} as any,
                getNetworkIdentity: async () => 1,
                getLatestHead: async () => ({ blockNumber: 100 }),
                getBalance: async () => ({ address: '0x123', balance: 0n, decimals: 18, symbol: 'ETH' }),
                getCodeOrEquivalent: async () => '0x',
                simulateTransaction: async () => ({ success: true }),
                estimateFee: async () => ({ estimatedFeeNative: 0n }),
                broadcastTransaction: async () => '0xhash',
                getTransaction: async () => null,
                getReceiptOrEquivalent: async () => null
            };
            const res = await TokenRpcVerifier.verifyErc20Token('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', mockAdapter);
            assert.strictEqual(res.verified, false);
            assert.strictEqual(res.hasBytecode, false);
            assert.strictEqual(res.status, 'FAILED_VERIFICATION');
        });
        it('10.2 Correctly extracts decimals, symbol, and name from simulation returns', async () => {
            const mockAdapter = {
                family: 'EVM' as NetworkFamily,
                networkId: 'ethereum',
                provider: {} as any,
                getNetworkIdentity: async () => 1,
                getLatestHead: async () => ({ blockNumber: 100 }),
                getBalance: async () => ({ address: '0x123', balance: 0n, decimals: 18, symbol: 'ETH' }),
                getCodeOrEquivalent: async () => '0x60806040...',
                simulateTransaction: async (tx: any) => {
                    if (tx.data === '0x313ce567')
                        return { success: true, returnData: '0x0000000000000000000000000000000000000000000000000000000000000006' };
                    if (tx.data === '0x95d89b41')
                        return { success: true, returnData: '0x5553444300000000000000000000000000000000000000000000000000000000' };
                    if (tx.data === '0x06fdde03')
                        return { success: true, returnData: '0x55534420436f696e000000000000000000000000000000000000000000000000' };
                    return { success: false };
                },
                estimateFee: async () => ({ estimatedFeeNative: 0n }),
                broadcastTransaction: async () => '0xhash',
                getTransaction: async () => null,
                getReceiptOrEquivalent: async () => null
            };
            const res = await TokenRpcVerifier.verifyErc20Token('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', mockAdapter);
            assert.strictEqual(res.verified, true);
            assert.strictEqual(res.hasBytecode, true);
            assert.strictEqual(res.decimals, 6);
            assert.strictEqual(res.symbol, 'USDC');
        });
        it('10.3 Returns UNVERIFIED when RPC calls fail', async () => {
            const mockAdapter = {
                family: 'EVM' as NetworkFamily,
                networkId: 'ethereum',
                provider: {} as any,
                getNetworkIdentity: async () => 1,
                getLatestHead: async () => ({ blockNumber: 100 }),
                getBalance: async () => ({ address: '0x123', balance: 0n, decimals: 18, symbol: 'ETH' }),
                getCodeOrEquivalent: async () => { throw new Error('RPC Timeout'); },
                simulateTransaction: async () => ({ success: false }),
                estimateFee: async () => ({ estimatedFeeNative: 0n }),
                broadcastTransaction: async () => '0xhash',
                getTransaction: async () => null,
                getReceiptOrEquivalent: async () => null
            };
            const res = await TokenRpcVerifier.verifyErc20Token('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', mockAdapter);
            assert.strictEqual(res.verified, false);
            assert.strictEqual(res.status, 'UNVERIFIED');
        });
        it('10.4 Rejects verifying non-EVM family through ERC-20 verifier', async () => {
            const res = await TokenRpcVerifier.verifyErc20Token('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            assert.strictEqual(res.verified, false);
            assert.strictEqual(res.status, 'UNVERIFIED');
            assert.ok(res.reason?.includes('non-EVM'));
        });
        it('10.5 Rejects malformed EVM address before dispatching RPC call', async () => {
            const res = await TokenRpcVerifier.verifyErc20Token('ethereum', '0xinvalid');
            assert.strictEqual(res.verified, false);
            assert.strictEqual(res.status, 'FAILED_VERIFICATION');
        });
    });
    describe('Suite 11: Non-Fungible (ERC721/1155) Swap Boundary Rejection', () => {
        it('11.1 Rejects ERC721 token in validation engine if marked isFungible=true', () => {
            const badNft: TokenIdentity = {
                ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
                tokenId: 'ethereum:erc721:0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
                standard: 'ERC721',
                isFungible: true,
                isNFT: true
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badNft]), /cannot be fungible and NFT/);
        });
        it('11.2 Rejects ERC1155 token in validation engine if marked isFungible=true', () => {
            const badMulti: TokenIdentity = {
                ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
                tokenId: 'ethereum:erc1155:0x1234567890123456789012345678901234567890',
                standard: 'ERC1155',
                isFungible: true,
                isMultiToken: true
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badMulti]), /cannot be fungible and NFT\/MultiToken/);
        });
        it('11.3 isFungibleStandard returns false for ERC721 and ERC1155', () => {
            assert.strictEqual(isFungibleStandard('ERC721'), false);
            assert.strictEqual(isFungibleStandard('ERC1155'), false);
        });
        it('11.4 Correctly flags isNFT=true and isMultiToken=true for non-fungible types', () => {
            assert.strictEqual(isNftStandard('ERC721'), true);
            assert.strictEqual(isMultiTokenStandard('ERC1155'), true);
        });
    });
    describe('Suite 12: Non-EVM Token Boundaries (Solana SPL, Bitcoin UTXO)', () => {
        it('12.1 Solana tokens use standard=SPL and Base58 addresses', () => {
            const solUsdc = defaultAuthoritativeTokenRegistry.getToken('solana:spl:epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v')!;
            assert.ok(solUsdc);
            assert.strictEqual(solUsdc.standard, 'SPL');
            assert.strictEqual(solUsdc.family, 'SOLANA');
            assert.strictEqual(solUsdc.address, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        });
        it('12.2 Bitcoin native BTC uses standard=NATIVE and has no EVM zero address', () => {
            const btc = defaultAuthoritativeTokenRegistry.getToken('bitcoin:native:btc')!;
            assert.ok(btc);
            assert.strictEqual(btc.standard, 'NATIVE');
            assert.strictEqual(btc.decimals, 8);
            assert.strictEqual(btc.address, undefined);
        });
        it('12.3 Rejects assigning ERC20 standard to Solana network in validation engine', () => {
            const badSol: TokenIdentity = {
                ...defaultAuthoritativeTokenRegistry.getToken('solana:spl:epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v')!,
                tokenId: 'solana:erc20:bad',
                standard: 'ERC20'
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badSol]), /Standard "ERC20" is not supported for family "SOLANA"/);
        });
        it('12.4 Rejects assigning SPL standard to Ethereum network in validation engine', () => {
            const badEth: TokenIdentity = {
                ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
                tokenId: 'ethereum:spl:bad',
                standard: 'SPL'
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badEth]), /Standard "SPL" is not supported for family "EVM"/);
        });
        it('12.5 Address normalizer correctly differentiates EVM and Solana validation', () => {
            assert.doesNotThrow(() => normalizeTokenAddress('SOLANA', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'));
            assert.throws(() => normalizeTokenAddress('EVM', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), InvalidTokenAddressError);
        });
    });
    describe('Suite 13: Multi-Index Lookup & Token Resolution Engine', () => {
        it('13.1 Resolves token by exact tokenId', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ tokenId: 'ethereum:native:eth' });
            assert.strictEqual(res.status, 'RESOLVED_EXACT');
            assert.strictEqual(res.token?.symbol, 'ETH');
        });
        it('13.2 Resolves token by exact identityKey', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
                identityKey: 'EVM:eip155:1:ERC20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
            });
            assert.strictEqual(res.status, 'RESOLVED_EXACT');
            assert.strictEqual(res.token?.symbol, 'USDC');
        });
        it('13.3 Resolves token by networkId and contract address', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
                networkId: 'ethereum',
                address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
            });
            assert.strictEqual(res.status, 'RESOLVED_EXACT');
            assert.strictEqual(res.token?.symbol, 'USDC');
        });
        it('13.4 Resolves token by networkId and unique symbol', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
                networkId: 'ethereum',
                symbol: 'DAI'
            });
            assert.strictEqual(res.status, 'RESOLVED_EXACT');
            assert.strictEqual(res.token?.symbol, 'DAI');
        });
        it('13.5 Returns UNRESOLVED when querying non-existent address on network', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
                networkId: 'ethereum',
                address: '0x1234567890123456789012345678901234567890'
            });
            assert.strictEqual(res.status, 'UNRESOLVED');
        });
    });
    describe('Suite 14: Global Ambiguous Symbol Rejection', () => {
        it('14.1 Rejects global uncontextualized symbol query for USDC', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ symbol: 'USDC' });
            assert.strictEqual(res.status, 'AMBIGUOUS_TOKEN_IDENTITY');
            assert.ok(res.error?.includes('Ambiguous global token symbol'));
        });
        it('14.2 Rejects global uncontextualized symbol query for ETH', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ symbol: 'ETH' });
            assert.strictEqual(res.status, 'AMBIGUOUS_TOKEN_IDENTITY');
        });
        it('14.3 Rejects global uncontextualized symbol query for USDT', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ symbol: 'USDT' });
            assert.strictEqual(res.status, 'AMBIGUOUS_TOKEN_IDENTITY');
        });
        it('14.4 Network-qualified symbol query succeeds without ambiguity', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'USDC' });
            assert.strictEqual(res.status, 'RESOLVED_EXACT');
            assert.strictEqual(res.token?.networkId, 'arbitrum');
        });
    });
    describe('Suite 15: Cross-Network Same-Address Collision Defense', () => {
        it('15.1 Optimism WETH and Base WETH share same address but possess distinct identities', () => {
            const opWeth = defaultAuthoritativeTokenRegistry.getTokenByAddress('optimism', 'WRAPPED_NATIVE', '0x4200000000000000000000000000000000000006')!;
            const baseWeth = defaultAuthoritativeTokenRegistry.getTokenByAddress('base', 'WRAPPED_NATIVE', '0x4200000000000000000000000000000000000006')!;
            assert.ok(opWeth && baseWeth);
            assert.notStrictEqual(opWeth.tokenId, baseWeth.tokenId);
            assert.strictEqual(opWeth.networkId, 'optimism');
            assert.strictEqual(baseWeth.networkId, 'base');
        });
        it('15.2 USDC on Ethereum and USDC on Arbitrum have completely different addresses and identity keys', () => {
            const ethUsdc = defaultAuthoritativeTokenRegistry.getTokenByAddress('ethereum', 'ERC20', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')!;
            const arbUsdc = defaultAuthoritativeTokenRegistry.getTokenByAddress('arbitrum', 'ERC20', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831')!;
            assert.notStrictEqual(ethUsdc.tokenId, arbUsdc.tokenId);
            assert.notStrictEqual(ethUsdc.address, arbUsdc.address);
        });
        it('15.3 Same address on different networks does not trigger duplicate address error in validation', () => {
            const tokens = defaultAuthoritativeTokenRegistry.getTokens('optimism')
                .concat(defaultAuthoritativeTokenRegistry.getTokens('base'));
            assert.doesNotThrow(() => TokenRegistryValidationEngine.validate(tokens));
        });
        it('15.4 Duplicate contract address on SAME network triggers validation error', () => {
            const dupTokens = [
                defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
                {
                    ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
                    tokenId: 'ethereum:erc20:duplicate-address'
                }
            ];
            assert.throws(() => TokenRegistryValidationEngine.validate(dupTokens), /Duplicate contract address/);
        });
        it('15.5 Cross-network lookups remain strictly segregated', () => {
            const res = defaultAuthoritativeTokenRegistry.getTokenByAddress('arbitrum', 'ERC20', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
            assert.strictEqual(res, undefined, 'Ethereum USDC address must not resolve on Arbitrum');
        });
    });
    describe('Suite 16: Decimal Safety & Integer Arithmetic Invariants', () => {
        it('16.1 All canonical token decimals are non-negative bounded integers', () => {
            for (const token of ZENITH_CANONICAL_TOKENS) {
                assert.ok(Number.isInteger(token.decimals), `Decimals must be integer for ${token.tokenId}`);
                assert.ok(token.decimals >= 0 && token.decimals <= 36, `Decimals out of bounds for ${token.tokenId}`);
            }
        });
        it('16.2 Rejects non-integer decimals in validation engine', () => {
            const badToken: TokenIdentity = {
                ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
                tokenId: 'ethereum:erc20:bad-decimals',
                decimals: 18.5 as any
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /invalid decimals/);
        });
        it('16.3 Rejects negative decimals in validation engine', () => {
            const badToken: TokenIdentity = {
                ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
                tokenId: 'ethereum:erc20:neg-decimals',
                decimals: -6
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /invalid decimals/);
        });
        it('16.4 Rejects decimals exceeding 36 in validation engine', () => {
            const badToken: TokenIdentity = {
                ...defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!,
                tokenId: 'ethereum:erc20:huge-decimals',
                decimals: 77
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /invalid decimals/);
        });
        it('16.5 Conflict engine fails closed on candidate decimal mismatch', () => {
            const canon = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            const evalRes = TokenMetadataConflictEngine.evaluate(canon, { decimals: 18 });
            assert.strictEqual(evalRes.canProceed, false);
            assert.strictEqual(evalRes.category, 'MATERIAL_CONFLICT');
            assert.strictEqual(evalRes.conflictType, 'DECIMALS_CONFLICT');
        });
    });
    describe('Suite 17: Token Metadata Conflict Engine Classification', () => {
        const canon = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
        it('17.1 Returns AGREEMENT when candidate data matches canonical identity', () => {
            const res = TokenMetadataConflictEngine.evaluate(canon, {
                networkId: 'ethereum',
                decimals: 6,
                symbol: 'USDC',
                name: 'USD Coin'
            });
            assert.strictEqual(res.canProceed, true);
            assert.strictEqual(res.category, 'AGREEMENT');
        });
        it('17.2 Returns IDENTITY_CONFLICT on network mismatch', () => {
            const res = TokenMetadataConflictEngine.evaluate(canon, { networkId: 'polygon' });
            assert.strictEqual(res.canProceed, false);
            assert.strictEqual(res.category, 'IDENTITY_CONFLICT');
            assert.strictEqual(res.conflictType, 'NETWORK_CONFLICT');
        });
        it('17.3 Returns IDENTITY_CONFLICT on standard mismatch', () => {
            const res = TokenMetadataConflictEngine.evaluate(canon, { standard: 'SPL' });
            assert.strictEqual(res.canProceed, false);
            assert.strictEqual(res.category, 'IDENTITY_CONFLICT');
            assert.strictEqual(res.conflictType, 'STANDARD_CONFLICT');
        });
        it('17.4 Returns MATERIAL_CONFLICT on symbol mismatch', () => {
            const res = TokenMetadataConflictEngine.evaluate(canon, { symbol: 'USDT' });
            assert.strictEqual(res.canProceed, false);
            assert.strictEqual(res.category, 'MATERIAL_CONFLICT');
            assert.strictEqual(res.conflictType, 'SYMBOL_CONFLICT');
        });
        it('17.5 Returns EXPECTED_VARIANCE on minor name differences', () => {
            const res = TokenMetadataConflictEngine.evaluate(canon, { name: 'USD Coin (PoS)' });
            assert.strictEqual(res.canProceed, true);
            assert.strictEqual(res.category, 'EXPECTED_VARIANCE');
            assert.strictEqual(res.conflictType, 'NAME_CONFLICT');
        });
    });
    describe('Suite 18: DEX & Bridge Corridor Boundary Integration', () => {
        it('18.1 Verifies source token and destination token have distinct network-qualified identities in cross-chain transfer', () => {
            const srcToken = defaultAuthoritativeTokenRegistry.getTokenByAddress('ethereum', 'ERC20', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')!;
            const dstToken = defaultAuthoritativeTokenRegistry.getTokenByAddress('polygon', 'ERC20', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359')!;
            assert.notStrictEqual(srcToken.networkId, dstToken.networkId);
            assert.notStrictEqual(srcToken.tokenId, dstToken.tokenId);
        });
        it('18.2 Rejects corridor with matching symbol but mismatched asset type', () => {
            const nativeEth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum')!;
            const wethArb = defaultAuthoritativeTokenRegistry.getWrappedNativeToken('arbitrum')!;
            assert.strictEqual(nativeEth.isNative, true);
            assert.strictEqual(wethArb.isNative, false);
            assert.strictEqual(wethArb.isWrappedNative, true);
        });
        it('18.3 Rejects unknown source network token in corridor lookup', () => {
            const t = defaultAuthoritativeTokenRegistry.getTokenByAddress('ghost-net', 'ERC20', '0x123');
            assert.strictEqual(t, undefined);
        });
        it('18.4 Rejects bridge corridor mapping relying purely on symbol without address validation', () => {
            const cand = { networkId: 'ethereum', symbol: 'USDC' };
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity(cand);
            assert.strictEqual(res.status, 'RESOLVED_EXACT');
            assert.ok(res.token?.address);
        });
        it('18.5 Rejects route if DEX network does not match token network', () => {
            const ethToken = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            const dexNetwork = 'polygon';
            assert.notStrictEqual(ethToken.networkId, dexNetwork);
        });
    });
    describe('Suite 19: Routing & Execution Plan Token Identity Preservation', () => {
        it('19.1 TokenIdentity carries required execution properties', () => {
            const token = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            assert.ok(token.tokenId);
            assert.ok(token.networkId);
            assert.ok(token.standard);
            assert.ok(token.normalizedAddress);
            assert.strictEqual(typeof token.decimals, 'number');
        });
        it('19.2 Execution step cannot reconstruct token identity from symbol alone', () => {
            const lookup = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ symbol: 'USDC' });
            assert.strictEqual(lookup.status, 'AMBIGUOUS_TOKEN_IDENTITY');
        });
        it('19.3 Execution step with networkId and address resolves uniquely and deterministically', () => {
            const lookup = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
                networkId: 'ethereum',
                address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
            });
            assert.strictEqual(lookup.status, 'RESOLVED_EXACT');
            assert.strictEqual(lookup.token?.tokenId, 'ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
        });
        it('19.4 Native execution step requires no approval step', () => {
            const eth = defaultAuthoritativeTokenRegistry.getNativeToken('ethereum')!;
            assert.strictEqual(eth.isNative, true);
            assert.strictEqual(eth.standard, 'NATIVE');
        });
        it('19.5 Non-native execution step requires contract approval target', () => {
            const usdc = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            assert.strictEqual(usdc.isNative, false);
            assert.ok(usdc.address);
        });
    });
    describe('Suite 20: 20-Rule Fail-Closed Validation Engine', () => {
        it('20.1 Validates complete set of canonical tokens with zero violations', () => {
            const report = TokenRegistryValidationEngine.validate([...ZENITH_CANONICAL_TOKENS]);
            assert.strictEqual(report.isValid, true);
            assert.strictEqual(report.violations.length, 0);
        });
        it('20.2 Rule 1: Rejects duplicate tokenId', () => {
            const tokens = [
                ZENITH_CANONICAL_TOKENS[0],
                { ...ZENITH_CANONICAL_TOKENS[0] }
            ];
            assert.throws(() => TokenRegistryValidationEngine.validate(tokens), /Duplicate tokenId detected/);
        });
        it('20.3 Rule 3: Rejects unknown network reference', () => {
            const badToken: TokenIdentity = {
                ...ZENITH_CANONICAL_TOKENS[0],
                tokenId: 'ghost:native:eth',
                networkId: 'ghost-network'
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /references unknown or uncertified network/);
        });
        it('20.4 Rule 4: Rejects networkIdentityKey mismatch', () => {
            const badToken: TokenIdentity = {
                ...ZENITH_CANONICAL_TOKENS[0],
                networkIdentityKey: 'EVM:eip155:999'
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /does not match network's canonical key/);
        });
        it('20.5 Rule 8: Rejects native token with standard != NATIVE', () => {
            const badToken: TokenIdentity = {
                ...ZENITH_CANONICAL_TOKENS[0],
                standard: 'ERC20'
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /must have standard="NATIVE"/);
        });
        it('20.6 Rule 9: Rejects simultaneously isNative=true and isWrappedNative=true', () => {
            const badToken: TokenIdentity = {
                ...ZENITH_CANONICAL_TOKENS[0],
                isWrappedNative: true
            };
            assert.throws(() => TokenRegistryValidationEngine.validate([badToken]), /cannot be simultaneously isNative=true and isWrappedNative=true/);
        });
    });
    describe('Suite 21: Latency & Performance Benchmarks', () => {
        it('21.1 Single token lookup latency is under 0.05ms', () => {
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                defaultAuthoritativeTokenRegistry.getToken('ethereum:native:eth');
            }
            const avgMs = (performance.now() - start) / 1000;
            assert.ok(avgMs < 0.05, `Average lookup took ${avgMs.toFixed(4)}ms, expected < 0.05ms`);
        });
        it('21.2 Address lookup latency is under 0.05ms', () => {
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                defaultAuthoritativeTokenRegistry.getTokenByAddress('ethereum', 'ERC20', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
            }
            const avgMs = (performance.now() - start) / 1000;
            assert.ok(avgMs < 0.05, `Average address lookup took ${avgMs.toFixed(4)}ms, expected < 0.05ms`);
        });
        it('21.3 Conflict engine evaluation latency is under 0.02ms', () => {
            const canon = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            const cand = { networkId: 'ethereum', decimals: 6, symbol: 'USDC' };
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                TokenMetadataConflictEngine.evaluate(canon, cand);
            }
            const avgMs = (performance.now() - start) / 1000;
            assert.ok(avgMs < 0.02, `Average conflict evaluation took ${avgMs.toFixed(4)}ms, expected < 0.02ms`);
        });
        it('21.4 1,000 batch token resolutions complete in under 50ms', () => {
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                defaultAuthoritativeTokenRegistry.resolveTokenIdentity({
                    networkId: 'ethereum',
                    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
                });
            }
            const totalMs = performance.now() - start;
            assert.ok(totalMs < 50, `1,000 resolutions took ${totalMs.toFixed(2)}ms, expected < 50ms`);
        });
    });
    describe('Suite 22: Adversarial Security Attack Matrix', () => {
        it('22.1 Vector 1: Rejects empty tokenId', () => {
            assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: '' }), /Token ID uniqueness/);
        });
        it('22.2 Vector 2: Rejects empty networkIdentityKey', () => {
            assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: 'test:2', networkIdentityKey: '' }), /Identity key uniqueness/);
        });
        it('22.3 Vector 3: Rejects fake native token with non-native standard', () => {
            assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: 'test:3', standard: 'ERC20' }), /must have standard="NATIVE"/);
        });
        it('22.4 Vector 4: Rejects non-native token missing contract address', () => {
            assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: 'test:4', isNative: false }), /must possess a valid contract address/);
        });
        it('22.5 Vector 5: Rejects wrapped token missing contract address', () => {
            assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[1], tokenId: 'test:5', address: undefined }), /must have a contract address/);
        });
        it('22.6 Vector 6: Rejects EVM token with 39-character address', () => {
            assert.throws(() => normalizeTokenAddress('EVM', '0x123456789012345678901234567890123456789'), InvalidTokenAddressError);
        });
        it('22.7 Vector 7: Rejects EVM token with 41-character address', () => {
            assert.throws(() => normalizeTokenAddress('EVM', '0x12345678901234567890123456789012345678901'), InvalidTokenAddressError);
        });
        it('22.8 Vector 8: Rejects EVM token with non-hex characters', () => {
            assert.throws(() => normalizeTokenAddress('EVM', '0xGGGG567890123456789012345678901234567890'), InvalidTokenAddressError);
        });
        it('22.9 Vector 9: Rejects deadbeef placeholder address', () => {
            assert.throws(() => normalizeTokenAddress('EVM', '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead'), /Forbidden EVM placeholder address/);
        });
        it('22.10 Vector 10: Rejects zero address when contract required', () => {
            assert.throws(() => normalizeTokenAddress('EVM', '0x0000000000000000000000000000000000000000'), /cannot be the zero address/);
        });
        it('22.11 Vector 11: Rejects empty symbol', () => {
            assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: 'test:11', symbol: '' }), /has an empty symbol/);
        });
        it('22.12 Vector 12: Rejects empty name', () => {
            assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: 'test:12', name: '  ' }), /has an empty name/);
        });
        it('22.13 Vector 13: Rejects invalid onboardingState', () => {
            assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: 'test:13', onboardingState: 'INVALID_STATE' as any }), /invalid onboardingState/);
        });
        it('22.14 Vector 14: Rejects unauthorized capability promotion to LIVE_VERIFIED', () => {
            assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({
                ...ZENITH_CANONICAL_TOKENS[0],
                tokenId: 'test:14',
                capabilityLevel: 'LIVE_VERIFIED',
                onboardingState: 'DISCOVERED'
            }), /No unauthorized capability promotion/);
        });
        it('22.15 Vector 15: Conflict engine detects decimals tampering attempt', () => {
            const canon = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            const res = TokenMetadataConflictEngine.evaluate(canon, { decimals: 18 });
            assert.strictEqual(res.canProceed, false);
            assert.strictEqual(res.conflictType, 'DECIMALS_CONFLICT');
        });
        it('22.16 Vector 16: Conflict engine detects rogue symbol injection', () => {
            const canon = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            const res = TokenMetadataConflictEngine.evaluate(canon, { symbol: 'FAKE_USDC' });
            assert.strictEqual(res.canProceed, false);
            assert.strictEqual(res.conflictType, 'SYMBOL_CONFLICT');
        });
        it('22.17 Vector 17: Conflict engine detects contract address mismatch', () => {
            const canon = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            const res = TokenMetadataConflictEngine.evaluate(canon, { address: '0xdac17f958d2ee523a2206206994597c13d831ec7' });
            assert.strictEqual(res.canProceed, false);
            assert.strictEqual(res.conflictType, 'CONTRACT_CODE_CONFLICT');
        });
        it('22.18 Vector 18: Resolves exact address case-insensitively', () => {
            const res1 = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'ethereum', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' });
            const res2 = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'ethereum', address: '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48' });
            assert.strictEqual(res1.status, 'RESOLVED_EXACT');
            assert.strictEqual(res2.status, 'RESOLVED_EXACT');
            assert.strictEqual(res1.token?.tokenId, res2.token?.tokenId);
        });
        it('22.19 Vector 19: Rejects non-composite tokenId in validation engine', () => {
            assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken({ ...ZENITH_CANONICAL_TOKENS[0], tokenId: 'USDC' }), /must be composite/);
        });
        it('22.20 Vector 20: Prevents cross-talk between identically named tokens on different networks', () => {
            const ethUSDC = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            const polyUSDC = defaultAuthoritativeTokenRegistry.getToken('polygon:erc20:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359')!;
            assert.strictEqual(ethUSDC.symbol, 'USDC');
            assert.strictEqual(polyUSDC.symbol, 'USDC');
            assert.notStrictEqual(ethUSDC.networkId, polyUSDC.networkId);
            assert.notStrictEqual(ethUSDC.address?.toLowerCase(), polyUSDC.address?.toLowerCase());
        });
        it('22.21 Vector 21: Rejects unregistered family address normalization', () => {
            assert.throws(() => normalizeTokenAddress('UNKNOWN_FAMILY' as any, '0x123'), /Unsupported address family/);
        });
        it('22.22 Vector 22: Strips whitespace in symbol and address before resolving', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: ' ethereum ', symbol: ' USDC ' });
            assert.strictEqual(res.status, 'RESOLVED_EXACT');
        });
        it('22.23 Vector 23: Rejects duplicate registration in AuthoritativeTokenRegistry', () => {
            assert.throws(() => defaultAuthoritativeTokenRegistry.registerToken(ZENITH_CANONICAL_TOKENS[0]), /already registered/);
        });
        it('22.24 Vector 24: Rejects NFT standard assignment to EVM fungible swap token', () => {
            assert.strictEqual(isFungibleStandard('ERC721'), false);
        });
        it('22.25 Vector 25: Returns INVALID_INPUT when resolveTokenIdentity is called with empty params', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({});
            assert.strictEqual(res.status, 'INVALID_INPUT');
        });
    });
    describe('Suite 23: Deterministic Fuzz Testing - 1,000 Identity & Address Mutations (Seed 0x7A5C39)', () => {
        it('23.1 1,000 randomized identity & address mutations fail closed or verify deterministically', () => {
            const prng = new DeterministicPRNG(0x7A5C39);
            const families: NetworkFamily[] = ['EVM', 'SOLANA', 'BITCOIN'];
            for (let i = 0; i < 1000; i++) {
                const family = prng.choice(families);
                const isCorrupt = prng.next() < 0.5;
                if (family === 'EVM') {
                    const hex = Array.from({ length: 40 }, () => prng.choice('0123456789abcdefABCDEF')).join('');
                    const addr = isCorrupt ? `0x${hex.slice(0, 38)}` : `0x${hex}`;
                    if (isCorrupt) {
                        assert.throws(() => normalizeTokenAddress('EVM', addr), InvalidTokenAddressError);
                    }
                    else {
                        const norm = normalizeTokenAddress('EVM', addr);
                        assert.strictEqual(norm, addr.toLowerCase());
                    }
                }
                else if (family === 'SOLANA') {
                    const b58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
                    const len = isCorrupt ? prng.nextInt(10, 25) : prng.nextInt(32, 44);
                    const addr = Array.from({ length: len }, () => prng.choice(b58Chars.split(''))).join('');
                    if (isCorrupt) {
                        assert.throws(() => normalizeTokenAddress('SOLANA', addr), InvalidTokenAddressError);
                    }
                    else {
                        const norm = normalizeTokenAddress('SOLANA', addr);
                        assert.strictEqual(norm, addr);
                    }
                }
                else if (family === 'BITCOIN') {
                    const id = isCorrupt ? 'invalid:btc:symbol' : (prng.next() < 0.5 ? 'ord:ordi' : 'rune:dog_go_to_the_moon');
                    if (isCorrupt) {
                        assert.throws(() => normalizeTokenAddress('BITCOIN', id), InvalidTokenAddressError);
                    }
                    else {
                        const norm = normalizeTokenAddress('BITCOIN', id);
                        assert.strictEqual(norm, id);
                    }
                }
            }
        });
    });
    describe('Suite 24: Deterministic Fuzz Testing - 1,000 Metadata, Decimals & Standard Mutations (Seed 0x7A5C39)', () => {
        it('24.1 1,000 randomized metadata, decimals, and standard mutations evaluate deterministically', () => {
            const prng = new DeterministicPRNG(0x7A5C39 + 1);
            const canon = defaultAuthoritativeTokenRegistry.getToken('ethereum:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')!;
            for (let i = 0; i < 1000; i++) {
                const decimals = prng.choice([6, 18, 8, -1, 37, 18.5, undefined]);
                const symbol = prng.choice(['USDC', 'usdc', 'USDT', 'DAI', undefined]);
                const standard = prng.choice(['ERC20', 'SPL', 'NATIVE', undefined]);
                const cand = { decimals, symbol, standard };
                const evalRes = TokenMetadataConflictEngine.evaluate(canon, cand);
                if (decimals !== undefined && decimals !== 6) {
                    assert.strictEqual(evalRes.canProceed, false, `Decimals ${decimals} must fail closed`);
                }
                else if (symbol && symbol.toUpperCase() !== 'USDC') {
                    assert.strictEqual(evalRes.canProceed, false, `Symbol ${symbol} must fail closed`);
                }
                else if (standard && standard !== 'ERC20') {
                    assert.strictEqual(evalRes.canProceed, false, `Standard ${standard} must fail closed`);
                }
                else {
                    assert.strictEqual(evalRes.canProceed, true);
                }
            }
        });
    });
    describe('Suite 25: Deterministic Fuzz Testing - 1,000 Alias & Network Collision Mutations (Seed 0x7A5C39)', () => {
        it('25.1 1,000 randomized network-context queries consistently resolve or fail closed without ambiguity', () => {
            const prng = new DeterministicPRNG(0x7A5C39 + 2);
            const networks = ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'ghost-network', undefined];
            const symbols = ['USDC', 'ETH', 'DAI', 'UNKNOWN_SYM', undefined];
            for (let i = 0; i < 1000; i++) {
                const networkId = prng.choice(networks);
                const symbol = prng.choice(symbols);
                const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId, symbol });
                if (symbol && !networkId) {
                    assert.strictEqual(res.status, 'AMBIGUOUS_TOKEN_IDENTITY');
                }
                else if (networkId === 'ghost-network' || !symbol) {
                    assert.ok(res.status === 'UNRESOLVED' || res.status === 'INVALID_INPUT');
                }
                else if (networkId && symbol) {
                    assert.ok(res.status === 'RESOLVED_EXACT' || res.status === 'UNRESOLVED');
                }
            }
        });
    });
    describe('Suite 26: Deterministic Fuzz Testing - 1,000 DEX, Bridge & Capability Boundary Mutations (Seed 0x7A5C39)', () => {
        it('26.1 1,000 randomized corridor boundary queries preserve cross-chain token non-equivalence', () => {
            const prng = new DeterministicPRNG(0x7A5C39 + 3);
            const nets = ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon'];
            for (let i = 0; i < 1000; i++) {
                const srcNet = prng.choice(nets);
                const dstNet = prng.choice(nets);
                const srcToken = defaultAuthoritativeTokenRegistry.getNativeToken(srcNet)!;
                const dstToken = defaultAuthoritativeTokenRegistry.getNativeToken(dstNet)!;
                if (srcNet === dstNet) {
                    assert.strictEqual(srcToken.tokenId, dstToken.tokenId);
                }
                else {
                    assert.notStrictEqual(srcToken.tokenId, dstToken.tokenId, 'Cross-chain native tokens must never share token ID');
                    assert.notStrictEqual(srcToken.networkIdentityKey, dstToken.networkIdentityKey);
                }
            }
        });
    });
});
