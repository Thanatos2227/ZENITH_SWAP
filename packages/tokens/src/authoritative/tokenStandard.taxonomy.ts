import type { NetworkFamily, TokenStandard } from '@zenith/types';
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
export function isFungibleStandard(standard: TokenStandard): boolean {
    return FUNGIBLE_STANDARDS.has(standard);
}
export function isNftStandard(standard: TokenStandard): boolean {
    return NFT_STANDARDS.has(standard);
}
export function isMultiTokenStandard(standard: TokenStandard): boolean {
    return MULTI_TOKEN_STANDARDS.has(standard);
}
export function isStandardSupportedForFamily(family: NetworkFamily, standard: TokenStandard): boolean {
    const allowed = FAMILY_STANDARD_TAXONOMY[family];
    if (!allowed) {
        return false;
    }
    return allowed.includes(standard);
}
export function getAllowedStandardsForFamily(family: NetworkFamily): readonly TokenStandard[] {
    return FAMILY_STANDARD_TAXONOMY[family] || [];
}
