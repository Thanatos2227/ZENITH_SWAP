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

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  private indexToken(token: TokenIdentity): void {
    const cloned = this.deepClone(token);
    const tokenId = cloned.tokenId;
    const identityKey = cloned.networkIdentityKey
      ? buildTokenIdentityKey(cloned.networkIdentityKey, cloned.standard, cloned.normalizedAddress || cloned.symbol)
      : tokenId;

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
    this.indexToken(token);
  }

  public removeToken(tokenId: string): boolean {
    const token = this.tokensById.get(tokenId);
    if (!token) return false;

    this.tokensById.delete(tokenId);
    const idKey = buildTokenIdentityKey(token.networkIdentityKey, token.standard, token.normalizedAddress || token.symbol);
    this.tokensByIdentityKey.delete(idKey);

    const netId = token.networkId.toLowerCase();
    const netList = this.tokensByNetwork.get(netId);
    if (netList) {
      this.tokensByNetwork.set(netId, netList.filter((t) => t.tokenId !== tokenId));
    }

    if (token.normalizedAddress) {
      this.tokensByNetworkAndAddress.get(netId)?.delete(token.normalizedAddress.toLowerCase());
    }

    const symMap = this.tokensByNetworkAndSymbol.get(netId);
    if (symMap) {
      const symList = symMap.get(token.symbol.toUpperCase());
      if (symList) {
        symMap.set(token.symbol.toUpperCase(), symList.filter((t) => t.tokenId !== tokenId));
      }
    }

    return true;
  }

  public getToken(tokenId: string): TokenIdentity | undefined {
    const token = this.tokensById.get(tokenId);
    return token ? this.deepClone(token) : undefined;
  }

  public getTokenByIdentityKey(identityKey: string): TokenIdentity | undefined {
    const token = this.tokensByIdentityKey.get(identityKey);
    return token ? this.deepClone(token) : undefined;
  }

  public getTokenByAddress(
    networkId: string,
    standard: TokenStandard,
    address: string
  ): TokenIdentity | undefined {
    const netId = networkId.trim().toLowerCase();
    const network = defaultAuthoritativeNetworkRegistry.getNetwork(netId);
    if (!network) return undefined;

    let normalized: string;
    try {
      normalized = normalizeTokenAddress(network.family, address, { allowZeroAddress: false });
    } catch {
      return undefined;
    }

    const token = this.tokensByNetworkAndAddress.get(netId)?.get(normalized.toLowerCase());
    if (token && (standard === 'UNSUPPORTED' || token.standard === standard || standard === 'ERC20' || standard === 'SPL')) {
      return this.deepClone(token);
    }
    return token ? this.deepClone(token) : undefined;
  }

  public getTokens(networkId: string): TokenIdentity[] {
    const list = this.tokensByNetwork.get(networkId.trim().toLowerCase()) || [];
    return this.deepClone(list);
  }

  public getTokensByStandard(networkId: string, standard: TokenStandard): TokenIdentity[] {
    const list = this.getTokens(networkId);
    return list.filter((t) => t.standard === standard);
  }

  public getNativeToken(networkId: string): TokenIdentity | undefined {
    const list = this.getTokens(networkId);
    const native = list.find((t) => t.isNative && t.standard === 'NATIVE');
    return native ? this.deepClone(native) : undefined;
  }

  public getWrappedNativeToken(networkId: string): TokenIdentity | undefined {
    const list = this.getTokens(networkId);
    const wrapped = list.find((t) => t.isWrappedNative);
    return wrapped ? this.deepClone(wrapped) : undefined;
  }

  public resolveTokenIdentity(input: TokenResolutionInput): TokenResolutionResult {
    // 1. Direct tokenId lookup
    if (input.tokenId) {
      const token = this.getToken(input.tokenId);
      if (token) {
        return { status: 'RESOLVED_EXACT', token };
      }
      return { status: 'UNRESOLVED', error: `No token registered with tokenId "${input.tokenId}"` };
    }

    // 2. Direct identityKey lookup
    if (input.identityKey) {
      const token = this.getTokenByIdentityKey(input.identityKey);
      if (token) {
        return { status: 'RESOLVED_EXACT', token };
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
        return { status: 'RESOLVED_EXACT', token: this.deepClone(matches[0]) };
      }
      if (matches.length > 1) {
        return {
          status: 'RESOLVED_AMBIGUOUS',
          matches: this.deepClone(matches),
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

    this.tokensById.set(tokenId, mutable);
  }

  public disableToken(tokenId: string, _reason: string): void {
    const token = this.tokensById.get(tokenId);
    if (!token) {
      throw new Error(`Cannot disable unknown token "${tokenId}"`);
    }
    const mutable = { ...token };
    (mutable as any).onboardingState = 'DISABLED';
    (mutable as any).capabilityLevel = 'UNSUPPORTED';
    this.tokensById.set(tokenId, mutable);
  }
}

export const defaultAuthoritativeTokenRegistry = new AuthoritativeTokenRegistry();
