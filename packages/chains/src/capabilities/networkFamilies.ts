/**
 * @file networkFamilies.ts
 * @package @zenith/chains
 *
 * Architectural Classification & Validation for Diverse Network Families.
 * Explicitly decouples EVM from non-EVM execution architectures (Solana, Move, Cosmos, UTXO, etc.).
 */

import { NetworkFamily } from './networkCapabilityTypes';

export type TransactionModel =
  | 'ACCOUNT_BASED_EVM'
  | 'ACCOUNT_BASED_SOLANA'
  | 'ACCOUNT_BASED_MOVE'
  | 'ACCOUNT_BASED_COSMOS'
  | 'UTXO'
  | 'ACTOR_MODEL';

export interface NetworkFamilyDefinition {
  family: NetworkFamily;
  name: string;
  transactionModel: TransactionModel;
  defaultTokenStandard: string;
  supportedTokenStandards: string[];
  rpcProtocol: string;
  isEvmEquivalent: boolean;
  addressRegex: RegExp;
  txHashRegex: RegExp;
  description: string;
}

// Regex patterns for network family address formats
export const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
export const EVM_TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/;

// Solana Base58 regex (32-44 characters, base58 alphabet)
export const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const SOLANA_TX_HASH_REGEX = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

// Cosmos Bech32 regex (prefix + '1' + data)
export const COSMOS_ADDRESS_REGEX = /^[a-z0-9]{2,12}1[02-9ac-hj-np-z]{38,58}$/;
export const COSMOS_TX_HASH_REGEX = /^[0-9A-F]{64}$/i;

