import { ChainConfig } from '@zenith/types';

export const ZENITH_SUPPORTED_CHAINS: Record<string, ChainConfig> = {

  ethereum: {
    id: 'ethereum',
    chainId: 1,
    canonicalName: 'Ethereum',
    shortName: 'Ethereum',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'ERC-721', 'ERC-1155', 'ERC-4626', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [
      { url: 'https://eth.llamarpc.com', priority: 1, status: 'HEALTHY' },
      { url: 'https://rpc.ankr.com/eth', priority: 2, status: 'HEALTHY' },
      { url: 'https://cloudflare-eth.com', priority: 3, status: 'HEALTHY' }
    ],
    explorer: {
      name: 'Etherscan',
      baseUrl: 'https://etherscan.io',
      txPath: '/tx/',
      addressPath: '/address/',
      tokenPath: '/token/'
    },
    finality: {
      reorgSafetyBlocks: 64,
      instantFinality: false,
      typicalBlockTimeSec: 12,
      safeFinalityTimeSec: 768
    },
    capabilities: {
      wallet: true,
      tokenDiscovery: true,
      tokenRisk: true,
      priceData: true,
      liquidityDiscovery: true,
      swap: true,
      smartRouting: true,
      simulation: true,
      portfolio: true,
      history: true,
      mevProtection: true,
      crossChain: true,
      zenithLiquidity: true,
      api: true,
      sdk: true,
      supportsEIP1559: true,
      supportsPermit2: true,
      supportsFlashbots: true,
      supportsSimulation: true,
      supportsBatchTransactions: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'DEEP',
    productionStatus: 'ACTIVE',
    color: '#627EEA',
    iconURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'ethereum',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        chainId: 'ethereum',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/2518/small/weth.png'
      },
      {
        address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        chainId: 'ethereum',
        name: 'Wrapped BTC',
        symbol: 'WBTC',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png'
      },
      {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        chainId: 'ethereum',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        chainId: 'ethereum',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        chainId: 'ethereum',
        name: 'Dai Stablecoin',
        symbol: 'DAI',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png'
      },
      {
        address: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8',
        chainId: 'ethereum',
        name: 'PayPal USD',
        symbol: 'PYUSD',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: '/tokens/pyusd.svg'
      },
      {
        address: '0xdC035D45d973E3EC169d2276DDab1CEF12B266fe',
        chainId: 'ethereum',
        name: 'Sky Dollar',
        symbol: 'USDS',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://coin-images.coingecko.com/coins/images/39926/large/usds.webp'
      },
      {
        address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
        chainId: 'ethereum',
        name: 'Uniswap',
        symbol: 'UNI',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png'
      },
      {
        address: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
        chainId: 'ethereum',
        name: 'Chainlink',
        symbol: 'LINK',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png'
      },
      {
        address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
        chainId: 'ethereum',
        name: 'Aave',
        symbol: 'AAVE',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: '/tokens/aave.svg'
      },
      {
        address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
        chainId: 'ethereum',
        name: 'Maker',
        symbol: 'MKR',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/1364/small/Mark_Maker.png'
      },
      {
        address: '0x5A98FcBEA516Cf06857215779Fd812CA9Bef1B32',
        chainId: 'ethereum',
        name: 'Lido DAO',
        symbol: 'LDO',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/13573/small/Lido_DAO.png'
      },
      {
        address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
        chainId: 'ethereum',
        name: 'Wrapped Lido Staked ETH',
        symbol: 'wstETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/18834/small/wstETH.png'
      },
      {
        address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
        chainId: 'ethereum',
        name: 'Pepe',
        symbol: 'PEPE',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.png'
      },
      {
        address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
        chainId: 'ethereum',
        name: 'Shiba Inu',
        symbol: 'SHIB',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://assets.coingecko.com/coins/images/11939/small/shiba.png'
      },
      {
        address: '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3',
        chainId: 'ethereum',
        name: 'Ondo Finance',
        symbol: 'ONDO',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3/logo.png'
      },
      {
        address: '0x455e53C3640fD1f044e5522f9611D1a7E02a3a0e',
        chainId: 'ethereum',
        name: 'Polygon Ecosystem Token (ERC-20)',
        symbol: 'POL',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png'
      }
    ]
  },

  base: {
    id: 'base',
    chainId: 8453,
    canonicalName: 'Base',
    shortName: 'Base',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'ERC-721', 'ERC-1155', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [
      { url: 'https://mainnet.base.org', priority: 1, status: 'HEALTHY' },
      { url: 'https://base.llamarpc.com', priority: 2, status: 'HEALTHY' }
    ],
    explorer: {
      name: 'BaseScan',
      baseUrl: 'https://basescan.org',
      txPath: '/tx/',
      addressPath: '/address/',
      tokenPath: '/token/'
    },
    finality: {
      reorgSafetyBlocks: 20,
      instantFinality: false,
      typicalBlockTimeSec: 2,
      safeFinalityTimeSec: 60
    },
    capabilities: {
      wallet: true,
      tokenDiscovery: true,
      tokenRisk: true,
      priceData: true,
      liquidityDiscovery: true,
      swap: true,
      smartRouting: true,
      simulation: true,
      portfolio: true,
      history: true,
      mevProtection: true,
      crossChain: true,
      zenithLiquidity: true,
      api: true,
      sdk: true,
      supportsEIP1559: true,
      supportsPermit2: true,
      supportsFlashbots: false,
      supportsSimulation: true,
      supportsBatchTransactions: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'DEEP',
    productionStatus: 'ACTIVE',
    color: '#0052FF',
    iconURI: '/networks/base.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'base',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x4200000000000000000000000000000000000006',
        chainId: 'base',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/2518/small/weth.png'
      },
      {
        address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
        chainId: 'base',
        name: 'Coinbase Wrapped BTC',
        symbol: 'cbBTC',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/40143/small/cbbtc.png'
      },
      {
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        chainId: 'base',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        chainId: 'base',
        name: 'Aerodrome Finance',
        symbol: 'AERO',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/0x940181a94A35A4569E4529A3CDfB74e38FD98631/logo.png'
      },
      {
        address: '0x4ed4E862860be51a747027084693a100E916B2D2',
        chainId: 'base',
        name: 'Degen',
        symbol: 'DEGEN',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: '/tokens/degen.png'
      },
      {
        address: '0x532f27101965dd16442E59d40670FaF5eBB142E4',
        chainId: 'base',
        name: 'Brett',
        symbol: 'BRETT',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://assets.coingecko.com/coins/images/35564/small/brett.png'
      },
      {
        address: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4',
        chainId: 'base',
        name: 'Toshi',
        symbol: 'TOSHI',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4/logo.png'
      },
      {
        address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
        chainId: 'base',
        name: 'Virtuals Protocol',
        symbol: 'VIRTUAL',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b/logo.png'
      }
    ]
  },

  arbitrum: {
    id: 'arbitrum',
    chainId: 42161,
    canonicalName: 'Arbitrum',
    shortName: 'Arbitrum',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'ERC-721', 'ERC-1155', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [
      { url: 'https://arb1.arbitrum.io/rpc', priority: 1, status: 'HEALTHY' },
      { url: 'https://arbitrum.llamarpc.com', priority: 2, status: 'HEALTHY' }
    ],
    explorer: {
      name: 'Arbiscan',
      baseUrl: 'https://arbiscan.io',
      txPath: '/tx/',
      addressPath: '/address/',
      tokenPath: '/token/'
    },
    finality: {
      reorgSafetyBlocks: 20,
      instantFinality: false,
      typicalBlockTimeSec: 0.25,
      safeFinalityTimeSec: 30
    },
    capabilities: {
      wallet: true,
      tokenDiscovery: true,
      tokenRisk: true,
      priceData: true,
      liquidityDiscovery: true,
      swap: true,
      smartRouting: true,
      simulation: true,
      portfolio: true,
      history: true,
      mevProtection: true,
      crossChain: true,
      zenithLiquidity: true,
      api: true,
      sdk: true,
      supportsEIP1559: true,
      supportsPermit2: true,
      supportsFlashbots: false,
      supportsSimulation: true,
      supportsBatchTransactions: true,
      hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'DEEP',
    productionStatus: 'ACTIVE',
    color: '#28A0F0',
    iconURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'arbitrum',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        chainId: 'arbitrum',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/2518/small/weth.png'
      },
      {
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        chainId: 'arbitrum',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        chainId: 'arbitrum',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
        chainId: 'arbitrum',
        name: 'Wrapped BTC',
        symbol: 'WBTC',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png'
      },
      {
        address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
        chainId: 'arbitrum',
        name: 'Arbitrum',
        symbol: 'ARB',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png'
      },
      {
        address: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a',
        chainId: 'arbitrum',
        name: 'GMX',
        symbol: 'GMX',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/18323/small/arbit.png'
      },
      {
        address: '0x0c880f67ed5009C07d380B4306812053D4b74644',
        chainId: 'arbitrum',
        name: 'Pendle',
        symbol: 'PENDLE',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x808507121B80c02388fAd14726482e061B8da827/logo.png'
      }
    ]
  },

  optimism: {
    id: 'optimism',
    chainId: 10,
    canonicalName: 'Optimism',
    shortName: 'Optimism',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'ERC-721', 'ERC-1155', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [
      { url: 'https://mainnet.optimism.io', priority: 1, status: 'HEALTHY' },
      { url: 'https://optimism.llamarpc.com', priority: 2, status: 'HEALTHY' }
    ],
    explorer: {
      name: 'OP Etherscan',
      baseUrl: 'https://optimistic.etherscan.io',
      txPath: '/tx/',
      addressPath: '/address/',
      tokenPath: '/token/'
    },
    finality: {
      reorgSafetyBlocks: 20,
      instantFinality: false,
      typicalBlockTimeSec: 2,
      safeFinalityTimeSec: 60
    },
    capabilities: {
      wallet: true,
      tokenDiscovery: true,
      tokenRisk: true,
      priceData: true,
      liquidityDiscovery: true,
      swap: true,
      smartRouting: true,
      simulation: true,
      portfolio: true,
      history: true,
      mevProtection: true,
      crossChain: true,
      zenithLiquidity: true,
      api: true,
      sdk: true,
      supportsEIP1559: true,
      supportsPermit2: true,
      supportsFlashbots: false,
      supportsSimulation: true,
      supportsBatchTransactions: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'DEEP',
    productionStatus: 'ACTIVE',
    color: '#FF0420',
    iconURI: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'optimism',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x4200000000000000000000000000000000000042',
        chainId: 'optimism',
        name: 'Optimism',
        symbol: 'OP',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png'
      },
      {
        address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        chainId: 'optimism',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
        chainId: 'optimism',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db',
        chainId: 'optimism',
        name: 'Velodrome Finance',
        symbol: 'VELO',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/25783/small/velo.png'
      }
    ]
  },

  polygon: {
    id: 'polygon',
    chainId: 137,
    canonicalName: 'Polygon',
    shortName: 'Polygon',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'ERC-721', 'ERC-1155', 'Permit2'],
    nativeCurrency: { name: 'Polygon Ecosystem Token', symbol: 'POL', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png' },
    rpcEndpoints: [
      { url: 'https://polygon-bor-rpc.publicnode.com', priority: 1, status: 'HEALTHY' },
      { url: 'https://polygon.drpc.org', priority: 2, status: 'HEALTHY' },
      { url: 'https://polygon.gateway.tenderly.co', priority: 3, status: 'HEALTHY' },
      { url: 'https://polygon-rpc.com', priority: 4, status: 'HEALTHY' }
    ],
    explorer: {
      name: 'PolygonScan',
      baseUrl: 'https://polygonscan.com',
      txPath: '/tx/',
      addressPath: '/address/',
      tokenPath: '/token/'
    },
    finality: {
      reorgSafetyBlocks: 128,
      instantFinality: false,
      typicalBlockTimeSec: 2,
      safeFinalityTimeSec: 256
    },
    capabilities: {
      wallet: true,
      tokenDiscovery: true,
      tokenRisk: true,
      priceData: true,
      liquidityDiscovery: true,
      swap: true,
      smartRouting: true,
      simulation: true,
      portfolio: true,
      history: true,
      mevProtection: false,
      crossChain: true,
      zenithLiquidity: true,
      api: true,
      sdk: true,
      supportsEIP1559: true,
      supportsPermit2: true,
      supportsFlashbots: false,
      supportsSimulation: true,
      supportsBatchTransactions: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'DEEP',
    productionStatus: 'ACTIVE',
    color: '#8247E5',
    iconURI: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'polygon',
        name: 'Polygon Ecosystem Token',
        symbol: 'POL',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png'
      },
      {
        address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        chainId: 'polygon',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        chainId: 'polygon',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
        chainId: 'polygon',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/2518/small/weth.png'
      },
      {
        address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
        chainId: 'polygon',
        name: 'Wrapped BTC',
        symbol: 'WBTC',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png'
      },
      {
        address: '0xB5C064F955D8e7F38fE0460C556a72987494eE17',
        chainId: 'polygon',
        name: 'QuickSwap',
        symbol: 'QUICK',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/13970/small/quick.png'
      }
    ]
  },

  bnb: {
    id: 'bnb',
    chainId: 56,
    canonicalName: 'BNB Chain',
    shortName: 'BNB Chain',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['BEP-20', 'BEP-721', 'BEP-1155', 'Permit2'],
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png' },
    rpcEndpoints: [
      { url: 'https://bsc-dataseed.binance.org', priority: 1, status: 'HEALTHY' },
      { url: 'https://rpc.ankr.com/bsc', priority: 2, status: 'HEALTHY' }
    ],
    explorer: {
      name: 'BscScan',
      baseUrl: 'https://bscscan.com',
      txPath: '/tx/',
      addressPath: '/address/',
      tokenPath: '/token/'
    },
    finality: {
      reorgSafetyBlocks: 15,
      instantFinality: true,
      typicalBlockTimeSec: 3,
      safeFinalityTimeSec: 45
    },
    capabilities: {
      wallet: true,
      tokenDiscovery: true,
      tokenRisk: true,
      priceData: true,
      liquidityDiscovery: true,
      swap: true,
      smartRouting: true,
      simulation: true,
      portfolio: true,
      history: true,
      mevProtection: false,
      crossChain: true,
      zenithLiquidity: true,
      api: true,
      sdk: true,
      supportsEIP1559: true,
      supportsPermit2: true,
      supportsFlashbots: false,
      supportsSimulation: true,
      supportsBatchTransactions: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'DEEP',
    productionStatus: 'ACTIVE',
    color: '#F3BA2F',
    iconURI: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'bnb',
        name: 'BNB',
        symbol: 'BNB',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png'
      },
      {
        address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        chainId: 'bnb',
        name: 'Wrapped BNB',
        symbol: 'WBNB',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png'
      },
      {
        address: '0x55d398326f99059fF775485246999027B3197955',
        chainId: 'bnb',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        chainId: 'bnb',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
        chainId: 'bnb',
        name: 'Binance-Peg BTC',
        symbol: 'BTCB',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/14108/small/Binance-bitcoin.png'
      },
      {
        address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
        chainId: 'bnb',
        name: 'PancakeSwap',
        symbol: 'CAKE',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82/logo.png'
      },
      {
        address: '0xfb5B838b6cfEEdC2873aB27866079AC55363D37E',
        chainId: 'bnb',
        name: 'Floki',
        symbol: 'FLOKI',
        decimals: 9,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://assets.coingecko.com/coins/images/16746/small/FLOKI.png'
      }
    ]
  },

  avalanche: {
    id: 'avalanche',
    chainId: 43114,
    canonicalName: 'Avalanche',
    shortName: 'Avalanche',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ARC-20', 'ARC-721', 'ARC-1155', 'Permit2'],
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png' },
    rpcEndpoints: [
      { url: 'https://api.avax.network/ext/bc/C/rpc', priority: 1, status: 'HEALTHY' },
      { url: 'https://rpc.ankr.com/avalanche', priority: 2, status: 'HEALTHY' }
    ],
    explorer: {
      name: 'Snowtrace',
      baseUrl: 'https://snowtrace.io',
      txPath: '/tx/',
      addressPath: '/address/',
      tokenPath: '/token/'
    },
    finality: {
      reorgSafetyBlocks: 1,
      instantFinality: true,
      typicalBlockTimeSec: 1,
      safeFinalityTimeSec: 2
    },
    capabilities: {
      wallet: true,
      tokenDiscovery: true,
      tokenRisk: true,
      priceData: true,
      liquidityDiscovery: true,
      swap: true,
      smartRouting: true,
      simulation: true,
      portfolio: true,
      history: true,
      mevProtection: false,
      crossChain: true,
      zenithLiquidity: true,
      api: true,
      sdk: true,
      supportsEIP1559: true,
      supportsPermit2: true,
      supportsFlashbots: false,
      supportsSimulation: true,
      supportsBatchTransactions: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'DEEP',
    productionStatus: 'ACTIVE',
    color: '#E84142',
    iconURI: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'avalanche',
        name: 'Avalanche',
        symbol: 'AVAX',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png'
      },
      {
        address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
        chainId: 'avalanche',
        name: 'Wrapped AVAX',
        symbol: 'WAVAX',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png'
      },
      {
        address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        chainId: 'avalanche',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
        chainId: 'avalanche',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x152b9d0FdC40C096757F570A51E494ba4b945398',
        chainId: 'avalanche',
        name: 'Avalanche Bridged BTC',
        symbol: 'BTC.b',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/26115/small/btcb.png'
      },
      {
        address: '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd',
        chainId: 'avalanche',
        name: 'Trader Joe',
        symbol: 'JOE',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/17569/small/joe_200x200.png'
      }
    ]
  },

  solana: {
    id: 'solana',
    chainId: 101,
    canonicalName: 'Solana',
    shortName: 'Solana',
    executionEnvironment: 'SOLANA',
    category: 'LAYER_1',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['SOL', 'SPL Token', 'Token-2022'],
    nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9, logoURI: 'https://assets.coingecko.com/coins/images/4128/small/solana.png' },
    rpcEndpoints: [
      { url: 'https://api.mainnet-beta.solana.com', priority: 1, status: 'HEALTHY' },
      { url: 'https://solana-mainnet.g.alchemy.com/v2/demo', priority: 2, status: 'HEALTHY' }
    ],
    explorer: {
      name: 'Solscan',
      baseUrl: 'https://solscan.io',
      txPath: '/tx/',
      addressPath: '/account/',
      tokenPath: '/token/'
    },
    finality: {
      reorgSafetyBlocks: 32,
      instantFinality: false,
      typicalBlockTimeSec: 0.4,
      safeFinalityTimeSec: 12.8
    },
    capabilities: {
      wallet: true,
      tokenDiscovery: true,
      tokenRisk: true,
      priceData: true,
      liquidityDiscovery: true,
      swap: true,
      smartRouting: true,
      simulation: true,
      portfolio: true,
      history: true,
      mevProtection: false,
      crossChain: true,
      zenithLiquidity: true,
      api: true,
      sdk: true,
      supportsEIP1559: false,
      supportsPermit2: false,
      supportsFlashbots: false,
      supportsSimulation: true,
      supportsBatchTransactions: true,
      hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'DEEP',
    productionStatus: 'ACTIVE',
    color: '#14F195',
    iconURI: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
    defaultTokens: [
      {
        address: '11111111111111111111111111111111',
        chainId: 'solana',
        name: 'Solana',
        symbol: 'SOL',
        decimals: 9,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/4128/small/solana.png'
      },
      {
        address: 'So11111111111111111111111111111111111111112',
        chainId: 'solana',
        name: 'Wrapped SOL',
        symbol: 'WSOL',
        decimals: 9,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/4128/small/solana.png'
      },
      {
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        chainId: 'solana',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        chainId: 'solana',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
        chainId: 'solana',
        name: 'Jupiter',
        symbol: 'JUP',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/34188/small/jup.png'
      },
      {
        address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
        chainId: 'solana',
        name: 'Raydium',
        symbol: 'RAY',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/13928/small/PSigc4ie_400x400.jpg'
      },
      {
        address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
        chainId: 'solana',
        name: 'Pyth Network',
        symbol: 'PYTH',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3/logo.png'
      },
      {
        address: 'J1toso1uCk3RKmjehLLmJaNMuUmZE5CQNJbZPumuzSf',
        chainId: 'solana',
        name: 'Jito Staked SOL',
        symbol: 'JitoSOL',
        decimals: 9,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/28048/small/jitosol.png'
      },
      {
        address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        chainId: 'solana',
        name: 'Bonk',
        symbol: 'BONK',
        decimals: 5,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://assets.coingecko.com/coins/images/28600/small/bonk.jpg'
      },
      {
        address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        chainId: 'solana',
        name: 'Dogwifhat',
        symbol: 'WIF',
        decimals: 6,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpg'
      },
      {
        address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
        chainId: 'solana',
        name: 'Popcat',
        symbol: 'POPCAT',
        decimals: 9,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr/logo.png'
      }
    ]
  },

  unichain: {
    id: 'unichain',
    chainId: 130,
    canonicalName: 'Unichain',
    shortName: 'Unichain',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://mainnet.unichain.org', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Uniscan', baseUrl: 'https://uniscan.xyz', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 1, safeFinalityTimeSec: 30 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: true, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#FF007A',
    iconURI: 'https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'unichain',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x0000000000000000000000000000000000000001',
        chainId: 'unichain',
        name: 'Uniswap',
        symbol: 'UNI',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png'
      },
      {
        address: '0x0000000000000000000000000000000000000002',
        chainId: 'unichain',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x0000000000000000000000000000000000000003',
        chainId: 'unichain',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x0000000000000000000000000000000000000004',
        chainId: 'unichain',
        name: 'Wrapped BTC',
        symbol: 'WBTC',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png'
      }
    ]
  },

  linea: {
    id: 'linea',
    chainId: 59144,
    canonicalName: 'Linea',
    shortName: 'Linea',
    executionEnvironment: 'EVM',
    category: 'ZK_ROLLUP',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'ERC-721', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://rpc.linea.build', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'LineaScan', baseUrl: 'https://lineascan.build', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#121212',
    iconURI: '/networks/linea.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'linea',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
        chainId: 'linea',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/2518/small/weth.png'
      },
      {
        address: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
        chainId: 'linea',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0xA219439258ca9da29E9Cc4cE5596924745e12B93',
        chainId: 'linea',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x5FBDF89403270a1846F5ae7D113A989F850d1566',
        chainId: 'linea',
        name: 'Foxy',
        symbol: 'FOXY',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/linea/assets/0x5FBDF89403270a1846F5ae7D113A989F850d1566/logo.png'
      }
    ]
  },

  zksync: {
    id: 'zksync',
    chainId: 324,
    canonicalName: 'zkSync',
    shortName: 'zkSync',
    executionEnvironment: 'EVM',
    category: 'ZK_ROLLUP',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Account Abstraction', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://mainnet.era.zksync.io', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'zkSync Explorer', baseUrl: 'https://explorer.zksync.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 1, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#8C8DFC',
    iconURI: '/networks/zksync.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'zksync',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x5A7d6b2F92C77FAD6CCaBd10A50d6141a0eef307',
        chainId: 'zksync',
        name: 'ZKsync',
        symbol: 'ZK',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/zksync/info/logo.png'
      },
      {
        address: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4',
        chainId: 'zksync',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x493257fD37EDB34451f62EDf8D2a0C418852bA4C',
        chainId: 'zksync',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0xed4040fD47629e7c8FBA7DA76bb50D3e7695F0f2',
        chainId: 'zksync',
        name: 'Holdstation',
        symbol: 'HOLD',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: '/tokens/hold.png'
      }
    ]
  },

  scroll: {
    id: 'scroll',
    chainId: 534352,
    canonicalName: 'Scroll',
    shortName: 'Scroll',
    executionEnvironment: 'EVM',
    category: 'ZK_ROLLUP',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'ERC-721', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://rpc.scroll.io', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'ScrollScan', baseUrl: 'https://scrollscan.com', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 3, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#FFE7B9',
    iconURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/scroll/info/logo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'scroll',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4',
        chainId: 'scroll',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0xd29687c813D741E2F938F4aC3771298148A15B70',
        chainId: 'scroll',
        name: 'Scroll',
        symbol: 'SCR',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/scroll/info/logo.png'
      }
    ]
  },

  blast: {
    id: 'blast',
    chainId: 81457,
    canonicalName: 'Blast',
    shortName: 'Blast',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Native Yield', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://rpc.blast.io', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'BlastScan', baseUrl: 'https://blastscan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#FCFC03',
    iconURI: '/networks/blast.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'blast',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x4300000000000000000000000000000000000004',
        chainId: 'blast',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/2518/small/weth.png'
      },
      {
        address: '0x4300000000000000000000000000000000000003',
        chainId: 'blast',
        name: 'USDB (Native Yield Stablecoin)',
        symbol: 'USDB',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/blast/assets/0x4300000000000000000000000000000000000003/logo.png'
      },
      {
        address: '0xb1a5700fA2358173Fe465e6eA4Ff52E36e88E2ad',
        chainId: 'blast',
        name: 'Blast',
        symbol: 'BLAST',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: '/tokens/blast.png'
      },
      {
        address: '0x00000000000000000000000000000000000000A1',
        chainId: 'blast',
        name: 'Pacman Finance',
        symbol: 'PAC',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED'
      }
    ]
  },

  zora: {
    id: 'zora',
    chainId: 7777777,
    canonicalName: 'Zora',
    shortName: 'Zora',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'ERC-721', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://rpc.zora.energy', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Zora Explorer', baseUrl: 'https://explorer.zora.energy', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#000000',
    iconURI: '/networks/zora.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'zora',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0xa6B280B42CB0b7c4a4F789eC2eCdF7e2cd0da650',
        chainId: 'zora',
        name: 'Enjoy',
        symbol: 'ENJOY',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: '/tokens/enjoy.png'
      },
      {
        address: '0x0000000000000000000000000000000000000091',
        chainId: 'zora',
        name: 'Imagine',
        symbol: 'IMAGINE',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: '/tokens/imagine.png'
      },
      {
        address: '0x0000000000000000000000000000000000000093',
        chainId: 'zora',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      }
    ]
  },

  worldchain: {
    id: 'worldchain',
    chainId: 480,
    canonicalName: 'World Chain',
    shortName: 'World Chain',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'WorldID Priority', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://worldchain-mainnet.g.alchemy.com/public', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'WorldScan', baseUrl: 'https://worldscan.org', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#1E1E1E',
    iconURI: '/networks/worldcoin.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'worldchain',
        name: 'Worldcoin',
        symbol: 'WLD',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/31069/small/worldcoin.png'
      },
      {
        address: '0x0000000000000000000000000000000000000050',
        chainId: 'worldchain',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x0000000000000000000000000000000000000051',
        chainId: 'worldchain',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x0000000000000000000000000000000000000052',
        chainId: 'worldchain',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      }
    ]
  },

  mantle: {
    id: 'mantle',
    chainId: 5000,
    canonicalName: 'Mantle',
    shortName: 'Mantle',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'ERC-721', 'Permit2'],
    nativeCurrency: { name: 'Mantle', symbol: 'MNT', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/30980/small/Mantle.png' },
    rpcEndpoints: [{ url: 'https://rpc.mantle.xyz', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Mantle Explorer', baseUrl: 'https://explorer.mantle.xyz', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 1, safeFinalityTimeSec: 30 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#000000',
    iconURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/mantle/info/logo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'mantle',
        name: 'Mantle',
        symbol: 'MNT',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: '/tokens/mnt.png'
      },
      {
        address: '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9',
        chainId: 'mantle',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      }
    ]
  },

  celo: {
    id: 'celo',
    chainId: 42220,
    canonicalName: 'Celo',
    shortName: 'Celo',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Fee Currencies', 'Permit2'],
    nativeCurrency: { name: 'Celo', symbol: 'CELO', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/11090/small/celo.png' },
    rpcEndpoints: [{ url: 'https://forno.celo.org', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'CeloScan', baseUrl: 'https://celoscan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 5, safeFinalityTimeSec: 5 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: false, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#35D07F',
    iconURI: '/networks/celo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'celo',
        name: 'Celo',
        symbol: 'CELO',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/11090/small/InjXBNx9_400x400.jpg'
      },
      {
        address: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
        chainId: 'celo',
        name: 'Celo Dollar',
        symbol: 'cUSD',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/11090/small/InjXBNx9_400x400.jpg'
      },
      {
        address: '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73',
        chainId: 'celo',
        name: 'Celo Euro',
        symbol: 'cEUR',
        decimals: 18,
        logoURI: '/tokens/ceur.png',
        verificationTier: 'VERIFIED_CANONICAL'
      },
      {
        address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
        chainId: 'celo',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/15168/small/celo-euro.png'
      },
      {
        address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
        chainId: 'celo',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      }
    ]
  },

  gnosis: {
    id: 'gnosis',
    chainId: 100,
    canonicalName: 'Gnosis',
    shortName: 'Gnosis',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'ERC-721', 'Permit2'],
    nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/11062/small/xdai.png' },
    rpcEndpoints: [{ url: 'https://rpc.gnosischain.com', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Gnosisscan', baseUrl: 'https://gnosisscan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 5, safeFinalityTimeSec: 30 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#133629',
    iconURI: '/networks/gnosis.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'gnosis',
        name: 'xDAI',
        symbol: 'xDAI',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: '/tokens/xdai.png'
      },
      {
        address: '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb',
        chainId: 'gnosis',
        name: 'Gnosis',
        symbol: 'GNO',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: '/tokens/gno.png'
      }
    ]
  },

  sonic: {
    id: 'sonic',
    chainId: 146,
    canonicalName: 'Sonic',
    shortName: 'Sonic',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Permit2'],
    nativeCurrency: { name: 'Sonic', symbol: 'S', decimals: 18, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/sonic/info/logo.png' },
    rpcEndpoints: [{ url: 'https://rpc.soniclabs.com', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'SonicScan', baseUrl: 'https://sonicscan.org', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.5, safeFinalityTimeSec: 1 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#0055FF',
    iconURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/sonic/info/logo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'sonic',
        name: 'Sonic',
        symbol: 'S',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/sonic/info/logo.png'
      },
      {
        address: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894',
        chainId: 'sonic',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      }
    ]
  },

  soneium: {
    id: 'soneium',
    chainId: 1868,
    canonicalName: 'Soneium',
    shortName: 'Soneium',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://rpc.soneium.org', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Soneium Explorer', baseUrl: 'https://explorer.soneium.org', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#002B49',
    iconURI: '/networks/soneium.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'soneium',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x0000000000000000000000000000000000000080',
        chainId: 'soneium',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x0000000000000000000000000000000000000081',
        chainId: 'soneium',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x0000000000000000000000000000000000000082',
        chainId: 'soneium',
        name: 'Sony Ecosystem Token',
        symbol: 'SONY',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: '/tokens/sony.png'
      },
      {
        address: '0x0000000000000000000000000000000000000083',
        chainId: 'soneium',
        name: 'Astar Network',
        symbol: 'ASTR',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/22617/small/astr.png'
      }
    ]
  },

  berachain: {
    id: 'berachain',
    chainId: 80094,
    canonicalName: 'Berachain',
    shortName: 'Berachain',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Proof of Liquidity', 'Permit2'],
    nativeCurrency: { name: 'Bera', symbol: 'BERA', decimals: 18, logoURI: '/tokens/bera.png' },
    rpcEndpoints: [{ url: 'https://rpc.berachain.com', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Berascan', baseUrl: 'https://berascan.com', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 30 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#8B4513',
    iconURI: '/networks/berachain.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'berachain',
        name: 'Bera',
        symbol: 'BERA',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: '/tokens/bera.png'
      },
      {
        address: '0x0E4aaF1351de4c0264C5c7056Ef3777b41BD8e03',
        chainId: 'berachain',
        name: 'Honey Stablecoin',
        symbol: 'HONEY',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/34390/small/honey.png'
      }
    ]
  },

  cronos: {
    id: 'cronos',
    chainId: 25,
    canonicalName: 'Cronos',
    shortName: 'Cronos',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['CRC-20', 'ERC-20', 'Permit2'],
    nativeCurrency: { name: 'Cronos', symbol: 'CRO', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/7310/small/cro_token_logo.png' },
    rpcEndpoints: [{ url: 'https://evm.cronos.org', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Cronoscan', baseUrl: 'https://cronoscan.com', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 5, safeFinalityTimeSec: 30 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#002D74',
    iconURI: 'https://assets.coingecko.com/coins/images/7310/small/cro_token_logo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'cronos',
        name: 'Cronos',
        symbol: 'CRO',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/7310/small/cro_token_logo.png'
      }
    ]
  },

  xlayer: {
    id: 'xlayer',
    chainId: 196,
    canonicalName: 'X Layer',
    shortName: 'X Layer',
    executionEnvironment: 'EVM',
    category: 'ZK_ROLLUP',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'OKB Native Gas', 'Permit2'],
    nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/4463/small/okb_token.png' },
    rpcEndpoints: [{ url: 'https://rpc.xlayer.tech', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'OKLink X Layer', baseUrl: 'https://www.oklink.com/xlayer', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 1, safeFinalityTimeSec: 30 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#000000',
    iconURI: 'https://assets.coingecko.com/coins/images/4463/small/okb_token.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'xlayer',
        name: 'OKB',
        symbol: 'OKB',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/4463/small/okb_token.png'
      },
      {
        address: '0x0000000000000000000000000000000000000030',
        chainId: 'xlayer',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x0000000000000000000000000000000000000032',
        chainId: 'xlayer',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x0000000000000000000000000000000000000033',
        chainId: 'xlayer',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/2518/small/weth.png'
      }
    ]
  },

  sei: {
    id: 'sei',
    chainId: 1329,
    canonicalName: 'Sei',
    shortName: 'Sei',
    executionEnvironment: 'EVM',
    category: 'HIGH_THROUGHPUT_L1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Parallel EVM', 'Permit2'],
    nativeCurrency: { name: 'Sei', symbol: 'SEI', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/28205/small/Sei_Logo_-_Transparent.png' },
    rpcEndpoints: [{ url: 'https://evm-rpc.sei-apis.com', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'SeiTrace', baseUrl: 'https://seitrace.com', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.4, safeFinalityTimeSec: 0.8 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#9B1C2E',
    iconURI: 'https://assets.coingecko.com/coins/images/28205/small/Sei_Logo_-_Transparent.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'sei',
        name: 'Sei',
        symbol: 'SEI',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/28205/small/Sei_Logo_-_Transparent.png'
      }
    ]
  },

  sui: {
    id: 'sui',
    chainId: 0,
    canonicalName: 'Sui',
    shortName: 'Sui',
    executionEnvironment: 'MOVE',
    category: 'LAYER_1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['Move Coin', 'Move Object'],
    nativeCurrency: { name: 'Sui', symbol: 'SUI', decimals: 9, logoURI: 'https://assets.coingecko.com/coins/images/26375/small/sui-ocean-square.png' },
    rpcEndpoints: [{ url: 'https://fullnode.mainnet.sui.io', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'SuiScan', baseUrl: 'https://suiscan.xyz', txPath: '/tx/', addressPath: '/account/', tokenPath: '/coin/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.4, safeFinalityTimeSec: 0.8 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#4DA2FF',
    iconURI: 'https://assets.coingecko.com/coins/images/26375/small/sui-ocean-square.png',
    defaultTokens: [
      {
        address: '0x0000000000000000000000000000000000000002',
        chainId: 'sui',
        name: 'Sui',
        symbol: 'SUI',
        decimals: 9,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/26375/small/sui-ocean-square.png'
      },
      {
        address: '0x5d4b302506645c37ff133b98c4b50a5aeC4f9e63',
        chainId: 'sui',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      }
    ]
  },

  aptos: {
    id: 'aptos',
    chainId: 1,
    canonicalName: 'Aptos',
    shortName: 'Aptos',
    executionEnvironment: 'MOVE',
    category: 'LAYER_1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['Aptos Coin', 'Fungible Asset'],
    nativeCurrency: { name: 'Aptos', symbol: 'APT', decimals: 8, logoURI: 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png' },
    rpcEndpoints: [{ url: 'https://fullnode.mainnet.aptoslabs.com/v1', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Aptos Explorer', baseUrl: 'https://explorer.aptoslabs.com', txPath: '/txn/', addressPath: '/account/', tokenPath: '/coin/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.5, safeFinalityTimeSec: 1 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#222222',
    iconURI: 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png',
    defaultTokens: [
      {
        address: '0x1::aptos_coin::AptosCoin',
        chainId: 'aptos',
        name: 'Aptos',
        symbol: 'APT',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png'
      }
    ]
  },

  near: {
    id: 'near',
    chainId: 397,
    canonicalName: 'NEAR',
    shortName: 'NEAR',
    executionEnvironment: 'NEAR',
    category: 'LAYER_1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['NEP-141', 'NEP-171'],
    nativeCurrency: { name: 'NEAR Protocol', symbol: 'NEAR', decimals: 24, logoURI: 'https://assets.coingecko.com/coins/images/10365/small/near.png' },
    rpcEndpoints: [{ url: 'https://rpc.mainnet.near.org', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'NearBlocks', baseUrl: 'https://nearblocks.io', txPath: '/txns/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 2, instantFinality: true, typicalBlockTimeSec: 1.2, safeFinalityTimeSec: 2.4 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#000000',
    iconURI: 'https://assets.coingecko.com/coins/images/10365/small/near.png',
    defaultTokens: [
      {
        address: 'wrap.near',
        chainId: 'near',
        name: 'NEAR Protocol',
        symbol: 'NEAR',
        decimals: 24,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/10365/small/near.png'
      }
    ]
  },

  cosmoshub: {
    id: 'cosmoshub',
    chainId: 0,
    canonicalName: 'Cosmos Hub',
    shortName: 'Cosmos',
    executionEnvironment: 'COSMOS',
    category: 'LAYER_1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['Native', 'IBC', 'CW20'],
    nativeCurrency: { name: 'Cosmos', symbol: 'ATOM', decimals: 6, logoURI: 'https://assets.coingecko.com/coins/images/1481/small/cosmos_hub.png' },
    rpcEndpoints: [{ url: 'https://cosmos-rpc.publicnode.com', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Mintscan', baseUrl: 'https://www.mintscan.io/cosmos', txPath: '/tx/', addressPath: '/account/', tokenPath: '/assets/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 6, safeFinalityTimeSec: 6 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#2E3148',
    iconURI: 'https://assets.coingecko.com/coins/images/1481/small/cosmos_hub.png',
    defaultTokens: [
      {
        address: 'uatom',
        chainId: 'cosmoshub',
        name: 'Cosmos Hub',
        symbol: 'ATOM',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/1481/small/cosmos_hub.png'
      }
    ]
  },

  osmosis: {
    id: 'osmosis',
    chainId: 0,
    canonicalName: 'Osmosis',
    shortName: 'Osmosis',
    executionEnvironment: 'COSMOS',
    category: 'LAYER_1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['IBC', 'Superfluid Staking', 'CW20'],
    nativeCurrency: { name: 'Osmosis', symbol: 'OSMO', decimals: 6, logoURI: 'https://assets.coingecko.com/coins/images/16724/small/osmo.png' },
    rpcEndpoints: [{ url: 'https://osmosis-rpc.publicnode.com', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Mintscan', baseUrl: 'https://www.mintscan.io/osmosis', txPath: '/tx/', addressPath: '/account/', tokenPath: '/assets/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 6, safeFinalityTimeSec: 6 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#8A2BE2',
    iconURI: 'https://assets.coingecko.com/coins/images/16724/small/osmo.png',
    defaultTokens: [
      {
        address: 'uosmo',
        chainId: 'osmosis',
        name: 'Osmosis',
        symbol: 'OSMO',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/16724/small/osmo.png'
      }
    ]
  },

  injective: {
    id: 'injective',
    chainId: 0,
    canonicalName: 'Injective',
    shortName: 'Injective',
    executionEnvironment: 'COSMOS',
    category: 'HIGH_THROUGHPUT_L1',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['Native', 'IBC', 'Injective Orderbook'],
    nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png' },
    rpcEndpoints: [{ url: 'https://sentry.lcd.injective.network', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Injective Explorer', baseUrl: 'https://explorer.injective.network', txPath: '/transaction/', addressPath: '/account/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.8, safeFinalityTimeSec: 1.6 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: true, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#00F2FE',
    iconURI: '/networks/injective.png',
    defaultTokens: [
      {
        address: 'inj',
        chainId: 'injective',
        name: 'Injective',
        symbol: 'INJ',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png'
      }
    ]
  },

  arbitrumnova: {
    id: 'arbitrumnova',
    chainId: 42170,
    canonicalName: 'Arbitrum Nova',
    shortName: 'Nova',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'AnyTrust'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://nova.arbitrum.io/rpc', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'NovaScan', baseUrl: 'https://nova.arbiscan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 0.25, safeFinalityTimeSec: 30 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      supportsEIP1559: true, hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EMERGING',
    productionStatus: 'ACTIVE',
    color: '#E06214',
    iconURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'arbitrumnova',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      }
    ]
  },

  polygonzkevm: {
    id: 'polygonzkevm',
    chainId: 1101,
    canonicalName: 'Polygon zkEVM',
    shortName: 'Polygon zkEVM',
    executionEnvironment: 'EVM',
    category: 'ZK_ROLLUP',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://zkevm-rpc.com', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Polygon zkEVM Scan', baseUrl: 'https://zkevm.polygonscan.com', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      supportsEIP1559: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EMERGING',
    productionStatus: 'ACTIVE',
    color: '#7B3FE4',
    iconURI: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'polygonzkevm',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      }
    ]
  },

  mode: {
    id: 'mode',
    chainId: 34443,
    canonicalName: 'Mode',
    shortName: 'Mode',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://mainnet.mode.network', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'ModeScan', baseUrl: 'https://modescan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      supportsEIP1559: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EMERGING',
    productionStatus: 'ACTIVE',
    color: '#DFFE00',
    iconURI: '/networks/mode.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'mode',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      }
    ]
  },

  taiko: {
    id: 'taiko',
    chainId: 167000,
    canonicalName: 'Taiko',
    shortName: 'Taiko',
    executionEnvironment: 'EVM',
    category: 'ZK_ROLLUP',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Based Contestable'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://rpc.mainnet.taiko.xyz', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'TaikoScan', baseUrl: 'https://taikoscan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 3, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      supportsEIP1559: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EMERGING',
    productionStatus: 'ACTIVE',
    color: '#E81899',
    iconURI: '/networks/taiko.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'taiko',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      }
    ]
  },

  metis: {
    id: 'metis',
    chainId: 1088,
    canonicalName: 'Metis',
    shortName: 'Metis',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20'],
    nativeCurrency: { name: 'Metis', symbol: 'METIS', decimals: 18, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/metis/info/logo.png' },
    rpcEndpoints: [{ url: 'https://andromeda.metis.io/?owner=1088', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Metis Explorer', baseUrl: 'https://andromeda-explorer.metis.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      supportsEIP1559: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EMERGING',
    productionStatus: 'ACTIVE',
    color: '#00DACC',
    iconURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/metis/info/logo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'metis',
        name: 'Metis',
        symbol: 'METIS',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/metis/info/logo.png'
      }
    ]
  },

  moonbeam: {
    id: 'moonbeam',
    chainId: 1284,
    canonicalName: 'Moonbeam',
    shortName: 'Moonbeam',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'XC-20'],
    nativeCurrency: { name: 'Glimmer', symbol: 'GLMR', decimals: 18, logoURI: '/tokens/glmr.png' },
    rpcEndpoints: [{ url: 'https://rpc.api.moonbeam.network', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Moonscan', baseUrl: 'https://moonscan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 6, safeFinalityTimeSec: 30 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      supportsEIP1559: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EMERGING',
    productionStatus: 'ACTIVE',
    color: '#53CBC9',
    iconURI: 'https://assets.coingecko.com/coins/images/22459/small/glmr.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'moonbeam',
        name: 'Glimmer',
        symbol: 'GLMR',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: '/tokens/glmr.png'
      }
    ]
  },

  moonriver: {
    id: 'moonriver',
    chainId: 1285,
    canonicalName: 'Moonriver',
    shortName: 'Moonriver',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'XC-20'],
    nativeCurrency: { name: 'Moonriver', symbol: 'MOVR', decimals: 18, logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/moonriver/info/logo.png' },
    rpcEndpoints: [{ url: 'https://rpc.api.moonriver.moonbeam.network', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Moonriver Scan', baseUrl: 'https://moonriver.moonscan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 6, safeFinalityTimeSec: 30 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      supportsEIP1559: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EMERGING',
    productionStatus: 'ACTIVE',
    color: '#F4B400',
    iconURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/moonriver/info/logo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'moonriver',
        name: 'Moonriver',
        symbol: 'MOVR',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/moonriver/info/logo.png'
      }
    ]
  },

  rootstock: {
    id: 'rootstock',
    chainId: 30,
    canonicalName: 'Rootstock',
    shortName: 'Rootstock',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Merged Mining BTC'],
    nativeCurrency: { name: 'Smart Bitcoin', symbol: 'RBTC', decimals: 18, logoURI: '/tokens/rbtc.png' },
    rpcEndpoints: [{ url: 'https://public-node.rsk.co', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Rootstock Explorer', baseUrl: 'https://explorer.rootstock.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 30, safeFinalityTimeSec: 180 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      supportsEIP1559: false, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EMERGING',
    productionStatus: 'ACTIVE',
    color: '#00B48A',
    iconURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/rootstock/info/logo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'rootstock',
        name: 'Smart Bitcoin',
        symbol: 'RBTC',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: '/tokens/rbtc.png'
      }
    ]
  },

  tron: {
    id: 'tron',
    chainId: 728126428,
    canonicalName: 'Tron',
    shortName: 'Tron',
    executionEnvironment: 'TVM',
    category: 'LAYER_1',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['TRC-10', 'TRC-20'],
    nativeCurrency: { name: 'Tron', symbol: 'TRX', decimals: 6, logoURI: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png' },
    rpcEndpoints: [{ url: 'https://api.trongrid.io', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'TRONSCAN', baseUrl: 'https://tronscan.org', txPath: '/#/transaction/', addressPath: '/#/address/', tokenPath: '/#/token20/' },
    finality: { reorgSafetyBlocks: 19, instantFinality: false, typicalBlockTimeSec: 3, safeFinalityTimeSec: 60 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#FF0013',
    iconURI: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'tron',
        name: 'Tron',
        symbol: 'TRX',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png'
      },
      {
        address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        chainId: 'tron',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: 'TPYmHEhy5nFA6nhXuDRRZm8HwY5N1FxgeK',
        chainId: 'tron',
        name: 'Decentralized USD',
        symbol: 'USDD',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/25380/small/UUSD.jpg'
      },
      {
        address: 'TAFjULxiVgT4qWk6UZAMCnhPXGazYke3PF',
        chainId: 'tron',
        name: 'BitTorrent',
        symbol: 'BTT',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://coin-images.coingecko.com/coins/images/22457/large/btt_logo.png'
      },
      {
        address: 'TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S',
        chainId: 'tron',
        name: 'Sun Token',
        symbol: 'SUN',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://coin-images.coingecko.com/coins/images/12424/large/RSFOmQ.png'
      },
      {
        address: 'TCFLLCrdoUzAcTXkp1D4pcmC6LmmCxpmG4',
        chainId: 'tron',
        name: 'JUST',
        symbol: 'JST',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/11095/small/JUST.jpg'
      }
    ]
  },

  ton: {
    id: 'ton',
    chainId: 0,
    canonicalName: 'TON',
    shortName: 'TON',
    executionEnvironment: 'TON',
    category: 'LAYER_1',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['TON', 'Jetton'],
    nativeCurrency: { name: 'Toncoin', symbol: 'TON', decimals: 9, logoURI: 'https://assets.coingecko.com/coins/images/17980/small/ton_symbol.png' },
    rpcEndpoints: [{ url: 'https://toncenter.com/api/v2/jsonRPC', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Tonscan', baseUrl: 'https://tonscan.org', txPath: '/tx/', addressPath: '/address/', tokenPath: '/jetton/' },
    finality: { reorgSafetyBlocks: 5, instantFinality: false, typicalBlockTimeSec: 5, safeFinalityTimeSec: 25 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: false, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#0088CC',
    iconURI: 'https://assets.coingecko.com/coins/images/17980/small/ton_symbol.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'ton',
        name: 'Toncoin',
        symbol: 'TON',
        decimals: 9,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/17980/small/ton_symbol.png'
      },
      {
        address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
        chainId: 'ton',
        name: 'Tether USD (TON)',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      }
    ]
  },

  hedera: {
    id: 'hedera',
    chainId: 295,
    canonicalName: 'Hedera',
    shortName: 'Hedera',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['HTS', 'ERC-20'],
    nativeCurrency: { name: 'Hedera', symbol: 'HBAR', decimals: 8, logoURI: 'https://assets.coingecko.com/coins/images/3688/small/hbar.png' },
    rpcEndpoints: [{ url: 'https://mainnet.hashio.io/api', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'HashScan', baseUrl: 'https://hashscan.io', txPath: '/mainnet/transaction/', addressPath: '/mainnet/account/', tokenPath: '/mainnet/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 3, safeFinalityTimeSec: 5 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: false, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EMERGING',
    productionStatus: 'ACTIVE',
    color: '#222222',
    iconURI: 'https://assets.coingecko.com/coins/images/3688/small/hbar.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'hedera',
        name: 'Hedera',
        symbol: 'HBAR',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/3688/small/hbar.png'
      }
    ]
  },

  algorand: {
    id: 'algorand',
    chainId: 0,
    canonicalName: 'Algorand',
    shortName: 'Algorand',
    executionEnvironment: 'UTXO',
    category: 'LAYER_1',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ASA (Algorand Standard Asset)'],
    nativeCurrency: { name: 'Algorand', symbol: 'ALGO', decimals: 6, logoURI: 'https://assets.coingecko.com/coins/images/4380/small/download.png' },
    rpcEndpoints: [{ url: 'https://mainnet-api.algonode.cloud', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'AlgoScan', baseUrl: 'https://algoscan.app', txPath: '/tx/', addressPath: '/address/', tokenPath: '/asset/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 3.3, safeFinalityTimeSec: 3.3 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: false, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EMERGING',
    productionStatus: 'ACTIVE',
    color: '#000000',
    iconURI: 'https://assets.coingecko.com/coins/images/4380/small/download.png',
    defaultTokens: [
      {
        address: '0',
        chainId: 'algorand',
        name: 'Algorand',
        symbol: 'ALGO',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/4380/small/download.png'
      }
    ]
  },

  stellar: {
    id: 'stellar',
    chainId: 0,
    canonicalName: 'Stellar',
    shortName: 'Stellar',
    executionEnvironment: 'STELLAR',
    category: 'PAYMENTS_NETWORK',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['XLM', 'SEP-41', 'Soroban Smart Contracts'],
    nativeCurrency: { name: 'Stellar Lumens', symbol: 'XLM', decimals: 7, logoURI: 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png' },
    rpcEndpoints: [{ url: 'https://horizon.stellar.org', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'StellarExpert', baseUrl: 'https://stellar.expert/explorer/public', txPath: '/tx/', addressPath: '/account/', tokenPath: '/asset/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 5, safeFinalityTimeSec: 5 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: false, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#000000',
    iconURI: 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png',
    defaultTokens: [
      {
        address: 'native',
        chainId: 'stellar',
        name: 'Stellar Lumens',
        symbol: 'XLM',
        decimals: 7,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png'
      }
    ]
  },

  xrpl: {
    id: 'xrpl',
    chainId: 0,
    canonicalName: 'XRP Ledger',
    shortName: 'XRPL',
    executionEnvironment: 'XRPL',
    category: 'PAYMENTS_NETWORK',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['XRP', 'Trustline Assets', 'AMM'],
    nativeCurrency: { name: 'XRP', symbol: 'XRP', decimals: 6, logoURI: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png' },
    rpcEndpoints: [{ url: 'https://xrplcluster.com', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'XRPScan', baseUrl: 'https://xrpscan.com', txPath: '/tx/', addressPath: '/account/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 3.5, safeFinalityTimeSec: 3.5 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: false, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#23292F',
    iconURI: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
    defaultTokens: [
      {
        address: 'XRP',
        chainId: 'xrpl',
        name: 'XRP',
        symbol: 'XRP',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png'
      }
    ]
  },

  cardano: {
    id: 'cardano',
    chainId: 0,
    canonicalName: 'Cardano',
    shortName: 'Cardano',
    executionEnvironment: 'UTXO',
    category: 'LAYER_1',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ADA', 'Native Assets', 'Plutus'],
    nativeCurrency: { name: 'Cardano', symbol: 'ADA', decimals: 6, logoURI: 'https://assets.coingecko.com/coins/images/975/small/cardano.png' },
    rpcEndpoints: [{ url: 'https://cardano-mainnet.blockfrost.io/api/v0', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Cardanoscan', baseUrl: 'https://cardanoscan.io', txPath: '/transaction/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 20, safeFinalityTimeSec: 120 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: false, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#0033AD',
    iconURI: 'https://assets.coingecko.com/coins/images/975/small/cardano.png',
    defaultTokens: [
      {
        address: 'lovelace',
        chainId: 'cardano',
        name: 'Cardano',
        symbol: 'ADA',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/975/small/cardano.png'
      }
    ]
  },

  polkadot: {
    id: 'polkadot',
    chainId: 0,
    canonicalName: 'Polkadot',
    shortName: 'Polkadot',
    executionEnvironment: 'SUBSTRATE',
    category: 'LAYER_1',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['DOT', 'Asset Hub Assets', 'XCM'],
    nativeCurrency: { name: 'Polkadot', symbol: 'DOT', decimals: 10, logoURI: '/tokens/dot.png' },
    rpcEndpoints: [{ url: 'https://rpc.polkadot.io', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Subscan', baseUrl: 'https://polkadot.subscan.io', txPath: '/extrinsic/', addressPath: '/account/', tokenPath: '/asset/' },
    finality: { reorgSafetyBlocks: 2, instantFinality: true, typicalBlockTimeSec: 6, safeFinalityTimeSec: 12 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#E6007A',
    iconURI: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png',
    defaultTokens: [
      {
        address: 'DOT',
        chainId: 'polkadot',
        name: 'Polkadot',
        symbol: 'DOT',
        decimals: 10,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: '/tokens/dot.png'
      }
    ]
  },

  icp: {
    id: 'icp',
    chainId: 0,
    canonicalName: 'Internet Computer',
    shortName: 'ICP',
    executionEnvironment: 'ICP',
    category: 'LAYER_1',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ICP', 'ICRC-1', 'ICRC-2'],
    nativeCurrency: { name: 'Internet Computer', symbol: 'ICP', decimals: 8, logoURI: 'https://assets.coingecko.com/coins/images/14495/small/Internet_Computer_logo.png' },
    rpcEndpoints: [{ url: 'https://ic0.app', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'ICScan', baseUrl: 'https://dashboard.internetcomputer.org', txPath: '/transaction/', addressPath: '/account/', tokenPath: '/canister/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 1, safeFinalityTimeSec: 2 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: false, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'GROWING',
    productionStatus: 'ACTIVE',
    color: '#29ABE2',
    iconURI: 'https://assets.coingecko.com/coins/images/14495/small/Internet_Computer_logo.png',
    defaultTokens: [
      {
        address: 'icp-ledger',
        chainId: 'icp',
        name: 'Internet Computer',
        symbol: 'ICP',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/14495/small/Internet_Computer_logo.png'
      }
    ]
  },

  dogecoin: {
    id: 'dogecoin',
    chainId: 0,
    canonicalName: 'Dogecoin',
    shortName: 'Dogecoin',
    executionEnvironment: 'UTXO',
    category: 'LAYER_1',
    tier: 'TIER_3',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['DOGE'],
    nativeCurrency: { name: 'Dogecoin', symbol: 'DOGE', decimals: 8, logoURI: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png' },
    rpcEndpoints: [{ url: 'https://dogechain.info/api', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'DogeChain', baseUrl: 'https://dogechain.info', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 6, instantFinality: false, typicalBlockTimeSec: 60, safeFinalityTimeSec: 360 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: false, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'DEEP',
    productionStatus: 'ACTIVE',
    color: '#C2A633',
    iconURI: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'dogecoin',
        name: 'Dogecoin',
        symbol: 'DOGE',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png'
      }
    ]
  },

  bitcoin: {
    id: 'bitcoin',
    chainId: 0,
    canonicalName: 'Bitcoin',
    shortName: 'Bitcoin',
    executionEnvironment: 'BITCOIN',
    category: 'LAYER_1',
    tier: 'TIER_4',
    operationalStatus: 'PARTIALLY_AVAILABLE',
    supportedStandards: ['BTC', 'Ordinals', 'Runes', 'BRC-20'],
    nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 8, logoURI: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png' },
    rpcEndpoints: [
      { url: 'https://mempool.space/api', priority: 1, status: 'HEALTHY' },
      { url: 'https://blockstream.info/api', priority: 2, status: 'HEALTHY' }
    ],
    explorer: { name: 'Mempool', baseUrl: 'https://mempool.space', txPath: '/tx/', addressPath: '/address/', tokenPath: '/address/' },
    finality: { reorgSafetyBlocks: 6, instantFinality: false, typicalBlockTimeSec: 600, safeFinalityTimeSec: 3600 },
    capabilities: {
      wallet: false, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: false,
      swap: false, smartRouting: false, simulation: false, portfolio: true, history: true,
      mevProtection: false, crossChain: false, zenithLiquidity: false, api: true, sdk: true,
      hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EXPERIMENTAL',
    productionStatus: 'PLANNED',
    color: '#F7931A',
    iconURI: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'bitcoin',
        name: 'Bitcoin',
        symbol: 'BTC',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png'
      },
      {
        address: 'ord:ordi',
        chainId: 'bitcoin',
        name: 'Ordinals',
        symbol: 'ORDI',
        decimals: 8,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/30162/small/ordi.png'
      },
      {
        address: 'ord:sats',
        chainId: 'bitcoin',
        name: '1000SATS',
        symbol: 'SATS',
        decimals: 8,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://assets.coingecko.com/coins/images/33713/small/sats.png'
      },
      {
        address: 'rune:dog_go_to_the_moon',
        chainId: 'bitcoin',
        name: 'DOG•GO•TO•THE•MOON',
        symbol: 'DOG',
        decimals: 8,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://assets.coingecko.com/coins/images/37383/small/dog.png'
      },
      {
        address: 'rune:pups_world_peace',
        chainId: 'bitcoin',
        name: 'PUPS World Peace',
        symbol: 'PUPS',
        decimals: 8,
        verificationTier: 'COMMUNITY_VERIFIED',
        logoURI: 'https://assets.coingecko.com/coins/images/37159/small/token_logo.png'
      }
    ]
  },

  monad: {
    id: 'monad',
    chainId: 10143,
    canonicalName: 'Monad',
    shortName: 'Monad',
    executionEnvironment: 'EVM',
    category: 'HIGH_THROUGHPUT_L1',
    tier: 'TIER_4',
    operationalStatus: 'MAINTENANCE',
    supportedStandards: ['ERC-20', 'Parallel EVM', 'Permit2'],
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/34407/small/monad.png' },
    rpcEndpoints: [{ url: 'https://rpc.monad.xyz', priority: 1, status: 'DEGRADED' }],
    explorer: { name: 'MonadScan', baseUrl: 'https://monadscan.xyz', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.2, safeFinalityTimeSec: 0.8 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EXPERIMENTAL',
    productionStatus: 'BETA',
    color: '#836EF9',
    iconURI: '/networks/monad.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'monad',
        name: 'Monad',
        symbol: 'MON',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://monad.xyz/favicon.ico'
      },
      {
        address: '0x0000000000000000000000000000000000000020',
        chainId: 'monad',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x0000000000000000000000000000000000000024',
        chainId: 'monad',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/2518/small/weth.png'
      },
      {
        address: '0x0000000000000000000000000000000000000021',
        chainId: 'monad',
        name: 'Chog',
        symbol: 'CHOG',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED'
      },
      {
        address: '0x0000000000000000000000000000000000000026',
        chainId: 'monad',
        name: 'Moyaki',
        symbol: 'MOYAKI',
        decimals: 18,
        verificationTier: 'COMMUNITY_VERIFIED'
      }
    ]
  },

  robinhood: {
    id: 'robinhood',
    chainId: 42161,
    canonicalName: 'Robinhood Chain',
    shortName: 'Robinhood',
    executionEnvironment: 'EVM',
    category: 'ORBIT_RWA',
    tier: 'TIER_4',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'RWA Gated Token', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://rpc.robinhood.io', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Robinhood Explorer', baseUrl: 'https://explorer.robinhood.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 10, instantFinality: false, typicalBlockTimeSec: 0.25, safeFinalityTimeSec: 10 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: true, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: true, blockedRegions: ['OFAC_SANCTIONED'], tokenizedSecuritiesPresent: true, requiresAccreditationNotice: true },
    liquidityMaturity: 'EXPERIMENTAL',
    productionStatus: 'BETA',
    color: '#00C805',
    iconURI: '/networks/robinhood.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'robinhood',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      }
    ]
  },

  tempo: {
    id: 'tempo',
    chainId: 204,
    canonicalName: 'Tempo',
    shortName: 'Tempo',
    executionEnvironment: 'EVM',
    category: 'PAYMENTS_NETWORK',
    tier: 'TIER_4',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Real-Time Payment Channel'],
    nativeCurrency: { name: 'Tempo', symbol: 'TEMPO', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://rpc.tempo.network', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'Tempo Explorer', baseUrl: 'https://explorer.tempo.network', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.1, safeFinalityTimeSec: 0.5 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: true, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EXPERIMENTAL',
    productionStatus: 'BETA',
    color: '#6366F1',
    iconURI: '/networks/tempo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'tempo',
        name: 'Tempo',
        symbol: 'TEMPO',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://tempo.network/favicon.ico'
      },
      {
        address: '0x0000000000000000000000000000000000000010',
        chainId: 'tempo',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x0000000000000000000000000000000000000012',
        chainId: 'tempo',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x0000000000000000000000000000000000000014',
        chainId: 'tempo',
        name: 'Tempo Pay Utility',
        symbol: 'PAY',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL'
      }
    ]
  },

  megaeth: {
    id: 'megaeth',
    chainId: 4242,
    canonicalName: 'MegaETH',
    shortName: 'MegaETH',
    executionEnvironment: 'EVM',
    category: 'HIGH_THROUGHPUT_L1',
    tier: 'TIER_4',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Real-Time Sub-millisecond', 'Permit2'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [{ url: 'https://rpc.megaeth.systems', priority: 1, status: 'HEALTHY' }],
    explorer: { name: 'MegaScan', baseUrl: 'https://megascan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.01, safeFinalityTimeSec: 0.1 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: true, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EXPERIMENTAL',
    productionStatus: 'BETA',
    color: '#A855F7',
    iconURI: '/networks/megaeth.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'megaeth',
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x0000000000000000000000000000000000000070',
        chainId: 'megaeth',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x0000000000000000000000000000000000000072',
        chainId: 'megaeth',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
      },
      {
        address: '0x0000000000000000000000000000000000000073',
        chainId: 'megaeth',
        name: 'MegaETH Governance',
        symbol: 'MEGA',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: '/tokens/mega.png'
      }
    ]
  }
};

export const ZENITH_TESTNET_CHAINS: Record<string, ChainConfig> = {
  sepolia: {
    id: 'sepolia',
    chainId: 11155111,
    canonicalName: 'Ethereum Sepolia Testnet',
    shortName: 'Sepolia',
    executionEnvironment: 'EVM',
    category: 'LAYER_1',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Permit2'],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [
      { url: 'https://ethereum-sepolia-rpc.publicnode.com', priority: 1, status: 'HEALTHY' },
      { url: 'https://rpc2.sepolia.org', priority: 2, status: 'HEALTHY' }
    ],
    explorer: { name: 'Etherscan Sepolia', baseUrl: 'https://sepolia.etherscan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 12, instantFinality: false, typicalBlockTimeSec: 12, safeFinalityTimeSec: 144 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EXPERIMENTAL',
    productionStatus: 'BETA',
    color: '#627EEA',
    iconURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'sepolia',
        name: 'Sepolia Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        chainId: 'sepolia',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
        chainId: 'sepolia',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/2518/small/weth.png'
      }
    ]
  },

  arbitrum_sepolia: {
    id: 'arbitrum_sepolia',
    chainId: 421614,
    canonicalName: 'Arbitrum Sepolia Testnet',
    shortName: 'Arb Sepolia',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Permit2'],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [
      { url: 'https://sepolia-rollup.arbitrum.io/rpc', priority: 1, status: 'HEALTHY' }
    ],
    explorer: { name: 'Arbiscan Sepolia', baseUrl: 'https://sepolia.arbiscan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 0.25, safeFinalityTimeSec: 1 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: true
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EXPERIMENTAL',
    productionStatus: 'BETA',
    color: '#28A0F0',
    iconURI: 'https://assets.coingecko.com/coins/images/16547/small/arbitrum_logo.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'arbitrum_sepolia',
        name: 'Sepolia Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        chainId: 'arbitrum_sepolia',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      },
      {
        address: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
        chainId: 'arbitrum_sepolia',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/2518/small/weth.png'
      }
    ]
  },

  base_sepolia: {
    id: 'base_sepolia',
    chainId: 84532,
    canonicalName: 'Base Sepolia Testnet',
    shortName: 'Base Sepolia',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Permit2'],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [
      { url: 'https://sepolia.base.org', priority: 1, status: 'HEALTHY' }
    ],
    explorer: { name: 'Basescan Sepolia', baseUrl: 'https://sepolia.basescan.org', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 2, safeFinalityTimeSec: 4 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EXPERIMENTAL',
    productionStatus: 'BETA',
    color: '#0052FF',
    iconURI: '/networks/base.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'base_sepolia',
        name: 'Sepolia Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        chainId: 'base_sepolia',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      }
    ]
  },

  optimism_sepolia: {
    id: 'optimism_sepolia',
    chainId: 11155420,
    canonicalName: 'Optimism Sepolia Testnet',
    shortName: 'OP Sepolia',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_1',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Permit2'],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    rpcEndpoints: [
      { url: 'https://sepolia.optimism.io', priority: 1, status: 'HEALTHY' }
    ],
    explorer: { name: 'Optimism Sepolia Explorer', baseUrl: 'https://sepolia-optimism.etherscan.io', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 1, instantFinality: true, typicalBlockTimeSec: 2, safeFinalityTimeSec: 4 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: true, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EXPERIMENTAL',
    productionStatus: 'BETA',
    color: '#FF0420',
    iconURI: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'optimism_sepolia',
        name: 'Sepolia Ether',
        symbol: 'ETH',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
      },
      {
        address: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
        chainId: 'optimism_sepolia',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL',
        logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
      }
    ]
  },

  polygon_amoy: {
    id: 'polygon_amoy',
    chainId: 80002,
    canonicalName: 'Polygon Amoy Testnet',
    shortName: 'Amoy',
    executionEnvironment: 'EVM',
    category: 'OPTIMISTIC_ROLLUP',
    tier: 'TIER_2',
    operationalStatus: 'HEALTHY',
    supportedStandards: ['ERC-20', 'Permit2'],
    nativeCurrency: { name: 'Polygon Ecosystem Token', symbol: 'POL', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png' },
    rpcEndpoints: [
      { url: 'https://polygon-amoy-bor-rpc.publicnode.com', priority: 1, status: 'HEALTHY' }
    ],
    explorer: { name: 'PolygonScan Amoy', baseUrl: 'https://amoy.polygonscan.com', txPath: '/tx/', addressPath: '/address/', tokenPath: '/token/' },
    finality: { reorgSafetyBlocks: 64, instantFinality: false, typicalBlockTimeSec: 2, safeFinalityTimeSec: 128 },
    capabilities: {
      wallet: true, tokenDiscovery: true, tokenRisk: true, priceData: true, liquidityDiscovery: true,
      swap: true, smartRouting: true, simulation: true, portfolio: true, history: true,
      mevProtection: false, crossChain: false, zenithLiquidity: true, api: true, sdk: true,
      supportsEIP1559: true, supportsPermit2: true, hasSubSecondBlocks: false
    },
    regulatoryScope: { jurisdictionGated: false },
    liquidityMaturity: 'EXPERIMENTAL',
    productionStatus: 'BETA',
    color: '#8247E5',
    iconURI: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
    defaultTokens: [
      {
        address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        chainId: 'polygon_amoy',
        name: 'Polygon Ecosystem Token',
        symbol: 'POL',
        decimals: 18,
        verificationTier: 'VERIFIED_CANONICAL',
        isNative: true,
        logoURI: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png'
      }
    ]
  }
};
