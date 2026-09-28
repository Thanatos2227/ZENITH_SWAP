import { Token, TokenSecurityProfile, UnsupportedTokenMetadata } from '@zenith/types';
import { DEFAULT_TOKENS, UNSUPPORTED_TOKEN_METADATA } from './defaultTokens';
import { defaultAuthoritativeTokenRegistry } from './authoritative/authoritativeTokenRegistry';

export class TokenService {
  private tokens: Map<string, Token> = new Map();
  private chainTokenIndex: Map<string, Token[]> = new Map();
  private allTokensList: Token[] = [];

  constructor(customTokens?: Token[]) {
    const list = [...DEFAULT_TOKENS, ...(customTokens || [])];
    list.forEach((t) => this.addToken(t));
  }

  private getTokenKey(chainId: string, address: string): string {
    return `${chainId.toLowerCase()}:${address.toLowerCase()}`;
  }

  public addToken(token: Token): void {
    if (!token.chainId || !token.address || !token.symbol || !token.name) {
      throw new Error('[TokenService] Token must include chainId, address, name, and symbol');
    }

    const normalizedToken: Token = {
      ...token,
      chainId: token.chainId.toLowerCase(),
      symbol: token.symbol.toUpperCase(),
      enabled: token.enabled !== false
    };
    const key = this.getTokenKey(normalizedToken.chainId, normalizedToken.address);
    this.tokens.set(key, normalizedToken);

    const chainList = this.chainTokenIndex.get(normalizedToken.chainId) || [];
    const existingIdx = chainList.findIndex(
      (t) => t.address.toLowerCase() === normalizedToken.address.toLowerCase()
    );
    if (existingIdx >= 0) {
      chainList[existingIdx] = normalizedToken;
    } else {
      chainList.push(normalizedToken);
    }
    this.chainTokenIndex.set(normalizedToken.chainId, chainList);
    this.allTokensList = Array.from(this.tokens.values()).filter((t) => t.enabled !== false);
  }

  public getToken(chainId: string, address: string): Token | undefined {
    const found = this.tokens.get(this.getTokenKey(chainId, address));
    if (found) return found;

    // Authoritative fallback
    const auth = defaultAuthoritativeTokenRegistry.getTokenByAddress(chainId, 'ERC20', address);
    if (auth) {
      return {
        address: auth.address || auth.normalizedAddress || address,
        chainId: auth.networkId,
        name: auth.name,
        symbol: auth.symbol,
        decimals: auth.decimals,
        isNative: auth.isNative,
        wrappedAddress: auth.wrappedAddress,
        verificationTier: auth.verificationStatus === 'IDENTITY_VERIFIED' ? 'VERIFIED_CANONICAL' : 'UNVERIFIED',
        enabled: auth.onboardingState !== 'DISABLED'
      };
    }
    return undefined;
  }

  public getNativeToken(chainId: string): Token | undefined {
    const tokens = this.getTokensForChain(chainId);
    const found = tokens.find((t) => t.isNative);
    if (found) return found;

    const authNative = defaultAuthoritativeTokenRegistry.getNativeToken(chainId);
    if (authNative) {
      return {
        address: authNative.address || '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: authNative.networkId,
        name: authNative.name,
        symbol: authNative.symbol,
        decimals: authNative.decimals,
        isNative: true,
        wrappedAddress: authNative.wrappedAddress,
        verificationTier: 'VERIFIED_CANONICAL',
        enabled: true
      };
    }
    return undefined;
  }

  public getTokensForChain(chainId: string): Token[] {
    return (this.chainTokenIndex.get(chainId.toLowerCase()) || []).filter((token) => token.enabled !== false);
  }

  public searchTokens(query: string, chainId?: string): Token[] {
    const q = query.trim().toLowerCase();
    if (!q) {
      return chainId ? this.getTokensForChain(chainId) : this.allTokensList;
    }

    const searchPool = chainId
      ? this.getTokensForChain(chainId)
      : this.allTokensList;
    return searchPool.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
    );
  }

  public searchUnsupportedTokenMetadata(query: string): UnsupportedTokenMetadata[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return UNSUPPORTED_TOKEN_METADATA.filter(
      (token) => token.symbol.toLowerCase().includes(q) || token.name.toLowerCase().includes(q)
    );
  }

  public importCustomToken(params: {
    chainId: string;
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    securityProfile?: TokenSecurityProfile;
  }): Token {
    const chain = params.chainId.toLowerCase();
    if (!this.chainTokenIndex.has(chain)) {
      throw new Error(`[TokenService] Unsupported network: ${params.chainId}`);
    }

    const isEVM = params.address.startsWith('0x');
    if (isEVM && params.address.length !== 42) {
      throw new Error(`[TokenService] Invalid EVM token address format: ${params.address}`);
    }

    const importedToken: Token = {
      address: params.address,
      chainId: chain,
      name: params.name,
      symbol: params.symbol.toUpperCase(),
      decimals: params.decimals,
      enabled: true,
      verificationTier: 'UNVERIFIED',
      securityProfile: params.securityProfile || {
        isHoneypot: false,
        buyTaxPercent: 0,
        sellTaxPercent: 0,
        transferTaxPercent: 0,
        canBlacklist: false,
        canMintArbitrary: false,
        isProxy: false,
        liquidityLockedPercent: 0,
        holderConcentrationTop10Percent: 50,
        hasMaliciousPatterns: false,
        riskScore: 35,
        warnings: ['Custom imported token. Always verify contract address on official explorer.']
      }
    };

    this.addToken(importedToken);
    return importedToken;
  }
}

export const defaultTokenService = new TokenService();
