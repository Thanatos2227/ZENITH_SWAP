import type {
  TokenIdentity,
  TokenStandard,
  TokenVerificationState,
  TokenMetadata,
  TokenOnboardingState,
  TokenResolutionInput,
  TokenResolutionResult,
  CapabilityLevel
} from '@zenith/types';
import { defaultAuthoritativeNetworkRegistry } from '@zenith/chains';
import { ZENITH_CANONICAL_TOKENS } from './canonicalTokens.data';
import { TokenRegistryValidationEngine } from './tokenRegistryValidation';
import { normalizeTokenAddress } from './addressNormalizer';
import { buildTokenIdentityKey } from './tokenIdentity.types';

export class AuthoritativeTokenRegistry {
  private readonly tokensById = new Map<string, TokenIdentity>();
  private readonly tokensByIdentityKey = new Map<string, TokenIdentity>();
  private readonly tokensByNetworkAndAddress = new Map<string, Map<string, TokenIdentity>>();
  private readonly tokensByNetworkAndSymbol = new Map<string, Map<string, TokenIdentity[]>>();
  private readonly tokensByNetwork = new Map<string, TokenIdentity[]>();

  constructor(initialTokens: readonly TokenIdentity[] = ZENITH_CANONICAL_TOKENS) {
    TokenRegistryValidationEngine.validate([...initialTokens]);
    for (const token of initialTokens) {
      this.indexToken(token);
    }
  }

  private cloneToken(token: TokenIdentity): TokenIdentity {
    return {
      tokenId: token.tokenId,
      networkId: token.networkId,
      networkIdentityKey: token.networkIdentityKey,
      family: token.family,
      namespace: token.namespace,
      standard: token.standard,
      address: token.address,
      normalizedAddress: token.normalizedAddress,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      assetType: token.assetType,
      isNative: token.isNative,
      isWrappedNative: token.isWrappedNative,
      wrappedAddress: token.wrappedAddress,
      verificationStatus: token.verificationStatus,
      verificationDimensions: token.verificationDimensions
        ? { ...token.verificationDimensions }
        : ({} as any),
      metadataStatus: token.metadataStatus,
      capabilityLevel: token.capabilityLevel,
      onboardingState: token.onboardingState,
      source: token.source,
      lastVerifiedAt: token.lastVerifiedAt,
      isFungible: token.isFungible,
      isNFT: token.isNFT,
      isMultiToken: token.isMultiToken,
      tags: token.tags ? [...token.tags] : undefined
    };
  }

  private getIdentityKey(token: TokenIdentity): string {
    return token.networkIdentityKey
      ? buildTokenIdentityKey(token.networkIdentityKey, token.standard, token.normalizedAddress || token.symbol)
      : token.tokenId;
  }

  private unindexToken(token: TokenIdentity): void {
    this.tokensById.delete(token.tokenId);
    this.tokensByIdentityKey.delete(this.getIdentityKey(token));

    const netId = token.networkId.toLowerCase();
    const netList = this.tokensByNetwork.get(netId);
    if (netList) {
      const filtered = netList.filter((entry) => entry.tokenId !== token.tokenId);
      if (filtered.length > 0) this.tokensByNetwork.set(netId, filtered);
      else this.tokensByNetwork.delete(netId);
    }

    if (token.normalizedAddress) {
      const addressMap = this.tokensByNetworkAndAddress.get(netId);
      addressMap?.delete(token.normalizedAddress.toLowerCase());
      if (addressMap && addressMap.size === 0) this.tokensByNetworkAndAddress.delete(netId);
    }

    const symMap = this.tokensByNetworkAndSymbol.get(netId);
    if (symMap) {
      const symKey = token.symbol.toUpperCase();
      const symList = symMap.get(symKey);
      if (symList) {
        const filtered = symList.filter((entry) => entry.tokenId !== token.tokenId);
        if (filtered.length > 0) symMap.set(symKey, filtered);
        else symMap.delete(symKey);
      }
      if (symMap.size === 0) this.tokensByNetworkAndSymbol.delete(netId);
    }
  }

  private replaceIndexedToken(token: TokenIdentity): void {
    const current = this.tokensById.get(token.tokenId);
    if (!current) {
      throw new Error(`Cannot replace unknown token "${token.tokenId}"`);
    }
    this.unindexToken(current);
    this.indexToken(token);
  }

