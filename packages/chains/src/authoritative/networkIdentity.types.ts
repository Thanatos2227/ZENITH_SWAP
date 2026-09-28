/**
 * @file networkIdentity.types.ts
 * @package @zenith/chains
 *
 * Core helper functions and authoritative identity definitions for ZENITH.
 * Enforces family-aware, namespace-aware, environment-aware network identity.
 */

import {
  NetworkFamily,
  NetworkEnvironment,
  AuthoritativeNetworkIdentity,
  AuthoritativeNativeAsset,
  AuthoritativeGasModelConfig,
  AuthoritativeFinalityConfig,
  AuthoritativeRpcMetadata,
  AuthoritativeExplorerMetadata,
  MetadataCompletenessStatus
} from '@zenith/types';

export type {
  NetworkEnvironment,
  MetadataCompletenessStatus,
  AuthoritativeNativeAsset,
  AuthoritativeGasModelConfig,
  AuthoritativeFinalityConfig,
  AuthoritativeRpcMetadata,
  AuthoritativeExplorerMetadata,
  AuthoritativeNetworkIdentity
};

/**
 * Builds a deterministic, collision-free composite NetworkIdentityKey.
 * Format: `${family}:${namespace}:${chainId}`
 *
 * Examples:
 * - EVM: "EVM:eip155:1"
 * - Solana: "SOLANA:solana:mainnet-beta"
 * - Move: "MOVE:aptos:mainnet"
 * - Cosmos: "COSMOS:cosmos:cosmoshub-4"
 * - Bitcoin: "BITCOIN:bip122:mainnet"
 */
export function buildNetworkIdentityKey(
  family: NetworkFamily,
  namespace: string,
  chainId: string | number
): string {
  const normFamily = family.toUpperCase();
  const normNamespace = namespace.toLowerCase().trim();
  const normChainId = String(chainId).toLowerCase().trim();
  return `${normFamily}:${normNamespace}:${normChainId}`;
}

/**
 * Parses a composite NetworkIdentityKey into its constituent components.
 */
export function parseNetworkIdentityKey(key: string): {
  family: NetworkFamily;
  namespace: string;
  chainId: string;
} {
  const parts = key.split(':');
  if (parts.length < 3) {
    throw new Error(`Invalid NetworkIdentityKey format "${key}". Expected "family:namespace:chainId"`);
  }
  const family = parts[0].toUpperCase() as NetworkFamily;
  const namespace = parts[1].toLowerCase();
  const chainId = parts.slice(2).join(':'); // Allow chainId with colons if any

  return { family, namespace, chainId };
}
