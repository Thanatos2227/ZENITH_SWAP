import type { NetworkFamily, TokenStandard } from '@zenith/types';

/**
 * Authoritative mapping of network families to their genuinely supported token standards.
 * Unsupported or uncertified standards are excluded.
 */
export const FAMILY_STANDARD_TAXONOMY: Record<NetworkFamily, readonly TokenStandard[]> = {
  EVM: ['ERC20', 'ERC721', 'ERC1155', 'NATIVE', 'WRAPPED_NATIVE'],
  SOLANA: ['SPL', 'TOKEN_2022', 'NATIVE'],
  MOVE: ['MOVE_ASSET', 'NATIVE'],
  COSMOS: ['CW20', 'IBC_ASSET', 'NATIVE'],
  BITCOIN: ['NATIVE', 'UTXO_ASSET'],
  UTXO: ['NATIVE', 'UTXO_ASSET'],
  TON: ['JETTON', 'NATIVE'],
  SUBSTRATE: ['SUBSTRATE_ASSET', 'NATIVE'],
  XRPL: ['ISSUED_ASSET', 'NATIVE'],
  STELLAR: ['STELLAR_ASSET', 'NATIVE'],
  ICP: ['ICP_TOKEN', 'NATIVE'],
  TVM: ['JETTON', 'NATIVE'],
  NEAR: ['NATIVE']
};

const FUNGIBLE_STANDARDS: ReadonlySet<TokenStandard> = new Set([
  'ERC20',
  'NATIVE',
  'WRAPPED_NATIVE',
  'SPL',
  'TOKEN_2022',
  'MOVE_ASSET',
  'CW20',
  'IBC_ASSET',
  'UTXO_ASSET',
  'JETTON',
  'SUBSTRATE_ASSET',
  'ISSUED_ASSET',
  'STELLAR_ASSET',
  'ICP_TOKEN'
]);

const NFT_STANDARDS: ReadonlySet<TokenStandard> = new Set(['ERC721']);
const MULTI_TOKEN_STANDARDS: ReadonlySet<TokenStandard> = new Set(['ERC1155']);

/**
 * Returns true if the token standard represents fungible assets suitable for swap/trading.
 */
export function isFungibleStandard(standard: TokenStandard): boolean {
  return FUNGIBLE_STANDARDS.has(standard);
}

/**
 * Returns true if the token standard represents non-fungible tokens (NFTs).
 */
export function isNftStandard(standard: TokenStandard): boolean {
  return NFT_STANDARDS.has(standard);
}

/**
 * Returns true if the token standard represents multi-token / semi-fungible contracts.
 */
export function isMultiTokenStandard(standard: TokenStandard): boolean {
  return MULTI_TOKEN_STANDARDS.has(standard);
}

/**
 * Verifies whether a token standard is valid and supported for a given network family.
 */
export function isStandardSupportedForFamily(family: NetworkFamily, standard: TokenStandard): boolean {
  const allowed = FAMILY_STANDARD_TAXONOMY[family];
  if (!allowed) {
    return false;
  }
  return allowed.includes(standard);
}

/**
 * Retrieves the list of allowed token standards for a network family.
 */
export function getAllowedStandardsForFamily(family: NetworkFamily): readonly TokenStandard[] {
  return FAMILY_STANDARD_TAXONOMY[family] || [];
}