  private indexToken(token: TokenIdentity): void {
    const cloned = this.cloneToken(token);
    const tokenId = cloned.tokenId;
    const identityKey = this.getIdentityKey(cloned);

    this.tokensById.set(tokenId, cloned);
    this.tokensByIdentityKey.set(identityKey, cloned);

    const netId = cloned.networkId.toLowerCase();

    // Index by network
    if (!this.tokensByNetwork.has(netId)) {
      this.tokensByNetwork.set(netId, []);
    }
    this.tokensByNetwork.get(netId)!.push(cloned);

    // Index by address within network
    if (cloned.normalizedAddress) {
      if (!this.tokensByNetworkAndAddress.has(netId)) {
        this.tokensByNetworkAndAddress.set(netId, new Map());
      }
      this.tokensByNetworkAndAddress.get(netId)!.set(cloned.normalizedAddress.toLowerCase(), cloned);
    }

    // Index by symbol within network
    if (!this.tokensByNetworkAndSymbol.has(netId)) {
      this.tokensByNetworkAndSymbol.set(netId, new Map());
    }
    const symKey = cloned.symbol.toUpperCase();
    const symMap = this.tokensByNetworkAndSymbol.get(netId)!;
    if (!symMap.has(symKey)) {
      symMap.set(symKey, []);
    }
    symMap.get(symKey)!.push(cloned);
  }

  public registerToken(token: TokenIdentity): void {
    const report = TokenRegistryValidationEngine.validate([token]);
    if (!report.isValid) {
      throw new Error(`Token registration rejected: ${report.violations[0]?.message}`);
    }
    if (this.tokensById.has(token.tokenId)) {
      throw new Error(`Token with ID "${token.tokenId}" is already registered`);
    }

    const identityKey = this.getIdentityKey(token);
    if (this.tokensByIdentityKey.has(identityKey)) {
      throw new Error(`Token with identity key "${identityKey}" is already registered`);
    }

    if (!token.isNative && token.address) {
      const network = defaultAuthoritativeNetworkRegistry.getNetwork(token.networkId);
      if (network) {
        const normalizedAddress = normalizeTokenAddress(network.family, token.address, { allowZeroAddress: false }).toLowerCase();
        const existing = this.tokensByNetworkAndAddress.get(token.networkId.trim().toLowerCase())?.get(normalizedAddress);
        if (existing) {
          throw new Error(
            `Token address collision: network "${token.networkId}" address "${normalizedAddress}" is already registered by token "${existing.tokenId}"`
          );
        }
      }
    }

    this.indexToken(token);
  }

  public removeToken(tokenId: string): boolean {
    const token = this.tokensById.get(tokenId);
    if (!token) return false;

    this.tokensById.delete(tokenId);
    this.unindexToken(token);
    return true;
  }

  public getToken(tokenId: string): TokenIdentity | undefined {
    const token = this.tokensById.get(tokenId);
    return token ? this.cloneToken(token) : undefined;
  }

  public getTokenByIdentityKey(identityKey: string): TokenIdentity | undefined {
    const token = this.tokensByIdentityKey.get(identityKey);
    return token ? this.cloneToken(token) : undefined;
  }

  public getTokenByAddress(
    networkId: string,
    standard: TokenStandard,
    address: string
  ): TokenIdentity | undefined {
    const netId = networkId.trim().toLowerCase();
    const family = defaultAuthoritativeNetworkRegistry.getNetworkFamily(netId);
    if (!family) return undefined;

    let normalized: string;
    try {
      normalized = normalizeTokenAddress(family, address, { allowZeroAddress: false });
    } catch {
      return undefined;
    }

    const token = this.tokensByNetworkAndAddress.get(netId)?.get(normalized.toLowerCase());
    if (token && (standard === 'UNSUPPORTED' || token.standard === standard)) {
      return this.cloneToken(token);
    }
    return undefined;
  }

  public getTokens(networkId: string): TokenIdentity[] {
    const list = this.tokensByNetwork.get(networkId.trim().toLowerCase()) || [];
    return list.map((t) => this.cloneToken(t));
  }

  public getTokensByStandard(networkId: string, standard: TokenStandard): TokenIdentity[] {
    const list = this.getTokens(networkId);
    return list.filter((t) => t.standard === standard);
  }

  public getNativeToken(networkId: string): TokenIdentity | undefined {
    const list = this.tokensByNetwork.get(networkId.trim().toLowerCase()) || [];
    const native = list.find((t) => t.isNative && t.standard === 'NATIVE');
    return native ? this.cloneToken(native) : undefined;
  }

  public getWrappedNativeToken(networkId: string): TokenIdentity | undefined {
    const list = this.tokensByNetwork.get(networkId.trim().toLowerCase()) || [];
    const wrapped = list.find((t) => t.isWrappedNative);
    return wrapped ? this.cloneToken(wrapped) : undefined;
  }

