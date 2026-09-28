/**
 * @file networkCapabilityTypes.ts
 * @package @zenith/chains
 *
 * Authoritative Type System for the ZENITH Multi-Network Capability Architecture.
 * Preserves the certified 6-level capability hierarchy:
 *   UNSUPPORTED (0) < UNIT_TESTED (1) < CONFIGURED (2) < QUOTE_AVAILABLE (3) < EXECUTION_AVAILABLE (4) < LIVE_VERIFIED (5)
 */

/**
 * Authoritative 6-level network capability scale.
 * Strictly aligned with ProviderCapabilityLevel to avoid competing hierarchies.
 */
export type NetworkCapabilityLevel =
  | 'UNSUPPORTED'
  | 'UNIT_TESTED'
  | 'CONFIGURED'
  | 'QUOTE_AVAILABLE'
  | 'EXECUTION_AVAILABLE'
  | 'LIVE_VERIFIED';

/**
 * Numeric capability rank mapping for deterministic comparisons.
 */
export const NETWORK_CAPABILITY_HIERARCHY: Record<NetworkCapabilityLevel, number> = {
  UNSUPPORTED: 0,
  UNIT_TESTED: 1,
  CONFIGURED: 2,
  QUOTE_AVAILABLE: 3,
  EXECUTION_AVAILABLE: 4,
  LIVE_VERIFIED: 5
};

/**
 * Deterministic onboarding lifecycle states for networks.
 */
export type NetworkOnboardingState =
  | 'DISCOVERED'
  | 'CONFIGURED'
  | 'UNIT_TESTED'
  | 'QUOTE_ENABLED'
  | 'EXECUTION_ENABLED'
  | 'LIVE_VERIFIED'
  | 'DEPRECATED'
  | 'DISABLED';

/**
 * Ordered sequence of progressive onboarding states.
 */
export const ONBOARDING_PROGRESSION: NetworkOnboardingState[] = [
  'DISCOVERED',
  'CONFIGURED',
  'UNIT_TESTED',
  'QUOTE_ENABLED',
  'EXECUTION_ENABLED',
  'LIVE_VERIFIED'
];

/**
 * High-level operational classification for cataloging and UI presentation.
 */
export type NetworkOperationalStatus =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'UNSUPPORTED'
  | 'TESTNET_ONLY'
  | 'HISTORICAL_ONLY';

/**
 * Architectural classification by execution environment.
 * Ensures non-EVM chains are never forced into EVM transaction or address models.
 */
export type NetworkFamily =
  | 'EVM'
  | 'SOLANA'
  | 'BITCOIN'
  | 'COSMOS'
  | 'MOVE'
  | 'NEAR'
  | 'TON'
  | 'TVM'
  | 'SUBSTRATE'
  | 'XRPL'
  | 'STELLAR'
  | 'UTXO'
  | 'ICP';

/**
 * Finality models for reorg safety and settlement guarantees.
 */
export type NetworkFinalityModel =
  | 'PROBABILISTIC'
  | 'CONFIRMATION_BASED'
  | 'INSTANT_FINALITY'
  | 'OPTIMISTIC'
  | 'ZK_PROVEN'
  | 'CHAIN_SPECIFIC'
  | 'FINALITY_UNKNOWN';

export interface NetworkFinalityConfig {
  model: NetworkFinalityModel;
  reorgSafetyBlocks: number;
  instantFinality: boolean;
  typicalBlockTimeSec: number;
  safeFinalityTimeSec: number;
  description?: string;
}

/**
 * Gas and fee models across diverse execution architectures.
 */
export type NetworkGasModelType =
  | 'EVM_LEGACY'
  | 'EVM_EIP1559'
  | 'EVM_OP_STACK_L2'
  | 'EVM_ARBITRUM_L2'
  | 'SOLANA_FEE'
  | 'UTXO_FEE'
  | 'COSMOS_FEE'
  | 'CHAIN_SPECIFIC';

