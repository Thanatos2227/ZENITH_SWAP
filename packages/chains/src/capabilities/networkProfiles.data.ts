import { NetworkCapabilityProfile, NetworkCapabilityLevel, NETWORK_CAPABILITY_HIERARCHY, NetworkOnboardingState, NetworkOperationalStatus, NetworkFamily, NetworkFinalityModel, NetworkGasModelType } from './networkCapabilityTypes';
function createProfile(params: {
    networkId: string;
    name: string;
    shortName: string;
    numericChainId?: number;
    family: NetworkFamily;
    isTestnet?: boolean;
    operationalClassification: NetworkOperationalStatus;
    nativeAsset: {
        symbol: string;
        name: string;
        decimals: number;
        address: string;
    };
    onboardingState: NetworkOnboardingState;
    overallCapabilityLevel: NetworkCapabilityLevel;
    readCapability?: NetworkCapabilityLevel;
    preflightCapability?: NetworkCapabilityLevel;
    txConstructionCapability?: NetworkCapabilityLevel;
    signingCapability?: NetworkCapabilityLevel;
    sameChainSwapCapability?: NetworkCapabilityLevel;
    crossChainSourceCapability?: NetworkCapabilityLevel;
    crossChainDestCapability?: NetworkCapabilityLevel;
    finality: {
        model: NetworkFinalityModel;
        reorgSafetyBlocks: number;
        instantFinality: boolean;
        typicalBlockTimeSec: number;
        safeFinalityTimeSec: number;
        description?: string;
    };
    gas: {
        modelType: NetworkGasModelType;
        supportsEIP1559: boolean;
        supportsBlobTransactions?: boolean;
        baseFeeUnit: string;
        typicalSwapGasUnits: number;
        typicalBridgeGasUnits: number;
        description?: string;
    };
    supportedTokenStandards?: string[];
    rpcEndpoints?: Array<{
        url: string;
        priority: number;
        weight?: number;
        isPrivate?: boolean;
        supportsSimulation?: boolean;
        status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
    }>;
    explorer?: {
        name: string;
        baseUrl: string;
        txPath: string;
        addressPath: string;
        tokenPath: string;
    };
    dexCapabilities?: Record<string, any>;
    bridgeCorridors?: any[];
    iconURI?: string;
    color?: string;
    notes?: string;
}): NetworkCapabilityProfile {
    const overall = params.overallCapabilityLevel;
    const isTest = params.isTestnet ?? false;
    return {
        networkId: params.networkId.toLowerCase(),
        name: params.name,
        shortName: params.shortName,
        numericChainId: params.numericChainId,
        family: params.family,
        isTestnet: isTest,
        operationalClassification: params.operationalClassification,
        nativeAsset: {
            ...params.nativeAsset,
            isNative: true
        },
        onboardingState: params.onboardingState,
        overallCapabilityLevel: overall,
        capabilityRank: NETWORK_CAPABILITY_HIERARCHY[overall] ?? 0,
        readCapability: params.readCapability ?? overall,
        preflightCapability: params.preflightCapability ?? overall,
        txConstructionCapability: params.txConstructionCapability ?? overall,
        signingCapability: params.signingCapability ?? overall,
        sameChainSwapCapability: params.sameChainSwapCapability ?? overall,
        crossChainSourceCapability: params.crossChainSourceCapability ?? overall,
        crossChainDestCapability: params.crossChainDestCapability ?? overall,
        finality: params.finality,
        gas: params.gas,
        supportedTokenStandards: params.supportedTokenStandards ?? (params.family === 'EVM' ? ['ERC-20', 'Permit2'] : [params.nativeAsset.symbol]),
        rpcEndpoints: params.rpcEndpoints ?? [],
        explorer: params.explorer,
        dexCapabilities: params.dexCapabilities ?? {},
        bridgeCorridors: params.bridgeCorridors ?? [],
        iconURI: params.iconURI,
        color: params.color,
        notes: params.notes
    };
}
export const ZENITH_NETWORK_PROFILES: Record<string, NetworkCapabilityProfile> = {
    ethereum: createProfile({
        networkId: 'ethereum',
        name: 'Ethereum',
        shortName: 'Ethereum',
        numericChainId: 1,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'LIVE_VERIFIED',
        overallCapabilityLevel: 'LIVE_VERIFIED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 64, instantFinality: false, typicalBlockTimeSec: 12, safeFinalityTimeSec: 768, description: 'PoS with 2 finalized epochs (64 blocks)' },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, supportsBlobTransactions: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 140000, typicalBridgeGasUnits: 180000 },
        supportedTokenStandards: ['ERC-20', 'ERC-721', 'ERC-1155', 'Permit2'],
        dexCapabilities: {
            uniswap_v3: { dexId: 'uniswap_v3', name: 'Uniswap V3', routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564', swapMethods: ['exactInputSingle', 'exactInput'], supportedTokenStandards: ['ERC-20'], quoteCapability: 'LIVE_VERIFIED', executionCapability: 'LIVE_VERIFIED', liveVerified: true }
        },
        bridgeCorridors: [
            { providerId: 'across', destinationNetworkId: 'arbitrum', sourceTokenSymbol: 'USDC', destinationTokenSymbol: 'USDC', minAmountRaw: '1000000', quoteSupported: true, executionSupported: true, capabilityLevel: 'LIVE_VERIFIED' }
        ]
    }),
    polygon: createProfile({
        networkId: 'polygon',
        name: 'Polygon PoS',
        shortName: 'Polygon',
        numericChainId: 137,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'POL', name: 'Polygon Ecosystem Token', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'LIVE_VERIFIED',
        overallCapabilityLevel: 'LIVE_VERIFIED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 128, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 256, description: 'Bor/Heimdall PoS with 128-block reorg safety threshold' },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 150000, typicalBridgeGasUnits: 180000 },
        supportedTokenStandards: ['ERC-20', 'Permit2'],
        dexCapabilities: {
            uniswap_v3: { dexId: 'uniswap_v3', name: 'Uniswap V3', routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564', swapMethods: ['exactInputSingle'], supportedTokenStandards: ['ERC-20'], quoteCapability: 'LIVE_VERIFIED', executionCapability: 'LIVE_VERIFIED', liveVerified: true },
            quickswap_v3: { dexId: 'quickswap_v3', name: 'QuickSwap V3', routerAddress: '0xf5b509bB0909a69B1c207E495f687a596C168E12', swapMethods: ['exactInputSingle'], supportedTokenStandards: ['ERC-20'], quoteCapability: 'LIVE_VERIFIED', executionCapability: 'LIVE_VERIFIED', liveVerified: true }
        },
        bridgeCorridors: [
            { providerId: 'across', destinationNetworkId: 'arbitrum', sourceTokenSymbol: 'USDC', destinationTokenSymbol: 'USDC', minAmountRaw: '1000000', quoteSupported: true, executionSupported: true, capabilityLevel: 'LIVE_VERIFIED' }
        ]
    }),
    arbitrum: createProfile({
        networkId: 'arbitrum',
        name: 'Arbitrum One',
        shortName: 'Arbitrum',
        numericChainId: 42161,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'LIVE_VERIFIED',
        overallCapabilityLevel: 'LIVE_VERIFIED',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 0.25, safeFinalityTimeSec: 5, description: 'Arbitrum Nitro with 20 reorg safety blocks for soft finality' },
        gas: { modelType: 'EVM_ARBITRUM_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 130000, typicalBridgeGasUnits: 180000 },
        supportedTokenStandards: ['ERC-20', 'Permit2'],
        dexCapabilities: {
            uniswap_v3: { dexId: 'uniswap_v3', name: 'Uniswap V3', routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564', swapMethods: ['exactInputSingle'], supportedTokenStandards: ['ERC-20'], quoteCapability: 'LIVE_VERIFIED', executionCapability: 'LIVE_VERIFIED', liveVerified: true },
            camelot_v3: { dexId: 'camelot_v3', name: 'Camelot V3', routerAddress: '0x1F721E2E82F6676FCE4eA07A5958cF098D339e18', swapMethods: ['exactInputSingle'], supportedTokenStandards: ['ERC-20'], quoteCapability: 'LIVE_VERIFIED', executionCapability: 'LIVE_VERIFIED', liveVerified: true }
        },
        bridgeCorridors: [
            { providerId: 'across', destinationNetworkId: 'polygon', sourceTokenSymbol: 'USDC', destinationTokenSymbol: 'USDC', minAmountRaw: '1000000', quoteSupported: true, executionSupported: true, capabilityLevel: 'LIVE_VERIFIED' }
        ]
    }),
    base: createProfile({
        networkId: 'base',
        name: 'Base',
        shortName: 'Base',
        numericChainId: 8453,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'LIVE_VERIFIED',
        overallCapabilityLevel: 'LIVE_VERIFIED',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40, description: 'OP Stack Rollup with 20 reorg safety blocks' },
        gas: { modelType: 'EVM_OP_STACK_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 120000, typicalBridgeGasUnits: 180000 },
        supportedTokenStandards: ['ERC-20', 'Permit2'],
        dexCapabilities: {
            uniswap_v3: { dexId: 'uniswap_v3', name: 'Uniswap V3', routerAddress: '0x2626664c2603336E57B271c5C0b26F421741e481', swapMethods: ['exactInputSingle'], supportedTokenStandards: ['ERC-20'], quoteCapability: 'LIVE_VERIFIED', executionCapability: 'LIVE_VERIFIED', liveVerified: true },
            aerodrome: { dexId: 'aerodrome', name: 'Aerodrome', routerAddress: '0xcF77a3Ba9A5CA399B7c97c74854691473d4570BC', swapMethods: ['swapExactTokensForTokens'], supportedTokenStandards: ['ERC-20'], quoteCapability: 'LIVE_VERIFIED', executionCapability: 'LIVE_VERIFIED', liveVerified: true }
        }
    }),
    optimism: createProfile({
        networkId: 'optimism',
        name: 'OP Mainnet',
        shortName: 'Optimism',
        numericChainId: 10,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'LIVE_VERIFIED',
        overallCapabilityLevel: 'LIVE_VERIFIED',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40, description: 'OP Stack Rollup with 20 reorg safety blocks' },
        gas: { modelType: 'EVM_OP_STACK_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 125000, typicalBridgeGasUnits: 180000 },
        supportedTokenStandards: ['ERC-20', 'Permit2'],
        dexCapabilities: {
            uniswap_v3: { dexId: 'uniswap_v3', name: 'Uniswap V3', routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564', swapMethods: ['exactInputSingle'], supportedTokenStandards: ['ERC-20'], quoteCapability: 'LIVE_VERIFIED', executionCapability: 'LIVE_VERIFIED', liveVerified: true }
        }
    }),
    bnb: createProfile({
        networkId: 'bnb',
        name: 'BNB Smart Chain',
        shortName: 'BNB Chain',
        numericChainId: 56,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'BNB', name: 'BNB', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'EXECUTION_ENABLED',
        overallCapabilityLevel: 'EXECUTION_AVAILABLE',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 15, instantFinality: false, typicalBlockTimeSec: 3, safeFinalityTimeSec: 45 },
        gas: { modelType: 'EVM_LEGACY', supportsEIP1559: false, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 135000, typicalBridgeGasUnits: 180000 }
    }),
    avalanche: createProfile({
        networkId: 'avalanche',
        name: 'Avalanche C-Chain',
        shortName: 'Avalanche',
        numericChainId: 43114,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'AVAX', name: 'Avalanche', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'EXECUTION_ENABLED',
        overallCapabilityLevel: 'EXECUTION_AVAILABLE',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 2, safeFinalityTimeSec: 2, description: 'Avalanche Snowman consensus instant finality' },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'nAVAX', typicalSwapGasUnits: 140000, typicalBridgeGasUnits: 180000 }
    }),
    linea: createProfile({
        networkId: 'linea',
        name: 'Linea',
        shortName: 'Linea',
        numericChainId: 59144,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'QUOTE_ENABLED',
        overallCapabilityLevel: 'QUOTE_AVAILABLE',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 145000, typicalBridgeGasUnits: 180000 }
    }),
    zksync: createProfile({
        networkId: 'zksync',
        name: 'ZKsync Era',
        shortName: 'ZKsync',
        numericChainId: 324,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'QUOTE_ENABLED',
        overallCapabilityLevel: 'QUOTE_AVAILABLE',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 1, safeFinalityTimeSec: 20 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 160000, typicalBridgeGasUnits: 200000 }
    }),
    scroll: createProfile({
        networkId: 'scroll',
        name: 'Scroll',
        shortName: 'Scroll',
        numericChainId: 534352,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'QUOTE_ENABLED',
        overallCapabilityLevel: 'QUOTE_AVAILABLE',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 3, safeFinalityTimeSec: 60 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 150000, typicalBridgeGasUnits: 180000 }
    }),
    blast: createProfile({
        networkId: 'blast',
        name: 'Blast',
        shortName: 'Blast',
        numericChainId: 81457,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'QUOTE_ENABLED',
        overallCapabilityLevel: 'QUOTE_AVAILABLE',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_OP_STACK_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 125000, typicalBridgeGasUnits: 180000 }
    }),
    unichain: createProfile({
        networkId: 'unichain',
        name: 'Unichain',
        shortName: 'Unichain',
        numericChainId: 130,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'QUOTE_ENABLED',
        overallCapabilityLevel: 'QUOTE_AVAILABLE',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 1, safeFinalityTimeSec: 20 },
        gas: { modelType: 'EVM_OP_STACK_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 110000, typicalBridgeGasUnits: 160000 }
    }),
    zora: createProfile({
        networkId: 'zora',
        name: 'Zora',
        shortName: 'Zora',
        numericChainId: 7777777,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_OP_STACK_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 115000, typicalBridgeGasUnits: 160000 }
    }),
    worldchain: createProfile({
        networkId: 'worldchain',
        name: 'World Chain',
        shortName: 'World',
        numericChainId: 480,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_OP_STACK_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 115000, typicalBridgeGasUnits: 160000 }
    }),
    mantle: createProfile({
        networkId: 'mantle',
        name: 'Mantle',
        shortName: 'Mantle',
        numericChainId: 5000,
        family: 'EVM',
        operationalClassification: 'SUPPORTED',
        nativeAsset: { symbol: 'MNT', name: 'Mantle', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 0.5, safeFinalityTimeSec: 10 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 120000, typicalBridgeGasUnits: 160000 }
    }),
    celo: createProfile({
        networkId: 'celo',
        name: 'Celo',
        shortName: 'Celo',
        numericChainId: 42220,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'CELO', name: 'Celo', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 5, safeFinalityTimeSec: 5 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 90000, typicalBridgeGasUnits: 140000 }
    }),
    gnosis: createProfile({
        networkId: 'gnosis',
        name: 'Gnosis Chain',
        shortName: 'Gnosis',
        numericChainId: 100,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'xDAI', name: 'xDAI', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 12, instantFinality: false, typicalBlockTimeSec: 5, safeFinalityTimeSec: 60 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 130000, typicalBridgeGasUnits: 160000 }
    }),
    sonic: createProfile({
        networkId: 'sonic',
        name: 'Sonic',
        shortName: 'Sonic',
        numericChainId: 146,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'S', name: 'Sonic', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.4, safeFinalityTimeSec: 1 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 70000, typicalBridgeGasUnits: 120000 }
    }),
    soneium: createProfile({
        networkId: 'soneium',
        name: 'Soneium',
        shortName: 'Soneium',
        numericChainId: 1868,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_OP_STACK_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 120000, typicalBridgeGasUnits: 160000 }
    }),
    berachain: createProfile({
        networkId: 'berachain',
        name: 'Berachain',
        shortName: 'Berachain',
        numericChainId: 80094,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'BERA', name: 'Bera', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 130000, typicalBridgeGasUnits: 160000 }
    }),
    cronos: createProfile({
        networkId: 'cronos',
        name: 'Cronos',
        shortName: 'Cronos',
        numericChainId: 25,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'CRO', name: 'Cronos', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 6, safeFinalityTimeSec: 120 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 140000, typicalBridgeGasUnits: 180000 }
    }),
    xlayer: createProfile({
        networkId: 'xlayer',
        name: 'X Layer',
        shortName: 'X Layer',
        numericChainId: 196,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'OKB', name: 'OKB', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 3, safeFinalityTimeSec: 60 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 135000, typicalBridgeGasUnits: 170000 }
    }),
    sei: createProfile({
        networkId: 'sei',
        name: 'Sei Network',
        shortName: 'Sei',
        numericChainId: 1329,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'SEI', name: 'Sei', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.4, safeFinalityTimeSec: 1 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'usei', typicalSwapGasUnits: 65000, typicalBridgeGasUnits: 120000 }
    }),
    arbitrumnova: createProfile({
        networkId: 'arbitrumnova',
        name: 'Arbitrum Nova',
        shortName: 'Arb Nova',
        numericChainId: 42170,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 0.25, safeFinalityTimeSec: 5 },
        gas: { modelType: 'EVM_ARBITRUM_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 110000, typicalBridgeGasUnits: 150000 }
    }),
    polygonzkevm: createProfile({
        networkId: 'polygonzkevm',
        name: 'Polygon zkEVM',
        shortName: 'zkEVM',
        numericChainId: 1101,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 150000, typicalBridgeGasUnits: 180000 }
    }),
    mode: createProfile({
        networkId: 'mode',
        name: 'Mode',
        shortName: 'Mode',
        numericChainId: 34443,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_OP_STACK_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 120000, typicalBridgeGasUnits: 160000 }
    }),
    taiko: createProfile({
        networkId: 'taiko',
        name: 'Taiko',
        shortName: 'Taiko',
        numericChainId: 167000,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 12, safeFinalityTimeSec: 240 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 140000, typicalBridgeGasUnits: 180000 }
    }),
    metis: createProfile({
        networkId: 'metis',
        name: 'Metis Andromeda',
        shortName: 'Metis',
        numericChainId: 1088,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'METIS', name: 'Metis', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 130000, typicalBridgeGasUnits: 170000 }
    }),
    moonbeam: createProfile({
        networkId: 'moonbeam',
        name: 'Moonbeam',
        shortName: 'Moonbeam',
        numericChainId: 1284,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'GLMR', name: 'Glimmer', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 24, instantFinality: false, typicalBlockTimeSec: 12, safeFinalityTimeSec: 288 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 145000, typicalBridgeGasUnits: 180000 }
    }),
    moonriver: createProfile({
        networkId: 'moonriver',
        name: 'Moonriver',
        shortName: 'Moonriver',
        numericChainId: 1285,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'MOVR', name: 'Moonriver', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 24, instantFinality: false, typicalBlockTimeSec: 12, safeFinalityTimeSec: 288 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 145000, typicalBridgeGasUnits: 180000 }
    }),
    rootstock: createProfile({
        networkId: 'rootstock',
        name: 'Rootstock',
        shortName: 'RSK',
        numericChainId: 30,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'RBTC', name: 'Smart Bitcoin', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'PROBABILISTIC', reorgSafetyBlocks: 12, instantFinality: false, typicalBlockTimeSec: 30, safeFinalityTimeSec: 360 },
        gas: { modelType: 'EVM_LEGACY', supportsEIP1559: false, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 160000, typicalBridgeGasUnits: 200000 }
    }),
    hedera: createProfile({
        networkId: 'hedera',
        name: 'Hedera',
        shortName: 'Hedera',
        numericChainId: 295,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'HBAR', name: 'Hedera', decimals: 8, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 3, safeFinalityTimeSec: 3 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'tinybar', typicalSwapGasUnits: 50000, typicalBridgeGasUnits: 80000 }
    }),
    monad: createProfile({
        networkId: 'monad',
        name: 'Monad',
        shortName: 'Monad',
        numericChainId: 10143,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'MON', name: 'Monad', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'DISCOVERED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 1, safeFinalityTimeSec: 1 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 80000, typicalBridgeGasUnits: 120000 }
    }),
    robinhood: createProfile({
        networkId: 'robinhood',
        name: 'Robinhood Chain',
        shortName: 'Robinhood',
        numericChainId: 421610,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 0.25, safeFinalityTimeSec: 5 },
        gas: { modelType: 'EVM_ARBITRUM_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 95000, typicalBridgeGasUnits: 150000 },
        notes: 'Arbitrum Orbit L3 chain. Numeric chain ID disambiguated to 421610 to prevent collision with Arbitrum One (42161).'
    }),
    tempo: createProfile({
        networkId: 'tempo',
        name: 'Tempo',
        shortName: 'Tempo',
        numericChainId: 2024,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'TEMPO', name: 'Tempo', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'DISCOVERED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 75000, typicalBridgeGasUnits: 120000 }
    }),
    megaeth: createProfile({
        networkId: 'megaeth',
        name: 'MegaETH',
        shortName: 'MegaETH',
        numericChainId: 4242,
        family: 'EVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'ETH', name: 'Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'DISCOVERED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.01, safeFinalityTimeSec: 0.1 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 60000, typicalBridgeGasUnits: 100000 }
    }),
    solana: createProfile({
        networkId: 'solana',
        name: 'Solana',
        shortName: 'Solana',
        family: 'SOLANA',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'SOL', name: 'Solana', decimals: 9, address: '11111111111111111111111111111111' },
        onboardingState: 'QUOTE_ENABLED',
        overallCapabilityLevel: 'QUOTE_AVAILABLE',
        readCapability: 'QUOTE_AVAILABLE',
        preflightCapability: 'CONFIGURED',
        txConstructionCapability: 'CONFIGURED',
        signingCapability: 'UNSUPPORTED',
        sameChainSwapCapability: 'QUOTE_AVAILABLE',
        crossChainSourceCapability: 'UNSUPPORTED',
        crossChainDestCapability: 'UNSUPPORTED',
        finality: { model: 'CHAIN_SPECIFIC', reorgSafetyBlocks: 32, instantFinality: false, typicalBlockTimeSec: 0.4, safeFinalityTimeSec: 12.8, description: 'Solana Tower BFT rooted slot finality (32 confirmed slots)' },
        gas: { modelType: 'SOLANA_FEE', supportsEIP1559: false, baseFeeUnit: 'Lamports', typicalSwapGasUnits: 5000, typicalBridgeGasUnits: 10000, description: 'Base signature fee (5,000 lamports) + ComputeBudget micro-lamports' },
        supportedTokenStandards: ['SPL', 'SPL-2022'],
        notes: 'Solana read and quote enabled. Direct execution adapter scheduled for Phase 2/3.'
    }),
    aptos: createProfile({
        networkId: 'aptos',
        name: 'Aptos',
        shortName: 'Aptos',
        family: 'MOVE',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'APT', name: 'Aptos Coin', decimals: 8, address: '0x1::aptos_coin::AptosCoin' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.2, safeFinalityTimeSec: 1, description: 'AptosBFT state machine replication' },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'Octas', typicalSwapGasUnits: 2500, typicalBridgeGasUnits: 5000 },
        supportedTokenStandards: ['Move Coin'],
        notes: 'Aptos Move network. Numeric EVM chainId omitted to prevent collision with Ethereum (1).'
    }),
    sui: createProfile({
        networkId: 'sui',
        name: 'Sui',
        shortName: 'Sui',
        family: 'MOVE',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'SUI', name: 'Sui', decimals: 9, address: '0x2::sui::SUI' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.4, safeFinalityTimeSec: 1, description: 'Mysticeti / Narwhal consensus checkpoint' },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'MIST', typicalSwapGasUnits: 2000, typicalBridgeGasUnits: 4000 },
        supportedTokenStandards: ['Move Object']
    }),
    near: createProfile({
        networkId: 'near',
        name: 'NEAR Protocol',
        shortName: 'NEAR',
        family: 'NEAR',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'NEAR', name: 'NEAR', decimals: 24, address: 'wrap.near' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 2, instantFinality: true, typicalBlockTimeSec: 1.2, safeFinalityTimeSec: 2.5 },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'Tgas', typicalSwapGasUnits: 1000, typicalBridgeGasUnits: 2000 },
        supportedTokenStandards: ['NEP-141']
    }),
    cosmoshub: createProfile({
        networkId: 'cosmoshub',
        name: 'Cosmos Hub',
        shortName: 'Cosmos',
        family: 'COSMOS',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'ATOM', name: 'Cosmos', decimals: 6, address: 'uatom' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 6, safeFinalityTimeSec: 6, description: 'CometBFT instant finality' },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'uatom', typicalSwapGasUnits: 150000, typicalBridgeGasUnits: 200000 },
        supportedTokenStandards: ['Cosmos Bank Coin', 'IBC Voucher']
    }),
    osmosis: createProfile({
        networkId: 'osmosis',
        name: 'Osmosis',
        shortName: 'Osmosis',
        family: 'COSMOS',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'OSMO', name: 'Osmosis', decimals: 6, address: 'uosmo' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 6, safeFinalityTimeSec: 6 },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'uosmo', typicalSwapGasUnits: 120000, typicalBridgeGasUnits: 160000 },
        supportedTokenStandards: ['Cosmos Bank Coin', 'IBC Voucher']
    }),
    injective: createProfile({
        networkId: 'injective',
        name: 'Injective',
        shortName: 'Injective',
        family: 'COSMOS',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'INJ', name: 'Injective', decimals: 18, address: 'inj' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.8, safeFinalityTimeSec: 1 },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'inj', typicalSwapGasUnits: 80000, typicalBridgeGasUnits: 120000 },
        supportedTokenStandards: ['Cosmos Bank Coin', 'CW-20']
    }),
    tron: createProfile({
        networkId: 'tron',
        name: 'TRON',
        shortName: 'TRON',
        family: 'TVM',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'TRX', name: 'TRON', decimals: 6, address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 19, instantFinality: false, typicalBlockTimeSec: 3, safeFinalityTimeSec: 57 },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'sun', typicalSwapGasUnits: 65000, typicalBridgeGasUnits: 100000 },
        supportedTokenStandards: ['TRC-20', 'TRC-10']
    }),
    ton: createProfile({
        networkId: 'ton',
        name: 'The Open Network',
        shortName: 'TON',
        family: 'TON',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'TON', name: 'Toncoin', decimals: 9, address: 'native' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'CHAIN_SPECIFIC', reorgSafetyBlocks: 12, instantFinality: false, typicalBlockTimeSec: 5, safeFinalityTimeSec: 60 },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'nanoton', typicalSwapGasUnits: 5000, typicalBridgeGasUnits: 10000 },
        supportedTokenStandards: ['Jetton']
    }),
    bitcoin: createProfile({
        networkId: 'bitcoin',
        name: 'Bitcoin',
        shortName: 'Bitcoin',
        family: 'BITCOIN',
        operationalClassification: 'PARTIALLY_SUPPORTED',
        nativeAsset: { symbol: 'BTC', name: 'Bitcoin', decimals: 8, address: 'native' },
        onboardingState: 'CONFIGURED',
        overallCapabilityLevel: 'CONFIGURED',
        finality: { model: 'PROBABILISTIC', reorgSafetyBlocks: 6, instantFinality: false, typicalBlockTimeSec: 600, safeFinalityTimeSec: 3600, description: 'PoW 6-block standard finality' },
        gas: { modelType: 'UTXO_FEE', supportsEIP1559: false, baseFeeUnit: 'sat/vB', typicalSwapGasUnits: 250, typicalBridgeGasUnits: 500 },
        supportedTokenStandards: ['BTC (Native)']
    }),
    dogecoin: createProfile({
        networkId: 'dogecoin',
        name: 'Dogecoin',
        shortName: 'Dogecoin',
        family: 'UTXO',
        operationalClassification: 'UNSUPPORTED',
        nativeAsset: { symbol: 'DOGE', name: 'Dogecoin', decimals: 8, address: 'native' },
        onboardingState: 'DISCOVERED',
        overallCapabilityLevel: 'UNSUPPORTED',
        finality: { model: 'PROBABILISTIC', reorgSafetyBlocks: 60, instantFinality: false, typicalBlockTimeSec: 60, safeFinalityTimeSec: 3600 },
        gas: { modelType: 'UTXO_FEE', supportsEIP1559: false, baseFeeUnit: 'sat/vB', typicalSwapGasUnits: 250, typicalBridgeGasUnits: 500 }
    }),
    polkadot: createProfile({
        networkId: 'polkadot',
        name: 'Polkadot',
        shortName: 'Polkadot',
        family: 'SUBSTRATE',
        operationalClassification: 'UNSUPPORTED',
        nativeAsset: { symbol: 'DOT', name: 'Polkadot', decimals: 10, address: 'native' },
        onboardingState: 'DISCOVERED',
        overallCapabilityLevel: 'UNSUPPORTED',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 2, instantFinality: false, typicalBlockTimeSec: 6, safeFinalityTimeSec: 12 },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'Planck', typicalSwapGasUnits: 150000, typicalBridgeGasUnits: 200000 }
    }),
    cardano: createProfile({
        networkId: 'cardano',
        name: 'Cardano',
        shortName: 'Cardano',
        family: 'UTXO',
        operationalClassification: 'UNSUPPORTED',
        nativeAsset: { symbol: 'ADA', name: 'Cardano', decimals: 6, address: 'native' },
        onboardingState: 'DISCOVERED',
        overallCapabilityLevel: 'UNSUPPORTED',
        finality: { model: 'PROBABILISTIC', reorgSafetyBlocks: 15, instantFinality: false, typicalBlockTimeSec: 20, safeFinalityTimeSec: 300 },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'lovelace', typicalSwapGasUnits: 200000, typicalBridgeGasUnits: 300000 }
    }),
    algorand: createProfile({
        networkId: 'algorand',
        name: 'Algorand',
        shortName: 'Algorand',
        family: 'UTXO',
        operationalClassification: 'UNSUPPORTED',
        nativeAsset: { symbol: 'ALGO', name: 'Algorand', decimals: 6, address: 'native' },
        onboardingState: 'DISCOVERED',
        overallCapabilityLevel: 'UNSUPPORTED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 3.3, safeFinalityTimeSec: 3.3 },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'microAlgos', typicalSwapGasUnits: 1000, typicalBridgeGasUnits: 2000 }
    }),
    stellar: createProfile({
        networkId: 'stellar',
        name: 'Stellar',
        shortName: 'Stellar',
        family: 'STELLAR',
        operationalClassification: 'UNSUPPORTED',
        nativeAsset: { symbol: 'XLM', name: 'Lumen', decimals: 7, address: 'native' },
        onboardingState: 'DISCOVERED',
        overallCapabilityLevel: 'UNSUPPORTED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 5, safeFinalityTimeSec: 5 },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'stroops', typicalSwapGasUnits: 100, typicalBridgeGasUnits: 200 }
    }),
    xrpl: createProfile({
        networkId: 'xrpl',
        name: 'XRP Ledger',
        shortName: 'XRPL',
        family: 'XRPL',
        operationalClassification: 'UNSUPPORTED',
        nativeAsset: { symbol: 'XRP', name: 'XRP', decimals: 6, address: 'native' },
        onboardingState: 'DISCOVERED',
        overallCapabilityLevel: 'UNSUPPORTED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 4, safeFinalityTimeSec: 4 },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'drops', typicalSwapGasUnits: 12, typicalBridgeGasUnits: 25 }
    }),
    icp: createProfile({
        networkId: 'icp',
        name: 'Internet Computer',
        shortName: 'ICP',
        family: 'ICP',
        operationalClassification: 'UNSUPPORTED',
        nativeAsset: { symbol: 'ICP', name: 'Internet Computer', decimals: 8, address: 'native' },
        onboardingState: 'DISCOVERED',
        overallCapabilityLevel: 'UNSUPPORTED',
        finality: { model: 'INSTANT_FINALITY', reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 1, safeFinalityTimeSec: 2 },
        gas: { modelType: 'CHAIN_SPECIFIC', supportsEIP1559: false, baseFeeUnit: 'cycles', typicalSwapGasUnits: 10000, typicalBridgeGasUnits: 20000 }
    }),
    sepolia: createProfile({
        networkId: 'sepolia',
        name: 'Ethereum Sepolia',
        shortName: 'Sepolia',
        numericChainId: 11155111,
        family: 'EVM',
        isTestnet: true,
        operationalClassification: 'TESTNET_ONLY',
        nativeAsset: { symbol: 'ETH', name: 'Sepolia Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'UNIT_TESTED',
        overallCapabilityLevel: 'EXECUTION_AVAILABLE',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 12, instantFinality: false, typicalBlockTimeSec: 12, safeFinalityTimeSec: 144 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 140000, typicalBridgeGasUnits: 180000 }
    }),
    arbitrum_sepolia: createProfile({
        networkId: 'arbitrum_sepolia',
        name: 'Arbitrum Sepolia',
        shortName: 'Arb Sepolia',
        numericChainId: 421614,
        family: 'EVM',
        isTestnet: true,
        operationalClassification: 'TESTNET_ONLY',
        nativeAsset: { symbol: 'ETH', name: 'Sepolia Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'UNIT_TESTED',
        overallCapabilityLevel: 'EXECUTION_AVAILABLE',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 0.25, safeFinalityTimeSec: 5 },
        gas: { modelType: 'EVM_ARBITRUM_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 130000, typicalBridgeGasUnits: 180000 }
    }),
    base_sepolia: createProfile({
        networkId: 'base_sepolia',
        name: 'Base Sepolia',
        shortName: 'Base Sepolia',
        numericChainId: 84532,
        family: 'EVM',
        isTestnet: true,
        operationalClassification: 'TESTNET_ONLY',
        nativeAsset: { symbol: 'ETH', name: 'Sepolia Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'UNIT_TESTED',
        overallCapabilityLevel: 'EXECUTION_AVAILABLE',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_OP_STACK_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 120000, typicalBridgeGasUnits: 180000 }
    }),
    optimism_sepolia: createProfile({
        networkId: 'optimism_sepolia',
        name: 'Optimism Sepolia',
        shortName: 'OP Sepolia',
        numericChainId: 11155420,
        family: 'EVM',
        isTestnet: true,
        operationalClassification: 'TESTNET_ONLY',
        nativeAsset: { symbol: 'ETH', name: 'Sepolia Ether', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'UNIT_TESTED',
        overallCapabilityLevel: 'EXECUTION_AVAILABLE',
        finality: { model: 'OPTIMISTIC', reorgSafetyBlocks: 20, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 40 },
        gas: { modelType: 'EVM_OP_STACK_L2', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 125000, typicalBridgeGasUnits: 180000 }
    }),
    polygon_amoy: createProfile({
        networkId: 'polygon_amoy',
        name: 'Polygon Amoy',
        shortName: 'Amoy',
        numericChainId: 80002,
        family: 'EVM',
        isTestnet: true,
        operationalClassification: 'TESTNET_ONLY',
        nativeAsset: { symbol: 'POL', name: 'Polygon Ecosystem Token', decimals: 18, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
        onboardingState: 'UNIT_TESTED',
        overallCapabilityLevel: 'EXECUTION_AVAILABLE',
        finality: { model: 'CONFIRMATION_BASED', reorgSafetyBlocks: 64, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 128 },
        gas: { modelType: 'EVM_EIP1559', supportsEIP1559: true, baseFeeUnit: 'Gwei', typicalSwapGasUnits: 150000, typicalBridgeGasUnits: 180000 }
    })
};