  public resolveTokenIdentity(input: TokenResolutionInput): TokenResolutionResult {
    // 1. Direct tokenId lookup
    if (input.tokenId) {
      const token = this.tokensById.get(input.tokenId);
      if (token) {
        return { status: 'RESOLVED_EXACT', token: this.cloneToken(token) };
      }
      return { status: 'UNRESOLVED', error: `No token registered with tokenId "${input.tokenId}"` };
    }

    // 2. Direct identityKey lookup
    if (input.identityKey) {
      const token = this.tokensByIdentityKey.get(input.identityKey);
      if (token) {
        return { status: 'RESOLVED_EXACT', token: this.cloneToken(token) };
      }
      return { status: 'UNRESOLVED', error: `No token registered with identityKey "${input.identityKey}"` };
    }

    // 3. Global ambiguous symbol rejection (Section 18 requirement)
    if (input.symbol && !input.networkId && !input.address) {
      return {
        status: 'AMBIGUOUS_TOKEN_IDENTITY',
        error: `Ambiguous global token symbol "${input.symbol}". Network context or contract address required for resolution.`
      };
    }

    // 4. Network-qualified address lookup
    if (input.networkId && input.address) {
      const token = this.getTokenByAddress(input.networkId, input.standard || 'ERC20', input.address);
      if (token) {
        return { status: 'RESOLVED_EXACT', token };
      }
      return { status: 'UNRESOLVED', error: `No token on network "${input.networkId}" with address "${input.address}"` };
    }

    // 5. Network-qualified symbol lookup
    if (input.networkId && input.symbol) {
      const netId = input.networkId.trim().toLowerCase();
      const symMap = this.tokensByNetworkAndSymbol.get(netId);
      const matches = symMap?.get(input.symbol.trim().toUpperCase()) || [];

      if (matches.length === 1) {
        return { status: 'RESOLVED_EXACT', token: this.cloneToken(matches[0]) };
      }
      if (matches.length > 1) {
        return {
          status: 'RESOLVED_AMBIGUOUS',
          matches: matches.map((m) => this.cloneToken(m)),
          error: `Multiple tokens match symbol "${input.symbol}" on network "${input.networkId}"`
        };
      }
      return { status: 'UNRESOLVED', error: `No token matches symbol "${input.symbol}" on network "${input.networkId}"` };
    }

    return { status: 'INVALID_INPUT', error: 'Insufficient parameters provided for token resolution' };
  }

  public getTokenCapability(tokenId: string): CapabilityLevel {
    const token = this.tokensById.get(tokenId);
    return token ? token.capabilityLevel : 'UNSUPPORTED';
  }

  public getTokenVerificationStatus(tokenId: string): TokenVerificationState {
    const token = this.tokensById.get(tokenId);
    return token ? token.verificationStatus : 'UNVERIFIED';
  }

  public getTokenMetadata(tokenId: string): TokenMetadata | undefined {
    const token = this.tokensById.get(tokenId);
    if (!token) return undefined;
    return {
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      metadataSource: token.source,
      metadataStatus: token.metadataStatus,
      verifiedAt: token.lastVerifiedAt
    };
  }

  public validateTokenIdentity(token: TokenIdentity): { isValid: boolean; violations: string[] } {
    try {
      const res = TokenRegistryValidationEngine.validate([token]);
      return { isValid: res.isValid, violations: [] };
    } catch (err: any) {
      return { isValid: false, violations: [err.message] };
    }
  }

  public isTokenRegistered(tokenId: string): boolean {
    return this.tokensById.has(tokenId);
  }

  public promoteToken(
    tokenId: string,
    targetState: TokenOnboardingState,
    evidence: { reason: string; timestamp?: number }
  ): void {
    const token = this.tokensById.get(tokenId);
    if (!token) {
      throw new Error(`Cannot promote unknown token "${tokenId}"`);
    }

    if (!evidence || !evidence.reason) {
      throw new Error(`Promotion of token "${tokenId}" rejected: Explicit evidence reason required`);
    }

    const mutable = { ...token };
    (mutable as any).onboardingState = targetState;
    if (targetState === 'LIVE_VERIFIED') {
      (mutable as any).capabilityLevel = 'LIVE_VERIFIED';
      (mutable as any).verificationStatus = 'IDENTITY_VERIFIED';
      (mutable as any).metadataStatus = 'LIVE_VERIFIED';
    }
    (mutable as any).lastVerifiedAt = evidence.timestamp || Date.now();

    this.replaceIndexedToken(mutable);
  }

  public disableToken(tokenId: string, _reason: string): void {
    const token = this.tokensById.get(tokenId);
    if (!token) {
      throw new Error(`Cannot disable unknown token "${tokenId}"`);
    }
    const mutable = { ...token };
    (mutable as any).onboardingState = 'DISABLED';
    (mutable as any).capabilityLevel = 'UNSUPPORTED';
    this.replaceIndexedToken(mutable);
  }
}

export const defaultAuthoritativeTokenRegistry = new AuthoritativeTokenRegistry();
