export type NetworkCapabilityLevel = 'UNSUPPORTED' | 'UNIT_TESTED' | 'CONFIGURED' | 'QUOTE_AVAILABLE' | 'EXECUTION_AVAILABLE' | 'LIVE_VERIFIED';
export const NETWORK_CAPABILITY_HIERARCHY: Record<NetworkCapabilityLevel, number> = {
    UNSUPPORTED: 0,
    UNIT_TESTED: 1,
    CONFIGURED: 2,
    QUOTE_AVAILABLE: 3,
    EXECUTION_AVAILABLE: 4,
    LIVE_VERIFIED: 5
};
export type NetworkOnboardingState = 'DISCOVERED' | 'CONFIGURED' | 'UNIT_TESTED' | 'QUOTE_ENABLED' | 'EXECUTION_ENABLED' | 'LIVE_VERIFIED' | 'DEPRECATED' | 'DISABLED';
export const ONBOARDING_PROGRESSION: NetworkOnboardingState[] = [
    'DISCOVERED',
    'CONFIGURED',
    'UNIT_TESTED',
    'QUOTE_ENABLED',
    'EXECUTION_ENABLED',
    'LIVE_VERIFIED'
];
export type NetworkOperationalStatus = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED' | 'TESTNET_ONLY' | 'HISTORICAL_ONLY';
export type NetworkFamily = 'EVM' | 'SOLANA' | 'BITCOIN' | 'COSMOS' | 'MOVE' | 'NEAR' | 'TON' | 'TVM' | 'SUBSTRATE' | 'XRPL' | 'STELLAR' | 'UTXO' | 'ICP';
export type NetworkFinalityModel = 'PROBABILISTIC' | 'CONFIRMATION_BASED' | 'INSTANT_FINALITY' | 'OPTIMISTIC' | 'ZK_PROVEN' | 'CHAIN_SPECIFIC' | 'FINALITY_UNKNOWN';
export interface NetworkFinalityConfig {
    model: NetworkFinalityModel;
    reorgSafetyBlocks: number;
    instantFinality: boolean;
    typicalBlockTimeSec: number;
    safeFinalityTimeSec: number;
    description?: string;
}
export type NetworkGasModelType = 'EVM_LEGACY' | 'EVM_EIP1559' | 'EVM_OP_STACK_L2' | 'EVM_ARBITRUM_L2' | 'SOLANA_FEE' | 'UTXO_FEE' | 'COSMOS_FEE' | 'CHAIN_SPECIFIC';
export interface NetworkGasConfig {
    modelType: NetworkGasModelType;
    supportsEIP1559: boolean;
    supportsBlobTransactions?: boolean;
    baseFeeUnit: string;
    typicalSwapGasUnits: number;
    typicalBridgeGasUnits: number;
    description?: string;
}
export interface NativeAssetConfig {
    symbol: string;
    name: string;
    decimals: number;
    address: string;
    isNative: true;
    logoURI?: string;
}
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
export type NetworkHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'CIRCUIT_OPEN' | 'RECOVERING';
export interface NetworkRpcEndpoint {
    url: string;
    priority: number;
    weight?: number;
    isPrivate?: boolean;
    supportsSimulation?: boolean;
    status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
}
export interface NetworkExplorerConfig {
    name: string;
    baseUrl: string;
    txPath: string;
    addressPath: string;
    tokenPath: string;
}
export interface NetworkCapabilityProfile {
    networkId: string;
    name: string;
    shortName: string;
    numericChainId?: number;
    family: NetworkFamily;
    isTestnet: boolean;
    operationalClassification: NetworkOperationalStatus;
    nativeAsset: NativeAssetConfig;
    onboardingState: NetworkOnboardingState;
    overallCapabilityLevel: NetworkCapabilityLevel;
    capabilityRank: number;
    readCapability: NetworkCapabilityLevel;
    preflightCapability: NetworkCapabilityLevel;
    txConstructionCapability: NetworkCapabilityLevel;
    signingCapability: NetworkCapabilityLevel;
    sameChainSwapCapability: NetworkCapabilityLevel;
    crossChainSourceCapability: NetworkCapabilityLevel;
    crossChainDestCapability: NetworkCapabilityLevel;
    finality: NetworkFinalityConfig;
    gas: NetworkGasConfig;
    supportedTokenStandards: string[];
    rpcEndpoints: NetworkRpcEndpoint[];
    explorer?: NetworkExplorerConfig;
    dexCapabilities: Record<string, DEXCapabilityRecord>;
    bridgeCorridors: BridgeCorridorRecord[];
    iconURI?: string;
    color?: string;
    notes?: string;
}
export interface NetworkExecutionReadiness {
    isExecutable: boolean;
    networkId: string;
    family: NetworkFamily;
    level: NetworkCapabilityLevel;
    rank: number;
    health: NetworkHealthStatus;
    rejectionReason?: string;
}