export interface NetworkGasConfig {
  modelType: NetworkGasModelType;
  supportsEIP1559: boolean;
  supportsBlobTransactions?: boolean;
  baseFeeUnit: string;
  typicalSwapGasUnits: number;
  typicalBridgeGasUnits: number;
  description?: string;
}

/**
 * Native asset definition.
 */
export interface NativeAssetConfig {
  symbol: string;
  name: string;
  decimals: number;
  address: string;
  isNative: true;
  logoURI?: string;
}

/**
 * DEX capability descriptor for on-chain liquidity routing.
 */
export interface DEXCapabilityRecord {
  dexId: string;
  name: string;
  routerAddress: string;
  factoryAddress?: string;
  quoterAddress?: string;
  swapMethods: string[];
  supportedTokenStandards: string[];
  quoteCapability: NetworkCapabilityLevel;
  executionCapability: NetworkCapabilityLevel;
  liveVerified: boolean;
}

/**
 * Bridge corridor descriptor defining directional cross-chain capability.
 */
export interface BridgeCorridorRecord {
  providerId: string;
  destinationNetworkId: string;
  sourceTokenSymbol: string;
  destinationTokenSymbol: string;
  minAmountRaw: string;
  maxAmountRaw?: string;
  quoteSupported: boolean;
  executionSupported: boolean;
  capabilityLevel: NetworkCapabilityLevel;
}

/**
 * Live health status integrated with RPC provider circuit breakers.
 */
export type NetworkHealthStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNHEALTHY'
  | 'CIRCUIT_OPEN'
  | 'RECOVERING';

/**
 * RPC endpoint definition with priority and health metadata.
 */
export interface NetworkRpcEndpoint {
  url: string;
  priority: number;
  weight?: number;
  isPrivate?: boolean;
  supportsSimulation?: boolean;
  status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
}

/**
 * Explorer metadata for on-chain receipt and address links.
 */
export interface NetworkExplorerConfig {
  name: string;
  baseUrl: string;
  txPath: string;
  addressPath: string;
  tokenPath: string;
}

/**
 * Canonical NetworkCapabilityProfile.
 * Represents the complete, verified capability envelope for any network in ZENITH.
 */
export interface NetworkCapabilityProfile {
  // Identity
  networkId: string;
  name: string;
  shortName: string;
  numericChainId?: number; // Unique across EVM networks
  family: NetworkFamily;
  isTestnet: boolean;
  operationalClassification: NetworkOperationalStatus;

  // Native Currency
  nativeAsset: NativeAssetConfig;

  // Onboarding State & Verification
  onboardingState: NetworkOnboardingState;
  overallCapabilityLevel: NetworkCapabilityLevel;
  capabilityRank: number;

  // Granular Capabilities (Never infer higher from lower)
  readCapability: NetworkCapabilityLevel;
  preflightCapability: NetworkCapabilityLevel;
  txConstructionCapability: NetworkCapabilityLevel;
  signingCapability: NetworkCapabilityLevel;
  sameChainSwapCapability: NetworkCapabilityLevel;
  crossChainSourceCapability: NetworkCapabilityLevel;
  crossChainDestCapability: NetworkCapabilityLevel;

  // Architecture Models
  finality: NetworkFinalityConfig;
  gas: NetworkGasConfig;
  supportedTokenStandards: string[];

  // Infrastructure & Corridors
  rpcEndpoints: NetworkRpcEndpoint[];
  explorer?: NetworkExplorerConfig;
  dexCapabilities: Record<string, DEXCapabilityRecord>;
  bridgeCorridors: BridgeCorridorRecord[];

  // Metadata
  iconURI?: string;
  color?: string;
  notes?: string;
}

/**
 * Evaluation result for network execution readiness.
 */
export interface NetworkExecutionReadiness {
  isExecutable: boolean;
  networkId: string;
  family: NetworkFamily;
  level: NetworkCapabilityLevel;
  rank: number;
  health: NetworkHealthStatus;
  rejectionReason?: string;
}