// Bitcoin / UTXO regex (Bech32 or Base58Check)
export const BITCOIN_ADDRESS_REGEX = /^(bc1[a-z0-9]{25,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
export const BITCOIN_TX_HASH_REGEX = /^[0-9a-fA-F]{64}$/;

// Move (Aptos / Sui) hex address (up to 32 bytes with 0x prefix)
export const MOVE_ADDRESS_REGEX = /^0x[0-9a-fA-F]{1,64}$/;
export const MOVE_TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/;

export const NETWORK_FAMILIES: Record<NetworkFamily, NetworkFamilyDefinition> = {
  EVM: {
    family: 'EVM',
    name: 'Ethereum Virtual Machine',
    transactionModel: 'ACCOUNT_BASED_EVM',
    defaultTokenStandard: 'ERC-20',
    supportedTokenStandards: ['ERC-20', 'ERC-721', 'ERC-1155', 'Permit2'],
    rpcProtocol: 'JSON-RPC 2.0 (eth_*)',
    isEvmEquivalent: true,
    addressRegex: EVM_ADDRESS_REGEX,
    txHashRegex: EVM_TX_HASH_REGEX,
    description: 'Account-based execution model with contract storage and EIP-155 replay protection.'
  },
  SOLANA: {
    family: 'SOLANA',
    name: 'Solana Sealevel',
    transactionModel: 'ACCOUNT_BASED_SOLANA',
    defaultTokenStandard: 'SPL',
    supportedTokenStandards: ['SPL', 'SPL-2022'],
    rpcProtocol: 'JSON-RPC 2.0 (solana_*)',
    isEvmEquivalent: false,
    addressRegex: SOLANA_ADDRESS_REGEX,
    txHashRegex: SOLANA_TX_HASH_REGEX,
    description: 'High-throughput parallelized runtime using instruction-based transactions and associated token accounts.'
  },
  MOVE: {
    family: 'MOVE',
    name: 'Move VM (Aptos / Sui)',
    transactionModel: 'ACCOUNT_BASED_MOVE',
    defaultTokenStandard: 'Move Coin',
    supportedTokenStandards: ['Move Coin', 'Move Object'],
    rpcProtocol: 'REST / JSON-RPC',
    isEvmEquivalent: false,
    addressRegex: MOVE_ADDRESS_REGEX,
    txHashRegex: MOVE_TX_HASH_REGEX,
    description: 'Resource-oriented programming model where tokens and assets are linear types.'
  },
  COSMOS: {
    family: 'COSMOS',
    name: 'Cosmos SDK / CometBFT',
    transactionModel: 'ACCOUNT_BASED_COSMOS',
    defaultTokenStandard: 'Cosmos Bank Coin',
    supportedTokenStandards: ['Cosmos Bank Coin', 'CW-20', 'IBC Voucher'],
    rpcProtocol: 'gRPC / CometBFT RPC / REST',
    isEvmEquivalent: false,
    addressRegex: COSMOS_ADDRESS_REGEX,
    txHashRegex: COSMOS_TX_HASH_REGEX,
    description: 'Inter-Blockchain Communication (IBC) native framework with BFT instant finality.'
  },
  BITCOIN: {
    family: 'BITCOIN',
    name: 'Bitcoin UTXO',
    transactionModel: 'UTXO',
    defaultTokenStandard: 'BTC (Native)',
    supportedTokenStandards: ['BTC (Native)', 'BRC-20', 'Runes'],
    rpcProtocol: 'Bitcoin Core JSON-RPC',
    isEvmEquivalent: false,
    addressRegex: BITCOIN_ADDRESS_REGEX,
    txHashRegex: BITCOIN_TX_HASH_REGEX,
    description: 'Unspent Transaction Output (UTXO) stateless execution model with Script.'
  },
  UTXO: {
    family: 'UTXO',
    name: 'Generic UTXO',
    transactionModel: 'UTXO',
    defaultTokenStandard: 'Native UTXO',
    supportedTokenStandards: ['Native UTXO'],
    rpcProtocol: 'JSON-RPC',
    isEvmEquivalent: false,
    addressRegex: BITCOIN_ADDRESS_REGEX,
    txHashRegex: BITCOIN_TX_HASH_REGEX,
    description: 'Generic UTXO architecture networks.'
  },
  NEAR: {
    family: 'NEAR',
    name: 'NEAR Protocol',
    transactionModel: 'ACTOR_MODEL',
    defaultTokenStandard: 'NEP-141',
    supportedTokenStandards: ['NEP-141'],
    rpcProtocol: 'JSON-RPC',
    isEvmEquivalent: false,
    addressRegex: /^[a-z0-9._-]+$/,
    txHashRegex: /^[1-9A-HJ-NP-Za-km-z]{40,50}$/,
    description: 'Asynchronous, sharded, account-based runtime.'
  },
  TON: {
    family: 'TON',
    name: 'The Open Network (TON)',
    transactionModel: 'ACTOR_MODEL',
    defaultTokenStandard: 'Jetton',
    supportedTokenStandards: ['Jetton'],
    rpcProtocol: 'TON HTTP API / LiteServer',
    isEvmEquivalent: false,
    addressRegex: /^[0-9a-zA-Z_-]{48}$/,
    txHashRegex: /^[0-9a-fA-F]{64}$/,
    description: 'Asynchronous actor-model blockchain with workchains and Jetton contracts.'
  },
  TVM: {
    family: 'TVM',
    name: 'Tron Virtual Machine',
    transactionModel: 'ACCOUNT_BASED_EVM',
    defaultTokenStandard: 'TRC-20',
    supportedTokenStandards: ['TRC-20', 'TRC-10'],
    rpcProtocol: 'FullNode HTTP / JSON-RPC',
    isEvmEquivalent: false,
    addressRegex: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    txHashRegex: /^[0-9a-fA-F]{64}$/,
    description: 'DPoS architecture with TRC-20 token standard and Base58Check addressing.'
  },
  SUBSTRATE: {
    family: 'SUBSTRATE',
    name: 'Substrate / Polkadot',
    transactionModel: 'ACCOUNT_BASED_COSMOS',
    defaultTokenStandard: 'Substrate Asset',
    supportedTokenStandards: ['Substrate Asset', 'XCM'],
    rpcProtocol: 'Substrate WebSocket RPC',
    isEvmEquivalent: false,
    addressRegex: /^[1-9A-HJ-NP-Za-km-z]{46,48}$/,
    txHashRegex: /^0x[0-9a-fA-F]{64}$/,
    description: 'Polkadot parachain and Substrate runtime environment with XCM cross-consensus messaging.'
  },
  XRPL: {
    family: 'XRPL',
    name: 'XRP Ledger',
    transactionModel: 'ACCOUNT_BASED_COSMOS',
    defaultTokenStandard: 'XRPL Issued Currency',
    supportedTokenStandards: ['XRPL Issued Currency'],
    rpcProtocol: 'JSON-RPC / WebSocket',
    isEvmEquivalent: false,
    addressRegex: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
    txHashRegex: /^[0-9A-F]{64}$/i,
    description: 'Federated consensus ledger with native decentralized exchange and issued currencies.'
  },
  STELLAR: {
    family: 'STELLAR',
    name: 'Stellar Soroban',
    transactionModel: 'ACCOUNT_BASED_COSMOS',
    defaultTokenStandard: 'Stellar Asset',
    supportedTokenStandards: ['Stellar Asset', 'Soroban Token'],
    rpcProtocol: 'Horizon REST / Soroban RPC',
    isEvmEquivalent: false,
    addressRegex: /^G[A-Z0-9]{55}$/,
    txHashRegex: /^[0-9a-fA-F]{64}$/,
    description: 'Stellar Consensus Protocol (SCP) ledger with Soroban Rust-based smart contracts.'
  },
  ICP: {
    family: 'ICP',
    name: 'Internet Computer (ICP)',
    transactionModel: 'ACTOR_MODEL',
    defaultTokenStandard: 'ICRC-1',
    supportedTokenStandards: ['ICRC-1', 'ICRC-2'],
    rpcProtocol: 'ICP Agent HTTP API',
    isEvmEquivalent: false,
    addressRegex: /^[a-z0-9-]+$/,
    txHashRegex: /^0x[0-9a-fA-F]{64}$/,
    description: 'Canister-based actor architecture with reverse gas model.'
  }
};

/**
 * Returns the family definition for a given network family.
 */
export function getNetworkFamilyDefinition(family: NetworkFamily): NetworkFamilyDefinition {
  const def = NETWORK_FAMILIES[family];
  if (!def) {
    throw new Error(`Unknown network family: "${family}"`);
  }
  return def;
}

/**
 * Validates that an address adheres to the expected format for its network family.
 */
export function isValidAddressForFamily(address: string, family: NetworkFamily): boolean {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  const def = NETWORK_FAMILIES[family];
  if (!def) return false;
  return def.addressRegex.test(trimmed);
}

/**
 * Validates that a transaction hash adheres to the expected format for its network family.
 */
export function isValidTxHashForFamily(txHash: string, family: NetworkFamily): boolean {
  if (!txHash || typeof txHash !== 'string') return false;
  const trimmed = txHash.trim();
  const def = NETWORK_FAMILIES[family];
  if (!def) return false;
  return def.txHashRegex.test(trimmed);
}

/**
 * Evaluates whether two networks share the same execution family.
 */
export function isSameNetworkFamily(familyA: NetworkFamily, familyB: NetworkFamily): boolean {
  return familyA === familyB;
}
