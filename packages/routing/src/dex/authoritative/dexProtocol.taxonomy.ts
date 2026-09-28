/**
 * @file dexProtocol.taxonomy.ts
 * @package @zenith/routing
 *
 * Authoritative DEX Protocol Taxonomy.
 * Classifies DEX protocols into deterministic architectural models without forcing
 * every DEX into Uniswap assumptions.
 */

import type { DexProtocolTaxonomy, DEXProtocol } from '@zenith/types';

export const ALL_DEX_TAXONOMIES: readonly DexProtocolTaxonomy[] = [
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
] as const;

/**
 * Returns true if the protocol taxonomy utilizes concentrated liquidity curves.
 */
export function isConcentratedLiquidityTaxonomy(taxonomy: DexProtocolTaxonomy): boolean {
  return taxonomy === 'UNISWAP_V3_STYLE' || taxonomy === 'CONCENTRATED_LIQUIDITY_AMM';
}

export const isConcentratedLiquidityAmm = isConcentratedLiquidityTaxonomy;

/**
 * Returns true if the protocol taxonomy utilizes constant-product invariant (x * y = k).
 */
export function isConstantProductTaxonomy(taxonomy: DexProtocolTaxonomy): boolean {
  return (
    taxonomy === 'UNISWAP_V2_STYLE' ||
    taxonomy === 'CONSTANT_PRODUCT_AMM'
  );
}

export const isConstantProductAmm = isConstantProductTaxonomy;

/**
 * Returns true if the given taxonomy is a supported swap protocol taxonomy (not UNKNOWN).
 */
export function isSupportedSwapProtocol(taxonomy: DexProtocolTaxonomy): boolean {
  return ALL_DEX_TAXONOMIES.includes(taxonomy) && taxonomy !== 'UNKNOWN';
}

/**
 * Returns true if the protocol taxonomy is compatible with Uniswap V2 interfaces
 * (getAmountsOut, swapExactTokensForTokens, etc.).
 */
export function isUniswapV2CompatibleTaxonomy(taxonomy: DexProtocolTaxonomy): boolean {
  return taxonomy === 'UNISWAP_V2_STYLE';
}

/**
 * Returns true if the protocol taxonomy is compatible with Uniswap V3 interfaces
 * (exactInputSingle with router/quoter, tickMath, etc.).
 */
export function isUniswapV3CompatibleTaxonomy(taxonomy: DexProtocolTaxonomy): boolean {
  return taxonomy === 'UNISWAP_V3_STYLE';
}

/**
 * Maps legacy DEXProtocol identifiers to authoritative taxonomy.
 */
export function getTaxonomyForLegacyProtocol(protocol: DEXProtocol): DexProtocolTaxonomy {
  switch (protocol) {
    case 'UNISWAP_V3':
      return 'UNISWAP_V3_STYLE';
    case 'UNISWAP_V2':
      return 'UNISWAP_V2_STYLE';
    case 'ZENITH_V3':
    case 'ZENITH_V4_CONCENTRATED':
      return 'CONCENTRATED_LIQUIDITY_AMM';
    case 'ZENITH_V1':
    case 'ZENITH_V2':
      return 'CONSTANT_PRODUCT_AMM';
    case 'QUICKSWAP':
      return 'CONCENTRATED_LIQUIDITY_AMM'; // Algebra V3 concentrated
    case 'AERODROME':
    case 'VELODROME':
      return 'CONSTANT_PRODUCT_AMM'; // Solidly-style constant product / stable
    case 'CAMELOT':
      return 'CONCENTRATED_LIQUIDITY_AMM'; // Algebra V3
    case 'PANCAKESWAP':
      return 'UNISWAP_V3_STYLE';
    case 'TRADER_JOE':
      return 'CONCENTRATED_LIQUIDITY_AMM'; // Liquidity Book
    case 'CURVE':
      return 'STABLE_SWAP_AMM';
    case 'BALANCER_V2':
      return 'WEIGHTED_AMM';
    case 'RAYDIUM':
      return 'CONSTANT_PRODUCT_AMM';
    case 'ORCA_WHIRLPOOL':
      return 'CONCENTRATED_LIQUIDITY_AMM';
    case 'METEORA':
      return 'CONCENTRATED_LIQUIDITY_AMM';
    case 'ZENITH_DUTCH_INTENT':
      return 'CUSTOM_AMM';
    case 'ZENITH_INTERNAL_RFIS':
      return 'ORDER_BOOK';
    default:
      return 'UNKNOWN';
  }
}
