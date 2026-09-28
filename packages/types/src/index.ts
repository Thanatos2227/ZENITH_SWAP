export type ExecutionEnvironment = 'EVM' | 'SOLANA' | 'BITCOIN' | 'TVM' | 'COSMOS' | 'MOVE' | 'NEAR' | 'TON' | 'SUBSTRATE' | 'XRPL' | 'STELLAR' | 'UTXO' | 'ICP';
export type NetworkSupportTier = 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4';
export type OperationalStatus = 'HEALTHY' | 'DEGRADED' | 'MAINTENANCE' | 'PARTIALLY_AVAILABLE' | 'PAUSED' | 'DISABLED';
export type NetworkCategory = 'LAYER_1' | 'OPTIMISTIC_ROLLUP' | 'ZK_ROLLUP' | 'ORBIT_RWA' | 'PAYMENTS_NETWORK' | 'HIGH_THROUGHPUT_L1';
export interface ChainRPCConfig {
    url: string;
    isPrivate?: boolean;
    priority: number;
    weight?: number;
    supportsSimulation?: boolean;
    latencyMs?: number;
    status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
}
export interface ChainExplorerConfig {
    name: string;
    baseUrl: string;
    txPath: string;
    addressPath: string;
    tokenPath: string;
}
export interface NativeCurrency {
    name: string;
    symbol: string;
    decimals: number;
    logoURI?: string;
}
export interface FinalityConfig {
    reorgSafetyBlocks: number;
    instantFinality: boolean;
    typicalBlockTimeSec: number;
    safeFinalityTimeSec: number;
}
export interface ChainCapabilities {
    wallet: boolean;
    tokenDiscovery: boolean;
    tokenRisk: boolean;
    priceData: boolean;
    liquidityDiscovery: boolean;
    swap: boolean;
    smartRouting: boolean;
    simulation: boolean;
    portfolio: boolean;
    history: boolean;
    mevProtection: boolean;
    crossChain: boolean;
    zenithLiquidity: boolean;
    api: boolean;
    sdk: boolean;
    supportsEIP1559?: boolean;
    supportsPermit2?: boolean;
    supportsFlashbots?: boolean;
    supportsSimulation?: boolean;
    supportsBatchTransactions?: boolean;
    hasSubSecondBlocks?: boolean;
    requiresSpecificGasPriceOracle?: boolean;
}
export interface RegulatoryScopeFlags {
    jurisdictionGated: boolean;
    blockedRegions?: string[];
    tokenizedSecuritiesPresent?: boolean;
    requiresAccreditationNotice?: boolean;
}
export interface ChainConfig {
    id: string;
    chainId?: number;
    canonicalName: string;
    shortName: string;
    executionEnvironment: ExecutionEnvironment;
    category: NetworkCategory;
    tier: NetworkSupportTier;
    operationalStatus: OperationalStatus;
    supportedStandards: string[];
    nativeCurrency: NativeCurrency;
    rpcEndpoints: ChainRPCConfig[];
    explorer: ChainExplorerConfig;
    finality: FinalityConfig;
    capabilities: ChainCapabilities;
    regulatoryScope: RegulatoryScopeFlags;
    liquidityMaturity: 'DEEP' | 'GROWING' | 'EMERGING' | 'EXPERIMENTAL';
    productionStatus: 'ACTIVE' | 'BETA' | 'MAINTENANCE' | 'PLANNED';
    color: string;
    iconURI: string;
    defaultTokens?: Token[];
}
export type VerificationTier = 'VERIFIED_CANONICAL' | 'COMMUNITY_VERIFIED' | 'UNVERIFIED' | 'SUSPICIOUS';
export interface TokenSecurityProfile {
    isHoneypot: boolean;
    buyTaxPercent: number;
    sellTaxPercent: number;
    transferTaxPercent: number;
    canBlacklist: boolean;
    canMintArbitrary: boolean;
    isProxy: boolean;
    liquidityLockedPercent: number;
    holderConcentrationTop10Percent: number;
    hasMaliciousPatterns: boolean;
    riskScore: number;
    warnings: string[];
}
export interface Token {
    address: string;
    chainId: string;
    name: string;
    symbol: string;
    decimals: number;
    logoURI?: string;
    wrappedAddress?: string;
    enabled?: boolean;
    priceUSD?: number;
    change24hUSD?: number;
    volume24hUSD?: number;
    verificationTier: VerificationTier;
    securityProfile?: TokenSecurityProfile;
    isNative?: boolean;
    tags?: string[];
}
export interface UnsupportedTokenMetadata {
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
    coingeckoId?: string;
    supportedNetworks: string[];
    reason: string;
}
export type DEXProtocol = 'ZENITH_V1' | 'ZENITH_V2' | 'ZENITH_V3' | 'ZENITH_V4_CONCENTRATED' | 'ZENITH_DUTCH_INTENT' | 'ZENITH_INTERNAL_RFIS' | 'UNISWAP_V2' | 'UNISWAP_V3' | 'UNISWAP_V4' | 'CURVE' | 'BALANCER_V2' | 'AERODROME' | 'VELODROME' | 'CAMELOT' | 'QUICKSWAP' | 'PANCAKESWAP' | 'TRADER_JOE' | 'RAYDIUM' | 'ORCA_WHIRLPOOL' | 'METEORA';
export type BridgeProtocol = 'STARGATE' | 'STARGATE_V2' | 'ACROSS' | 'ACROSS_V3' | 'LIFI' | 'SOCKET' | 'CHAINLINK_CCIP' | 'DEBRIDGE' | 'DEBRIDGE_DLN' | 'WORMHOLE';
export type Address = string;
export type TxHash = string;
export type ChainId = string;
export interface RouteHop {
    dexProtocol: DEXProtocol;
    poolAddress: string;
    tokenIn: Token;
    tokenOut: Token;
    feeTierBps?: number;
    proportionPercent: number;
    estimatedGas: bigint | number;
}
export interface BridgeStep {
    bridgeProtocol: BridgeProtocol;
    sourceChainId: string;
    destinationChainId: string;
    tokenIn: Token;
    tokenOut: Token;
    estimatedTransferTimeSec: number;
    bridgeFeeUSD: number;
    securityRating: 'A+' | 'A' | 'B' | 'EXPERIMENTAL';
    relayerFee: string;
}
export interface CrossChainQuote {
    provider: BridgeProtocol;
    providerName: string;
    bridgeName?: string;
    sourceChainId: string;
    destinationChainId: string;
    sourceToken: Token;
    destinationToken: Token;
    sourceAmountRaw: string;
    destinationAmountRaw: string;
    minDestinationAmountRaw: string;
    bridgeFeeUSD: number;
    relayerFee: string;
    gasEstimateUSD: number;
    recipient: string;
    expiration: number;
    routeIdentifier: string;
    executionTarget: string;
    calldata: string;
    value: string;
    approvalTarget: string;
    quoteTimestamp: number;
    estimatedTransferTimeSec: number;
    estimatedDurationSeconds?: number;
    securityRating: 'A+' | 'A' | 'B' | 'EXPERIMENTAL';
    isExecutable?: boolean;
    unexecutableReason?: string;
    diagnostics?: ExecutionPlanDiagnostic[];
    sourceDexQuote?: DEXQuote;
    destDexQuote?: DEXQuote;
    underlyingBridgeQuote?: CrossChainQuote;
    sourceConnectorToken?: Token;
    destConnectorToken?: Token;
    compositeExecutionMode?: CompositeExecutionMode;
}
export interface DEXExecution {
    to: string;
    data: string;
    value: string;
    chainId: number;
    approvalTarget: string;
    requiredAllowanceRaw?: string;
    approvalAmount?: string;
    gasLimit?: string;
    gasEstimateUnits?: bigint;
}
export interface DEXQuote {
    provider: DEXProtocol;
    providerName: string;
    chainId: number | string;
    tokenIn: Token;
    tokenOut: Token;
    amountIn: bigint;
    amountOut: bigint;
    minimumAmountOut: bigint;
    amountInRaw?: string;
    amountOutRaw?: string;
    minimumOutRaw?: string;
    feeAmount: bigint;
    feeAmountRaw?: string;
    feeTierBps: number;
    priceImpactPercent: number;
    gasEstimate: bigint;
    gasEstimateUnits?: bigint;
    gasCostUSD: number;
    executionTarget: string;
    approvalTarget: string;
    calldata?: string;
    value?: string;
    quoteTimestamp: number;
    quoteBlockNumber?: number;
    poolAddress?: string;
    expiration: number;
    routePath?: string[];
    execution?: DEXExecution;
}
export interface DEXQuoteParams {
    chainId: number;
    tokenIn: Token;
    tokenOut: Token;
    amountIn: bigint;
    slippageToleranceBps: number;
    feeTierBps?: number;
    recipient?: string;
    provider?: any;
    rpcUrl?: string;
}
export interface DEXProvider {
    readonly id?: DEXProtocol;
    readonly name?: string;
    readonly protocol: DEXProtocol;
    readonly supportedChainIds: number[];
    isAvailable?(chainId: number | string, tokenIn: Token, tokenOut: Token): boolean | Promise<boolean>;
    getQuote(params: DEXQuoteParams): Promise<DEXQuote | null>;
    buildExecution(quote: DEXQuote, userAddress: string, recipientAddress?: string, deadline?: number): Promise<DEXExecution>;
    simulateExecution?(execution: DEXExecution, userAddress: string): Promise<SimulationResult>;
}
export interface CrossChainExecution {
    to: string;
    data: string;
    value: string;
    chainId: number;
    approvalTarget?: string;
    requiredAllowanceRaw?: string;
    approvalAmount?: string;
    gasLimit?: string;
}
export interface CrossChainStatus {
    state: SettlementState;
    sourceTxHash: string;
    destinationTxHash?: string;
    isComplete: boolean;
    isFailed: boolean;
    errorMessage?: string;
    timestamp: number;
}
export interface CrossChainProvider {
    readonly id: BridgeProtocol;
    readonly name: string;
    isAvailable(sourceChainId: string, destChainId: string, tokenIn: Token, tokenOut: Token): boolean;
    getQuote(request: QuoteRequest): Promise<CrossChainQuote | null>;
    buildExecution(quote: CrossChainQuote, userAddress: string, recipientAddress?: string): Promise<CrossChainExecution>;
    getStatus(sourceTxHash: string, quote: CrossChainQuote): Promise<CrossChainStatus>;
    getDestinationTransaction(sourceTxHash: string, quote: CrossChainQuote): Promise<string | null>;
}
export interface SwapRoute {
    id: string;
    routeType: 'DIRECT' | 'MULTI_HOP' | 'SPLIT_ROUTE' | 'CROSS_CHAIN' | 'INTENT_SOLVER' | 'ZENITH_V4_CONCENTRATED' | 'ZENITH_DUTCH_INTENT';
    hops: RouteHop[];
    bridgeStep?: BridgeStep;
    crossChainQuote?: CrossChainQuote;
    dexQuote?: DEXQuote;
    execution?: DEXExecution | CrossChainExecution;
    gasCostUSD: number;
    estimatedGasUnits: bigint | number;
    dexKey?: string;
    dexName?: string;
    path?: Token[];
    pools?: any[];
    amountInRaw?: string;
    amountInFormatted?: string;
    amountOutRaw?: string;
    amountOutFormatted?: string;
    priceImpact?: PriceImpact;
    effectiveExecutionScore?: number;
    isExecutable?: boolean;
    unexecutableReason?: string;
    diagnostics?: ExecutionPlanDiagnostic[];
    executionPlan?: ExecutionPlan;
}
export interface PriceImpact {
    percentage: number;
    level?: 'NEGLIGIBLE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    severity?: 'NEGLIGIBLE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    priceImpactUSD?: number;
    warningMessage?: string;
}
export interface ProtocolFee {
    feeBps: number;
    feeAmountRaw: string;
    feeAmountFormatted: string;
    feeUSD: number;
    treasuryRecipient?: string;
}
export interface SwapFee {
    feeBps: number;
    feeAmountRaw: string;
    feeAmountFormatted: string;
    feeUSD: number;
}
export type TradeType = 'EXACT_INPUT' | 'EXACT_OUTPUT';
export interface ConstantProductPoolState {
    address: string;
    token0: Token;
    token1: Token;
    reserve0Raw: string;
    reserve1Raw: string;
    feeBps: number;
}
export interface ConcentratedPoolState {
    address: string;
    token0: Token;
    token1: Token;
    sqrtPriceX96Raw: string;
    currentTick: number;
    tickSpacing: number;
    liquidityRaw: string;
    feeTierBps: number;
}
export type SettlementState = 'CREATED' | 'SIGNED' | 'SUBMITTED' | 'ACCEPTED' | 'FULFILLING' | 'DESTINATION_FILLED' | 'VERIFIED' | 'SETTLING' | 'SETTLED' | 'EXPIRED' | 'CANCELLED' | 'REJECTED' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED' | 'TRACKING_TIMEOUT' | 'TRACKING_UNAVAILABLE';
export interface CrossChainIntent {
    orderId: string;
    sourceChainId: string;
    destinationChainId: string;
    sourceToken: Token;
    destinationToken: Token;
    sourceAmountRaw: string;
    minDestinationAmountRaw: string;
    recipient: string;
    deadline: number;
    nonce: number;
    userSignature?: string;
    status: SettlementState;
    solverId?: string;
    txHashSource?: string;
    txHashDestination?: string;
    createdAt: number;
    updatedAt?: number;
}
export interface SolverFillQuote {
    solverId: string;
    solverName: string;
    destinationAmountRaw: string;
    destinationAmountFormatted: string;
    estimatedTimeSec: number;
    executionCostUSD: number;
    solverReputationScore: number;
    isGuaranteed: boolean;
}
export interface QuoteRequest {
    sourceChainId: string;
    destinationChainId: string;
    srcChainId?: string;
    destChainId?: string;
    tokenIn: Token;
    tokenOut: Token;
    amountInRaw: string;
    amountOutRaw?: string;
    amountIn?: string;
    amountOut?: string;
    tradeType?: TradeType;
    slippageTolerancePercent: number;
    userWalletAddress?: string;
    recipientAddress?: string;
    recipient?: string;
    mevProtectionEnabled?: boolean;
    gasPreset?: GasPreset;
    deadlineSeconds?: number;
    executionMode?: 'LIVE_EXECUTION' | 'LIVE_ONCHAIN' | 'PREFLIGHT_ONLY' | 'SIMULATION' | 'READ_ONLY' | 'DIAGNOSTIC';
    requiredCapabilityLevel?: ProviderCapabilityLevel;
}
export interface ExecutableTransaction {
    to: string;
    data: string;
    value: string;
    from?: string;
    chainId: number;
    gasLimit?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    approvalTarget?: string;
    amountInRaw?: string;
    minimumOutRaw?: string;
    deadline?: number;
}
export interface QuoteValidationResult {
    isValid: boolean;
    isExecutable: boolean;
    errors: string[];
    warnings: string[];
    validatedAt: number;
}
export interface QuoteResponse {
    requestId: string;
    request: QuoteRequest;
    tradeType: TradeType;
    routes: SwapRoute[];
    bestRoute: SwapRoute;
    amountInRaw: string;
    amountInFormatted: string;
    amountOutRaw: string;
    amountOutFormatted: string;
    minimumReceivedRaw: string;
    minimumReceivedFormatted: string;
    maximumInputRaw?: string;
    maximumInputFormatted?: string;
    executionPrice: number;
    referencePrice?: number;
    priceImpact: PriceImpact;
    protocolFee: ProtocolFee;
    swapFee?: SwapFee;
    effectiveExecutionScore: number;
    quoteTimestamp: number;
    expiresAt: number;
    deadline: number;
    freshnessSeconds: number;
    simulationPreview?: SimulationResult;
    intent?: CrossChainIntent;
    dexQuote?: DEXQuote;
    crossChainQuote?: CrossChainQuote;
    executionTarget?: string;
    isExecutable?: boolean;
    unexecutableReason?: string;
    diagnostics?: ExecutionPlanDiagnostic[];
    executionPlan?: ExecutionPlan;
    executableTransaction?: ExecutableTransaction;
    validation?: QuoteValidationResult;
}
export interface TokenBalanceDelta {
    token: Token;
    deltaRaw: string;
    deltaFormatted: string;
    deltaUSD?: number;
    isIncoming: boolean;
}
export interface SimulationStateOverride {
    address: string;
    balanceOverride?: string;
    stateDiff?: Record<string, string>;
}
export interface SimulationRequest {
    chainId: string;
    fromAddress: string;
    toAddress: string;
    calldata: string;
    valueWei: string;
    stateOverrides?: SimulationStateOverride[];
}
export interface SimulationResult {
    isSuccess: boolean;
    gasEstimate?: string;
    gasLimit?: string;
    gasUsed?: number | bigint | string;
    revertReason?: string;
    stateOverridesApplied?: boolean;
    balanceDeltas: TokenBalanceDelta[];
    approvalRequired: boolean;
    approvalTokenAddress?: string;
    approvalSpenderAddress?: string;
    approvalAmountRaw?: string;
    warnings: string[];
    simulationSource: 'NODE_ETH_CALL' | 'TENDERLY' | 'ALCHEMY' | 'LOCAL_OVERRIDE';
}
export type TransactionStatus = 'IDLE' | 'QUOTE_REQUESTED' | 'QUOTED' | 'SIMULATING' | 'SIMULATED' | 'APPROVAL_NEEDED' | 'APPROVING' | 'APPROVED' | 'SIGNING' | 'SUBMITTING' | 'BROADCASTED' | 'CONFIRMING' | 'COMPLETED' | 'BRIDGE_SOURCE_CONFIRMED' | 'BRIDGE_IN_FLIGHT' | 'BRIDGE_DESTINATION_CONFIRMED' | 'DESTINATION_FILLED' | 'SETTLED' | 'REFUND_PENDING' | 'REFUNDED' | 'TRACKING_TIMEOUT' | 'TRACKING_UNAVAILABLE' | 'FAILED' | 'REVERTED' | 'CANCELLED';
export interface ExecutionStep {
    id: string;
    title: string;
    description: string;
    status: 'PENDING' | 'ACTIVE' | 'SUCCESS' | 'ERROR';
    txHash?: string;
    explorerUrl?: string;
    timestamp?: number;
    error?: string;
}
export interface ReceiptView {
    txHash: string;
    sourceChain: ChainConfig;
    destinationChain: ChainConfig;
    destChain?: ChainConfig;
    tokenIn: Token;
    tokenOut: Token;
    amountInFormatted: string;
    amountOutFormatted: string;
    amountOutUSD?: number;
    realizedPriceImpactPercent: number;
    realizedSlippagePercent: number;
    gasPaidUSD: number;
    protocolFeePaidUSD: number;
    effectiveExecutionScore: number;
    timestamp: number;
    status: 'COMPLETED' | 'REVERTED' | 'FAILED' | 'PENDING' | 'BRIDGE_IN_FLIGHT' | 'TRACKING_TIMEOUT' | 'REFUNDED' | 'SETTLED';
    revertReason?: string;
    explorerUrl: string;
    routeSummary: string;
    bridgeDetails?: {
        bridgeName: string;
        sourceTxHash: string;
        destTxHash?: string;
        elapsedSec: number;
        sourceExplorerUrl?: string;
        destExplorerUrl?: string;
        destinationVerified?: boolean;
    };
}
export interface CircuitBreakerState {
    isEmergencyPaused: boolean;
    pausedChains: string[];
    priceDeviationCapPercent: number;
    lastPausedTimestamp?: number;
    pauseReason?: string;
    authorizedPauseSigner: string;
}
export type SlippagePreset = 'AUTO' | '0.1%' | '0.5%' | '1.0%' | 'CUSTOM';
export type GasPreset = 'STANDARD' | 'FAST' | 'INSTANT';
export type MEVProtectionLevel = 'NONE' | 'FLASHBOTS_PRIVATE' | 'RPC_STEALTH';
export type WalletType = 'METAMASK' | 'PHANTOM' | 'COINBASE' | 'RABBY' | 'OKX' | 'RAINBOW' | 'WALLETCONNECT' | 'INJECTED';
export interface WalletOption {
    id: WalletType;
    name: string;
    icon: string;
    isDetected: boolean;
    environment: 'EVM' | 'SOLANA' | 'MULTI';
    downloadUrl: string;
}
export interface UserPreferences {
    isProMode: boolean;
    theme: 'dark' | 'light';
    slippageTolerancePercent: number;
    slippagePreset: SlippagePreset;
    gasPreset: GasPreset;
    mevProtection: MEVProtectionLevel;
    allowPartialFills: boolean;
    autoApprovePermit2: boolean;
    expertModeUnlocked: boolean;
    notificationsEnabled: boolean;
    soundEnabled: boolean;
    reducedMotion: boolean;
}
export interface ZenithNotification {
    id: string;
    title: string;
    message: string;
    type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'BRIDGE_UPDATE';
    timestamp: number;
    isRead?: boolean;
    txHash?: string;
    chainId?: string;
    actionUrl?: string;
}
export type ExecutionStatus = TransactionStatus;
export type SwapQuote = QuoteResponse;
export interface ZenithPool {
    id: string;
    poolAddress: string;
    chainId: string;
    token0: Token;
    token1: Token;
    feeBps: number;
    tickSpacing: number;
    sqrtPriceX96: string;
    currentTick: number;
    liquidity: string;
    tvlUSD: number;
    volume24hUSD: number;
    volume7dUSD: number;
    fees24hUSD: number;
    aprPercent: number;
    hookAddress?: string;
    hookName?: string;
    isDynamicFee?: boolean;
}
export interface LPPosition {
    tokenId: string;
    poolId: string;
    token0: Token;
    token1: Token;
    feeBps: number;
    tickLower: number;
    tickUpper: number;
    priceLower: number;
    priceUpper: number;
    currentPrice: number;
    isInRange: boolean;
    liquidityRaw: string;
    depositedAmount0: string;
    depositedAmount1: string;
    depositedUSD: number;
    unclaimedFee0: string;
    unclaimedFee1: string;
    unclaimedFeeUSD: number;
    earnedAprPercent: number;
    createdAt: number;
}
export interface ConcentratedRange {
    minPrice: number;
    maxPrice: number;
    tickLower: number;
    tickUpper: number;
    isFullRange: boolean;
}
export interface DutchAuctionOrderIntent {
    orderId: string;
    userAddress: string;
    inputToken: Token;
    outputToken: Token;
    inputAmountRaw: string;
    startOutputAmountRaw: string;
    endOutputAmountRaw: string;
    decayStartTime: number;
    decayEndTime: number;
    recipient: string;
    nonce: number;
    signature?: string;
    status: 'PENDING' | 'FILLING' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
    fillerAddress?: string;
    fillTxHash?: string;
    filledOutputRaw?: string;
}
export interface ProtocolAnalytics {
    totalValueLockedUSD: number;
    totalVolume24hUSD: number;
    totalVolume7dUSD: number;
    totalFees24hUSD: number;
    totalTransactions24h: number;
    activeLPsCount: number;
    topPools: ZenithPool[];
    topTokens: Token[];
    historicalVolume: Array<{
        timestamp: number;
        volumeUSD: number;
        tvlUSD: number;
    }>;
}
export type CompositeExecutionMode = 'ATOMIC' | 'SOLVER' | 'SEPARATE_DESTINATION_TX' | 'UNSUPPORTED';
export type ExecutionStepType = 'VALIDATION' | 'APPROVAL' | 'SOURCE_APPROVAL' | 'SOURCE_SWAP' | 'BRIDGE_QUOTE_REFRESH' | 'BRIDGE_DEPOSIT' | 'BRIDGE_RELAY_WAIT' | 'DESTINATION_APPROVAL' | 'DESTINATION_SWAP' | 'DESTINATION_VERIFY' | 'SETTLEMENT_COMPLETE';
export type StepExecutionEnvironment = 'EVM' | 'SOLANA' | 'OFF_CHAIN';
export type StepStatus = 'NOT_STARTED' | 'PENDING' | 'SIMULATING' | 'SIGNING' | 'SUBMITTED' | 'CONFIRMING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
export interface ExecutionStepRetryPolicy {
    maxRetries: number;
    backoffMs: number;
    timeoutMs: number;
}
export interface ExecutionStepVerificationCondition {
    type: 'ON_CHAIN_RECEIPT' | 'EVENT_EMITTED' | 'BALANCE_DELTA' | 'API_STATUS';
    expectedValue?: string;
}
export interface ExecutionPlanStep {
    readonly id: string;
    readonly type: ExecutionStepType;
    readonly title: string;
    readonly description: string;
    readonly chainId: string;
    readonly numericChainId?: number;
    readonly executionEnvironment: StepExecutionEnvironment;
    targetAddress?: string;
    calldata?: string;
    valueWei?: string;
    approvalTarget?: string;
    requiredTokenAddress?: string;
    requiredTokenSymbol?: string;
    requiredAmountRaw?: string;
    outputTokenAddress?: string;
    outputTokenSymbol?: string;
    expectedAmountOutRaw?: string;
    minimumAmountOutRaw?: string;
    tokenId?: string;
    tokenStandard?: TokenStandard;
    tokenDecimals?: number;
    tokenVerificationStatus?: TokenVerificationState;
    networkId?: string;
    normalizedTokenAddress?: string;
    status: StepStatus;
    txHash?: string;
    blockNumber?: number;
    error?: string;
    readonly dependencies: string[];
    readonly retryPolicy: ExecutionStepRetryPolicy;
    readonly verificationCondition?: ExecutionStepVerificationCondition;
}
export interface ExecutionPlanDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly severity: 'INFO' | 'WARNING' | 'ERROR';
    readonly providerId?: string;
    readonly timestamp: number;
}
export interface ExecutionPlan {
    readonly planId: string;
    readonly routeId: string;
    readonly routeType: 'DIRECT' | 'MULTI_HOP' | 'CROSS_CHAIN_DIRECT' | 'CROSS_CHAIN_COMPOSITE';
    readonly sourceChainId: string;
    readonly destinationChainId: string;
    readonly tokenIn: Token;
    readonly tokenOut: Token;
    readonly expectedAmountInRaw: string;
    readonly expectedAmountOutRaw: string;
    readonly minimumAmountOutRaw: string;
    readonly isExecutable: boolean;
    readonly unexecutableReason?: string;
    readonly compositeExecutionMode?: CompositeExecutionMode;
    readonly diagnostics: ExecutionPlanDiagnostic[];
    readonly steps: ExecutionPlanStep[];
    currentStepIndex: number;
    overallStatus: 'IDLE' | 'EXECUTING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
    readonly selectedProvider?: string;
    readonly selectedDex?: string;
    readonly calldata?: string;
    readonly approvalTarget?: string;
    readonly executionTarget?: string;
    readonly expiration?: number;
    readonly capabilityEvidence?: string | ProviderCapabilityLevel;
    readonly totalFeeRaw?: string;
    readonly integrityHash?: string;
    readonly planHash?: string;
    createdAt: number;
    updatedAt: number;
}
export type PlanIntegrityStatus = 'UNSEALED' | 'SEALED_VALID' | 'TAMPERED' | 'EXPIRED';
export interface LifecycleVerificationEvidence {
    planId: string;
    verifiedAt: number;
    integrityHash: string;
    status: PlanIntegrityStatus;
    tamperedFields?: string[];
}
export type BridgeCapabilityState = 'CONFIGURED' | 'QUOTE_SUPPORTED' | 'EXECUTION_SUPPORTED' | 'DESTINATION_SETTLEMENT_SUPPORTED';
export interface ProviderCapabilityMatrixRecord {
    provider: BridgeProtocol;
    providerName: string;
    sourceChainId: string;
    destinationChainId: string;
    supportedTokenSymbols: string[];
    quoteEndpoint: string | null;
    executionContract: string | null;
    executionMethod: string | null;
    destinationExecutionCapability: boolean;
    statusEndpoint: string | null;
    capabilityState: BridgeCapabilityState;
}
export interface PersistentIntent {
    intentId: string;
    userAddress: string;
    sourceChainId: string;
    destinationChainId: string;
    sourceTokenAddress: string;
    sourceTokenSymbol: string;
    destinationTokenAddress: string;
    destinationTokenSymbol: string;
    amountInRaw: string;
    expectedAmountOutRaw: string;
    minAmountOutRaw: string;
    provider: string;
    routeId: string;
    nonce: string;
    deadline: number;
    status: SettlementState;
    sourceTxHash?: string;
    destinationTxHash?: string;
    solverId?: string;
    leaseOwner?: string;
    leaseExpiresAt?: number;
    errorMessage?: string;
    createdAt: number;
    updatedAt: number;
}
export interface PersistentExecutionStep {
    stepId: string;
    intentId: string;
    stepIndex: number;
    type: string;
    chainId: string;
    status: string;
    dependsOn: string[];
    targetAddress?: string;
    tokenAddress?: string;
    amountRaw?: string;
    txHash?: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
}
export interface PersistentProviderOrder {
    orderId: string;
    intentId: string;
    provider: string;
    sourceChainId: string;
    destinationChainId: string;
    sourceTxHash: string;
    destinationTxHash?: string;
    recipient: string;
    quoteJson: string;
    status: SettlementState;
    errorMessage?: string;
    createdAt: number;
    updatedAt: number;
}
export interface PersistentSettlement {
    intentId: string;
    destinationTxHash: string;
    destinationChainId: string;
    tokenAddress: string;
    tokenSymbol: string;
    recipient: string;
    expectedAmountRaw: string;
    actualAmountRaw: string;
    verified: boolean;
    verifiedAt: number;
}
export interface DestinationExecutionCapabilities {
    supportedChains: string[];
    supportedProtocols: DEXProtocol[];
    supportedModes: ('ATOMIC' | 'SOLVER' | 'SEPARATE_DESTINATION_TX')[];
    maxSlippageBps: number;
}
export interface DestinationExecutionRequest {
    intentId: string;
    sourceChainId: string;
    destinationChainId: string;
    recipient: string;
    inputToken: Token;
    inputAmountActual: string;
    outputToken: Token;
    minimumOutputAmount: string;
    destinationDex?: DEXProtocol;
    slippageTolerancePercent?: number;
    deadline: number;
    bridgeProvider: string;
    providerOrderId: string;
    routeId?: string;
    solverId?: string;
}
export interface DestinationExecutionPlan {
    executionId: string;
    intentId: string;
    mode: 'ATOMIC' | 'SOLVER' | 'SEPARATE_DESTINATION_TX' | 'UNSUPPORTED';
    destinationChainId: string;
    targetAddress: string;
    calldata: string;
    valueWei: string;
    tokenIn: Token;
    tokenOut: Token;
    amountIn: bigint;
    expectedAmountOut: bigint;
    minimumAmountOut: bigint;
    approvalTarget?: string;
    requiredAllowance?: bigint;
    gasEstimateUnits: bigint;
    gasCostUSD: number;
    deadline: number;
    dexQuote?: DEXQuote;
    solverAddress?: string;
}
export interface DestinationExecutionResult {
    executionId: string;
    intentId: string;
    destinationTxHash?: string;
    status: 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
    gasUsed?: bigint;
    effectiveGasPrice?: bigint;
    error?: string;
}
export interface DestinationExecutionStatus {
    executionId: string;
    intentId: string;
    destinationTxHash?: string;
    status: SettlementState;
    blockNumber?: number;
    confirmations?: number;
    error?: string;
}
export interface DestinationVerification {
    isVerified: boolean;
    destinationTxHash?: string;
    recipient: string;
    expectedToken: string;
    actualToken?: string;
    expectedMinAmount: bigint;
    actualAmount?: bigint;
    receipt?: any;
    reason?: string;
}
export interface SolverProfile {
    id: string;
    name: string;
    walletAddress: string;
    supportedChains: string[];
    supportedTokens: string[];
    availableLiquidityUSD: number;
    reputationScore: number;
    isActive: boolean;
}
export type TransactionLifecycleState = 'CREATED' | 'PREFLIGHTING' | 'PREFLIGHT_PASSED' | 'READY_TO_BROADCAST' | 'BROADCASTING' | 'BROADCAST_UNCERTAIN' | 'BROADCAST_CONFIRMED' | 'CONFIRMING' | 'CONFIRMED' | 'PREFLIGHT_FAILED' | 'BROADCAST_FAILED' | 'REVERTED' | 'DROPPED' | 'EXPIRED' | 'RECOVERY_REQUIRED';
export interface PersistentTransaction {
    transactionId: string;
    planId: string;
    stepId: string;
    chainId: string;
    nonce?: number;
    fromAddress: string;
    toAddress: string;
    valueWei: string;
    calldata: string;
    gasLimit?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    state: TransactionLifecycleState;
    txHash?: string;
    createdAt: number;
    broadcastAt?: number;
    confirmedAt?: number;
    blockNumber?: number;
    receiptStatus?: number;
    errorMessage?: string;
}
export interface WorkerLease {
    resourceId: string;
    workerId: string;
    acquiredAt: number;
    expiresAt: number;
    renewedAt: number;
}
export interface PersistentPlanRecord {
    planId: string;
    routeId: string;
    routeType: string;
    sourceChainId: string;
    destinationChainId: string;
    tokenIn: Token;
    tokenOut: Token;
    expectedAmountInRaw: string;
    expectedAmountOutRaw: string;
    minimumAmountOutRaw: string;
    isExecutable: boolean;
    unexecutableReason?: string;
    compositeExecutionMode?: string;
    diagnostics: ExecutionPlanDiagnostic[];
    currentStepIndex: number;
    overallStatus: string;
    createdAt: number;
    updatedAt: number;
}
export interface PersistentPlanStepRecord {
    planStepId: string;
    planId: string;
    stepId: string;
    stepIndex: number;
    type: ExecutionStepType;
    title: string;
    description: string;
    chainId: string;
    numericChainId?: number;
    executionEnvironment: StepExecutionEnvironment;
    targetAddress?: string;
    calldata?: string;
    valueWei?: string;
    approvalTarget?: string;
    requiredTokenAddress?: string;
    requiredTokenSymbol?: string;
    requiredAmountRaw?: string;
    status: StepStatus;
    txHash?: string;
    blockNumber?: number;
    error?: string;
    dependencies: string[];
    retryPolicy: ExecutionStepRetryPolicy;
    verificationCondition?: ExecutionStepVerificationCondition;
    createdAt: number;
    updatedAt: number;
}
export type ProviderHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'CIRCUIT_OPEN' | 'RECOVERING';
export type RpcCircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type RequestCategory = 'READ_ONLY' | 'PRE_BROADCAST' | 'BROADCAST';
export type ErrorCategory = 'RETRYABLE' | 'NON_RETRYABLE' | 'AMBIGUOUS';
export interface ProviderEndpointConfig {
    id: string;
    chainId: string;
    numericChainId: number;
    url: string;
    priority: number;
    weight?: number;
    supportsSimulation?: boolean;
    isPrivate?: boolean;
}
export interface ProviderEndpointHealth {
    id: string;
    chainId: string;
    numericChainId: number;
    url: string;
    priority: number;
    weight: number;
    status: ProviderHealthStatus;
    circuitState: RpcCircuitBreakerState;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    lastFailureTimestamp: number | null;
    lastSuccessTimestamp: number | null;
    latencyMs: number;
    timeoutCount: number;
    errorCount: number;
    lastCheckedBlockNumber: number | null;
    lastCheckedAt: number | null;
}
export type EvidenceSourceType = 'ON_CHAIN_RECEIPT' | 'TRANSACTION_LOOKUP' | 'PROVIDER_API' | 'INFORMATIONAL_API' | 'LOCAL_CACHE';
export interface ReconciliationEvidence {
    evidenceId: string;
    source: EvidenceSourceType;
    priority: number;
    timestamp: number;
    providerId?: string;
    chainId?: string;
    txHash?: string;
    blockNumber?: number;
    status?: string;
    data?: any;
}
export type ReconciliationStatus = 'SETTLED' | 'DESTINATION_FILLED' | 'FULFILLING' | 'STATUS_UNKNOWN' | 'DESTINATION_STATUS_UNCERTAIN' | 'STATUS_CONFLICT' | 'RECOVERY_REQUIRED' | 'FAILED' | 'REFUNDED';
export interface ReconciliationResult {
    entityId: string;
    entityType: 'INTENT' | 'PLAN' | 'STEP' | 'ORDER' | 'TRANSACTION';
    status: ReconciliationStatus;
    previousStatus: string;
    sourceTxHash?: string;
    destinationTxHash?: string;
    evidences: ReconciliationEvidence[];
    conflict?: {
        reason: string;
        conflictingEvidences: ReconciliationEvidence[];
    };
    actionTaken: string;
    timestamp: number;
}
export interface TelemetryEvent {
    eventId: string;
    providerId: string;
    chainId: string;
    operation: string;
    category: RequestCategory;
    latencyMs: number;
    success: boolean;
    errorCategory?: ErrorCategory;
    circuitState?: RpcCircuitBreakerState;
    retryCount: number;
    failoverCount: number;
    blockNumber?: number;
    timestamp: number;
    metadata?: Record<string, any>;
}
export type ProviderCapabilityLevel = 'UNIT_TESTED' | 'CONFIGURED' | 'QUOTE_AVAILABLE' | 'EXECUTION_AVAILABLE' | 'LIVE_VERIFIED' | 'UNSUPPORTED';
export type CapabilityLevel = ProviderCapabilityLevel;
export type ProviderErrorCategory = 'UNSUPPORTED_ROUTE' | 'PROVIDER_UNAVAILABLE' | 'RATE_LIMITED' | 'INVALID_QUOTE' | 'EXPIRED_QUOTE' | 'MISSING_EXECUTION_DATA' | 'INVALID_CALLDATA' | 'INVALID_TARGET' | 'INVALID_TOKEN' | 'INVALID_CHAIN' | 'INSUFFICIENT_LIQUIDITY' | 'DESTINATION_UNAVAILABLE' | 'TRACKING_UNAVAILABLE' | 'STATUS_UNKNOWN' | 'STATUS_CONFLICT' | 'EXECUTION_UNAVAILABLE';
export type CrossChainQuoteErrorCode = ProviderErrorCategory | 'QUOTE_EXPIRED' | 'API_AUTH_REQUIRED' | 'UNSUPPORTED_TOKEN' | 'INVALID_AMOUNT' | 'MALFORMED_RESPONSE' | 'INVALID_EXECUTION_DATA' | 'UNKNOWN_PROVIDER_ERROR' | 'DESTINATION_EXECUTION_UNAVAILABLE' | 'SOURCE_SWAP_UNAVAILABLE' | 'QUOTE_UNAVAILABLE';
export type CrossChainCapabilityStatus = 'UNIT_TESTED' | 'CONFIGURED' | 'QUOTE_AVAILABLE' | 'EXECUTION_AVAILABLE' | 'TRACKING_AVAILABLE' | 'LIVE_VERIFIED' | 'UNSUPPORTED';
export interface ProviderCapabilityRecord {
    provider: BridgeProtocol;
    providerName: string;
    sourceChainId: string;
    destinationChainId: string;
    sourceTokenSymbol: string;
    destinationTokenSymbol: string;
    quoteSupported: boolean;
    executionSupported: boolean;
    trackingSupported: boolean;
    destinationExecutionSupported: boolean;
    capabilityStatus: CrossChainCapabilityStatus;
    capabilityLevel?: ProviderCapabilityLevel;
    requiredApiConfig?: string;
    unsupportedReason?: string;
}
export interface NormalizedBridgeQuote {
    provider: BridgeProtocol;
    sourceChainId: string;
    destinationChainId: string;
    sourceToken: Token;
    destinationToken: Token;
    inputAmountRaw: string;
    expectedOutputRaw: string;
    minimumOutputRaw: string;
    feeAmountRaw: string;
    feeToken: Token | string;
    expiration: number;
    approvalTarget: string;
    executionTarget: string;
    calldata: string;
    value: string;
    orderId?: string;
    statusEndpoint?: string;
    isExecutable: boolean;
    capabilityLevel: ProviderCapabilityLevel;
    unexecutableReason?: string;
}
export type UniversalValidationGate = 'ROUTE_SUPPORTED' | 'LIVE_QUOTE_VERIFIED' | 'VALID_SOURCE_TOKEN' | 'VALID_DESTINATION_TOKEN' | 'VALID_CHAIN_IDS' | 'VALID_INPUT_AMOUNT' | 'VALID_EXPECTED_OUTPUT' | 'VALID_MINIMUM_OUTPUT' | 'VALID_EXECUTION_TARGET' | 'VALID_CALLDATA' | 'VALID_APPROVAL_TARGET' | 'VALID_EXPIRATION' | 'VALID_RECEIVER' | 'VALID_TRANSACTION_VALUE' | 'CAPABILITY_PERMITS_EXECUTION';
export interface UniversalValidationResult {
    isExecutable: boolean;
    status: 'EXECUTABLE' | 'NON_EXECUTABLE';
    unexecutableReason?: string;
    errorCategory?: ProviderErrorCategory;
    failedGates: UniversalValidationGate[];
    passedGates: UniversalValidationGate[];
    diagnostics: ExecutionPlanDiagnostic[];
}
export interface QuoteProviderDiagnostic {
    provider: BridgeProtocol;
    providerName?: string;
    sourceChainId: string | number;
    destinationChainId: string | number;
    sourceToken: string;
    destinationToken: string;
    amountInRaw: string;
    requestStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED';
    httpStatus?: number;
    providerErrorCode?: string;
    providerErrorMessage?: string;
    normalizedError?: CrossChainQuoteErrorCode;
    isExecutable: boolean;
    unexecutableReason?: string;
    latencyMs?: number;
    endpoint?: string;
    timestamp: number;
}
export interface AggregateQuoteErrorResult {
    code: 'NO_VALID_CROSS_CHAIN_ROUTE';
    message: string;
    sourceChainId: string;
    destinationChainId: string;
    tokenIn: Token;
    tokenOut: Token;
    amountInRaw: string;
    providerDiagnostics: Record<string, QuoteProviderDiagnostic>;
    timestamp: number;
}
export interface NormalizedCrossChainQuote extends CrossChainQuote {
    routeId: string;
    amountInRaw: string;
    amountOutRaw: string;
    minimumAmountOutRaw: string;
    feeAmountRaw?: string;
    estimatedGas?: bigint;
    bridgeId?: string;
    orderId?: string;
    expiresAt: number;
    providerMetadata?: Record<string, any>;
}
export type ZenithExecutionMode = 'READ_ONLY' | 'PREFLIGHT_ONLY' | 'LIVE_TESTNET';
export interface OperatorAuditRecord {
    auditId: string;
    timestamp: number;
    mode: ZenithExecutionMode;
    planId: string;
    stepId: string;
    action: string;
    operatorConfirmationState: string;
    quoteIdentifiers: Record<string, string>;
    transactionHashes: Record<string, string | null | undefined>;
    receiptStates: Record<string, string | number | null | undefined>;
    actualAmounts: Record<string, string>;
    failureStates?: string;
}
export interface GoldenPathExecutionMetrics {
    sourceSwapDurationMs?: number;
    sourceOutputExtractionDurationMs?: number;
    bridgeQuoteDurationMs?: number;
    bridgeDepositDurationMs?: number;
    bridgeFillDurationMs?: number;
    destinationVerificationDurationMs?: number;
    totalExecutionDurationMs?: number;
    sourceGasUsed?: string;
    bridgeFee?: string;
    sourceInputAmount?: string;
    actualSourceOutput?: string;
    bridgeExpectedOutput?: string;
    actualDestinationOutput?: string;
    startedAt?: number;
    completedAt?: number;
}
export type NormalizedRouteType = 'SAME_CHAIN' | 'DIRECT_CROSS_CHAIN' | 'COMPOSITE_CROSS_CHAIN';
export type RouteFreshnessState = 'FRESH' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN';
export interface NormalizedRoute {
    routeId: string;
    sourceChainId: string;
    destinationChainId: string;
    sourceToken: Token;
    destinationToken: Token;
    inputAmountRaw: string;
    expectedOutputRaw: string;
    minimumOutputRaw: string;
    totalFeeRaw: string;
    feeToken: Token | string;
    estimatedGasRaw: string;
    estimatedGasCostRaw: string;
    bridgeProvider?: BridgeProtocol | string;
    sourceDex?: string;
    destinationDex?: string;
    quotedAt: number;
    expiresAt: number;
    capabilityLevel: ProviderCapabilityLevel;
    isExecutable: boolean;
    routeType: NormalizedRouteType;
    unexecutableReason?: string;
    diagnostics?: any[];
    calldata?: string;
    executionTarget?: string;
    approvalTarget?: string;
    valueWei?: string;
    providerHealth?: ProviderHealthStatus;
    freshnessState?: RouteFreshnessState;
    normalizedCostUSD?: string;
}
export interface CostNormalizationResult {
    sourceSwapFeeRaw: string;
    bridgeFeeRaw: string;
    destSwapFeeRaw: string;
    gasCostRaw: string;
    protocolFeeRaw: string;
    totalCostRaw: string;
    commonFeeToken: Token | string;
    normalizedCostUSD?: string;
    priceSource?: string;
    priceTimestamp?: number;
    isAvailable: boolean;
    unavailableReason?: 'ROUTE_COST_UNAVAILABLE' | string;
}
export interface RouteArbitrationCandidate {
    route: NormalizedRoute;
    score: bigint;
    rank: number;
    rejectionReason?: string;
    costNormalization?: CostNormalizationResult;
    passedGates: string[];
    failedGates: string[];
}
export interface RouteArbitrationResult {
    selectedRoute: NormalizedRoute | null;
    executableCandidates: NormalizedRoute[];
    rejectedCandidates: Array<{
        route: NormalizedRoute;
        reason: string;
    }>;
    selectionMetrics: {
        totalEvaluated: number;
        totalExecutable: number;
        arbitrationDurationMs: number;
        tieBrokenByRouteId: boolean;
    };
}
export type SecurityAuthorizationState = 'UNAUTHORIZED' | 'VALIDATED' | 'AUTHORIZED' | 'PREFLIGHT_VERIFIED' | 'SIGNING_AUTHORIZED' | 'BROADCAST_AUTHORIZED' | 'BROADCASTED' | 'CONFIRMED' | 'SETTLED' | 'REJECTED';
export type AuthorizationBoundary = 'ROUTE_SELECTION' | 'EXECUTION_PLAN' | 'SIGNING_AUTHORIZATION' | 'TRANSACTION_CONSTRUCTION' | 'PRE_FLIGHT' | 'BROADCAST';
export interface AuthorizationContext {
    planId: string;
    routeId: string;
    sourceChainId: string;
    destinationChainId: string;
    tokenInAddress: string;
    tokenOutAddress: string;
    expectedAmountInRaw: string;
    minimumAmountOutRaw: string;
    recipientAddress: string;
    executionTarget: string;
    approvalTarget: string;
    calldata: string;
    transactionValue: string;
    executionMode: 'READ_ONLY' | 'PREFLIGHT_ONLY' | 'LIVE_EXECUTION' | 'LIVE_ONCHAIN';
    provider: string;
    nonce?: number;
    expiration: number;
    planHash?: string;
}
export interface SecurityBoundaryCheckResult {
    passed: boolean;
    boundary: AuthorizationBoundary;
    state: SecurityAuthorizationState;
    planId?: string;
    reason?: string;
    tamperedField?: string;
    timestamp: number;
}
export interface CanonicalTransactionPayload {
    chainId: number | string;
    to: string;
    data: string;
    value: bigint | string;
    from?: string;
    nonce?: number;
    gasLimit?: bigint | string;
    maxFeePerGas?: bigint | string;
    maxPriorityFeePerGas?: bigint | string;
    gasPrice?: bigint | string;
    type?: number;
}
export interface TransactionExecutionSemantics {
    functionSelector: string;
    functionName: string;
    decodedArguments: Record<string, any>;
    tokenAddresses: string[];
    amounts: bigint[];
    recipient?: string;
    receiver?: string;
    approvalTarget?: string;
    deadline?: number;
    routeId?: string;
    planId?: string;
    stepId?: string;
}
export type SemanticFieldClassificationType = 'AUTHORIZATION_CRITICAL' | 'EXECUTION_CRITICAL' | 'DERIVED' | 'INFORMATIONAL' | 'EXTERNALLY_SUPPLIED';
export const SEMANTIC_FIELD_CLASSIFICATIONS: Record<string, SemanticFieldClassificationType> = {
    chainId: 'AUTHORIZATION_CRITICAL',
    to: 'AUTHORIZATION_CRITICAL',
    data: 'AUTHORIZATION_CRITICAL',
    value: 'AUTHORIZATION_CRITICAL',
    recipient: 'AUTHORIZATION_CRITICAL',
    receiver: 'AUTHORIZATION_CRITICAL',
    approvalTarget: 'AUTHORIZATION_CRITICAL',
    tokenAddresses: 'AUTHORIZATION_CRITICAL',
    amounts: 'AUTHORIZATION_CRITICAL',
    nonce: 'EXECUTION_CRITICAL',
    gasLimit: 'EXECUTION_CRITICAL',
    maxFeePerGas: 'EXECUTION_CRITICAL',
    maxPriorityFeePerGas: 'EXECUTION_CRITICAL',
    deadline: 'EXECUTION_CRITICAL',
    functionSelector: 'DERIVED',
    functionName: 'DERIVED',
    decodedArguments: 'DERIVED',
    routeId: 'INFORMATIONAL',
    planId: 'INFORMATIONAL',
    stepId: 'INFORMATIONAL',
    type: 'INFORMATIONAL',
    gasPrice: 'EXTERNALLY_SUPPLIED'
};
export interface SemanticEquivalenceCheckResult {
    isEquivalent: boolean;
    stage: string;
    discrepancies: string[];
    details?: Record<string, any>;
}
export interface EconomicBoundaryCheckResult {
    isSafe: boolean;
    violatedField?: string;
    reason?: string;
    details?: Record<string, any>;
}
export interface EconomicParametersInventory {
    amountIn: string;
    amountOut: string;
    minimumAmountOut: string;
    expectedAmountOut: string;
    actualAmountOut?: string;
    slippage: number;
    priceImpact?: number;
    bridgeFee?: string;
    protocolFee?: string;
    gasCost?: string;
    solverFee?: string;
    destinationFee?: string;
    relayerFee?: string;
    nativeGasReserve?: string;
    approvalAmount?: string;
    exchangeRate?: string;
    tokenDecimals: {
        in: number;
        out: number;
    };
    quoteExpiration?: number;
    quoteTimestamp?: number;
    routeCost?: string;
    guaranteedOutput: string;
    estimatedOutput: string;
}
export interface SlippagePolicyConfig {
    defaultBps: number;
    maxAllowedBps: number;
    strictZeroAllowed: boolean;
}
export interface GasEconomicParams {
    gasLimit: bigint;
    gasPrice?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    nativeBalance: bigint;
    nativeValueWei: bigint;
    reserveBufferWei?: bigint;
}
export interface EconomicTelemetryRecord {
    planId: string;
    routeId: string;
    stepId?: string;
    inputAmount: string;
    expectedOutput: string;
    minimumOutput: string;
    actualOutput?: string;
    feeCategory: string;
    totalFeeRaw: string;
    quoteAgeMs: number;
    provider: string;
    sourceChainId: string | number;
    destinationChainId: string | number;
    tokenInAddress: string;
    tokenOutAddress: string;
    timestamp: number;
    status: 'SAFE' | 'VIOLATION' | 'REJECTED';
    violationReason?: string;
}
export interface SettlementTelemetryRecord {
    planId: string;
    intentId: string;
    stepId?: string;
    sourceChainId: string | number;
    destinationChainId: string | number;
    destinationTxHash: string;
    destinationBlockHash?: string;
    destinationBlockNumber?: number;
    confirmations?: number;
    requiredConfirmations?: number;
    expectedRecipient: string;
    actualRecipient?: string;
    expectedToken: string;
    actualToken?: string;
    expectedMinAmount: string;
    actualDeliveredAmount?: string;
    primaryEvidenceTier: string;
    evidenceSource: string;
    verificationResult: 'SETTLED' | 'PENDING' | 'CONFLICT' | 'FAILED' | 'REORG_DETECTED';
    reorgDetected?: boolean;
    conflictReason?: string;
    timestamp: number;
}
export type NetworkCapabilityLevel = 'UNSUPPORTED' | 'UNIT_TESTED' | 'CONFIGURED' | 'QUOTE_AVAILABLE' | 'EXECUTION_AVAILABLE' | 'LIVE_VERIFIED';
export type NetworkOnboardingState = 'DISCOVERED' | 'CONFIGURED' | 'UNIT_TESTED' | 'QUOTE_ENABLED' | 'EXECUTION_ENABLED' | 'LIVE_VERIFIED' | 'DEPRECATED' | 'DISABLED';
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
export type NetworkEnvironment = 'MAINNET' | 'TESTNET' | 'DEVNET' | 'LOCAL' | 'HISTORICAL' | 'UNKNOWN';
export type MetadataCompletenessStatus = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'INVALID';
export interface AuthoritativeNativeAsset {
    assetId: string;
    symbol: string;
    name: string;
    decimals: number;
    networkId: string;
    family: NetworkFamily;
    assetType: 'NATIVE' | 'WRAPPED_NATIVE' | 'GAS_ONLY';
    isGasAsset: boolean;
    isWrappedEquivalent: boolean;
    wrappedAddress?: string;
    status: 'ACTIVE' | 'DEPRECATED' | 'UNKNOWN';
}
export interface AuthoritativeGasModelConfig {
    modelType: NetworkGasModelType;
    feeMechanism: string;
    gasUnit: string;
    feeAssetSymbol: string;
    baseFeeBehavior: 'DYNAMIC_BASE_FEE' | 'FIXED' | 'AUCTION' | 'NONE';
    priorityFeeBehavior: 'TIP' | 'COMPUTE_UNIT_PRICE' | 'NONE';
    l2FeeComponents?: {
        l1DataFee: boolean;
        compressionAware: boolean;
        calldataPosterDiscount: boolean;
    };
    feeEstimationCapability: boolean;
    supportedExecutionAdapter: string;
}
export interface AuthoritativeFinalityConfig {
    model: NetworkFinalityModel;
    confirmationModel: 'PROBABILISTIC' | 'DETERMINISTIC_BFT' | 'SEQUENCER_SOFT' | 'ZK_PROVED' | 'UNKNOWN';
    isDeterministic: boolean;
    reorgModel: 'POSSIBLE' | 'IMPOSSIBLE_POST_FINALITY' | 'HARD_FORK_ONLY' | 'UNKNOWN';
    canonicalityVerification: 'ON_CHAIN_CONSENSUS' | 'L1_ROLLUP_VERIFICATION' | 'ORACLE_ATTESTATION' | 'UNKNOWN';
    finalityDepthBlocks?: number;
    runtimeFinalitySource: string;
    status: 'KNOWN' | 'RUNTIME_REQUIRED' | 'UNKNOWN' | 'UNSUPPORTED';
}
export interface AuthoritativeRpcMetadata {
    networkId: string;
    providerId: string;
    endpointClass: 'PUBLIC' | 'PRIVATE' | 'FALLBACK' | 'ARCHIVE';
    url: string;
    readCapability: boolean;
    preflightCapability: boolean;
    broadcastCapability: boolean;
    websocketCapability: boolean;
    healthState: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
    expectedFamily: NetworkFamily;
    expectedChainId: string | number;
    environment: NetworkEnvironment;
    priority: number;
    weight?: number;
}
export interface AuthoritativeExplorerMetadata {
    explorerId: string;
    explorerName: string;
    baseUrl: string;
    txUrlTemplate: string;
    addressUrlTemplate: string;
    blockUrlTemplate: string;
    networkId: string;
    environment: NetworkEnvironment;
    status: 'ACTIVE' | 'DEPRECATED' | 'UNKNOWN';
}
export interface AuthoritativeNetworkIdentity {
    networkId: string;
    canonicalName: string;
    displayName: string;
    family: NetworkFamily;
    environment: NetworkEnvironment;
    chainId: string | number;
    numericChainId?: number;
    namespace: string;
    networkIdentityKey: string;
    nativeAsset: AuthoritativeNativeAsset;
    nativeDecimals: number;
    nativeSymbol: string;
    isMainnet: boolean;
    isTestnet: boolean;
    gasModel: AuthoritativeGasModelConfig;
    finality: AuthoritativeFinalityConfig;
    rpcEndpoints: AuthoritativeRpcMetadata[];
    explorer: AuthoritativeExplorerMetadata;
    status: NetworkOperationalStatus;
    aliases: string[];
    capabilityLevel: NetworkCapabilityLevel;
    onboardingState: NetworkOnboardingState;
    dexRegistryReferences?: string[];
    bridgeRegistryReferences?: string[];
    tokenRegistryReferences?: string[];
    executionAdapterReference: string;
    completenessStatus: MetadataCompletenessStatus;
    iconURI?: string;
    color?: string;
    notes?: string;
}
export type RpcEndpointClass = 'PUBLIC' | 'PRIVATE' | 'MANAGED' | 'CUSTOM' | 'UNKNOWN';
export type RpcTransportType = 'HTTP' | 'HTTPS' | 'WS' | 'WSS' | 'IPC' | 'CUSTOM';
export type RpcCapabilityType = 'READ_ONLY' | 'PREFLIGHT' | 'BROADCAST';
export type RpcVerificationStatus = 'DISCOVERED' | 'CONFIGURED' | 'IDENTITY_VERIFIED' | 'HEALTH_CHECKED' | 'AVAILABLE' | 'DISABLED' | 'DEPRECATED';
export type RpcDisagreementLevel = 'AGREEMENT' | 'EXPECTED_VARIANCE' | 'MATERIAL_DISAGREEMENT' | 'IDENTITY_CONFLICT' | 'UNAVAILABLE';
export type RpcErrorType = 'TIMEOUT' | 'RATE_LIMITED' | 'CONNECTION_ERROR' | 'SERVER_ERROR' | 'INVALID_RESPONSE' | 'CHAIN_ID_MISMATCH' | 'STALE_HEAD' | 'CIRCUIT_OPEN' | 'UNAVAILABLE' | 'AUTHENTICATION_REQUIRED' | 'METHOD_UNSUPPORTED' | 'UNKNOWN';
export interface RateLimitPolicy {
    maxRequestsPerSec: number;
    burstCapacity: number;
}
export interface RetryPolicy {
    maxRetries: number;
    backoffBaseMs: number;
    maxBackoffMs: number;
}
export interface ExpectedChainIdentity {
    family: NetworkFamily;
    namespace: string;
    chainId: string | number;
    numericChainId?: number;
}
export interface RpcProviderProfile {
    providerId: string;
    providerName: string;
    networkId: string;
    family: NetworkFamily;
    namespace: string;
    environment: NetworkEnvironment;
    endpointClass: RpcEndpointClass;
    endpoint: string;
    transport: RpcTransportType;
    readCapability: boolean;
    preflightCapability: boolean;
    broadcastCapability: boolean;
    websocketCapability: boolean;
    priority: number;
    timeoutMs: number;
    healthState: ProviderHealthStatus;
    expectedChainIdentity: ExpectedChainIdentity;
    verificationStatus: RpcVerificationStatus;
    rateLimitPolicy: RateLimitPolicy;
    retryPolicy: RetryPolicy;
    lastVerifiedAt: number | null;
}
export interface RpcDisagreementEvaluation {
    level: RpcDisagreementLevel;
    method: string;
    parameterSummary?: string;
    primaryProviderId: string;
    secondaryProviderId: string;
    primaryValue: any;
    secondaryValue: any;
    stateContextUncertain?: boolean;
    reason: string;
    timestamp: number;
}
export interface RpcMetricsSnapshot {
    providerRequestCount: Record<string, number>;
    providerSuccessCount: Record<string, number>;
    providerFailureCount: Record<string, number>;
    providerTimeoutCount: Record<string, number>;
    providerRateLimitCount: Record<string, number>;
    providerSwitchCount: Record<string, number>;
    providerIdentityMismatchCount: Record<string, number>;
    providerDisagreementCount: Record<string, number>;
    providerCircuitOpenCount: Record<string, number>;
    providerCircuitRecoveryCount: Record<string, number>;
    providerLatency: Record<string, number>;
    providerStaleHeadCount: Record<string, number>;
    readFailoverCount: number;
    preflightFailoverCount: number;
    broadcastUncertainCount: number;
}
export type TokenStandard = 'ERC20' | 'ERC721' | 'ERC1155' | 'NATIVE' | 'WRAPPED_NATIVE' | 'SPL' | 'TOKEN_2022' | 'MOVE_ASSET' | 'CW20' | 'IBC_ASSET' | 'UTXO_ASSET' | 'JETTON' | 'SUBSTRATE_ASSET' | 'ISSUED_ASSET' | 'STELLAR_ASSET' | 'ICP_TOKEN' | 'UNSUPPORTED';
export type TokenAssetType = 'NATIVE' | 'WRAPPED_NATIVE' | 'FUNGIBLE_TOKEN' | 'NON_FUNGIBLE_TOKEN' | 'MULTI_TOKEN' | 'UTXO_ASSET';
export type TokenVerificationState = 'IDENTITY_VERIFIED' | 'ADDRESS_VERIFIED' | 'STANDARD_VERIFIED' | 'DECIMALS_VERIFIED' | 'METADATA_VERIFIED' | 'CONTRACT_CODE_VERIFIED' | 'NETWORK_VERIFIED' | 'UNVERIFIED' | 'FAILED_VERIFICATION';
export interface TokenVerificationDimensions {
    identityVerified: boolean;
    addressVerified: boolean;
    standardVerified: boolean;
    decimalsVerified: boolean;
    metadataVerified: boolean;
    contractCodeVerified: boolean;
    networkVerified: boolean;
}
export type TokenMetadataStatus = 'UNKNOWN' | 'DISCOVERED' | 'READ_FROM_CHAIN' | 'REGISTRY_VERIFIED' | 'LIVE_VERIFIED' | 'INVALID';
export type TokenOnboardingState = 'DISCOVERED' | 'IDENTITY_RESOLVED' | 'ADDRESS_VERIFIED' | 'STANDARD_VERIFIED' | 'METADATA_VERIFIED' | 'EXECUTION_ENABLED' | 'LIVE_VERIFIED' | 'DISABLED' | 'DEPRECATED';
export interface TokenMetadata {
    symbol: string;
    name: string;
    decimals: number;
    logoUri?: string;
    metadataSource: string;
    metadataStatus: TokenMetadataStatus;
    verifiedAt?: number;
}
export interface NativeAssetIdentity {
    networkId: string;
    assetId: string;
    symbol: string;
    name: string;
    decimals: number;
    gasAsset: boolean;
    verificationStatus: TokenVerificationState;
}
export interface TokenIdentity {
    readonly tokenId: string;
    readonly networkId: string;
    readonly networkIdentityKey: string;
    readonly family: NetworkFamily;
    readonly namespace: string;
    readonly standard: TokenStandard;
    readonly address?: string;
    readonly normalizedAddress?: string;
    readonly symbol: string;
    readonly name: string;
    readonly decimals: number;
    readonly assetType: TokenAssetType;
    readonly isNative: boolean;
    readonly isWrappedNative: boolean;
    readonly wrappedAddress?: string;
    readonly verificationStatus: TokenVerificationState;
    readonly verificationDimensions: TokenVerificationDimensions;
    readonly metadataStatus: TokenMetadataStatus;
    readonly capabilityLevel: CapabilityLevel;
    readonly onboardingState: TokenOnboardingState;
    readonly source: 'CANONICAL_SEED' | 'CHAIN_READ' | 'USER_IMPORT' | 'DISCOVERY';
    readonly lastVerifiedAt?: number;
    readonly isFungible: boolean;
    readonly isNFT: boolean;
    readonly isMultiToken: boolean;
    readonly tags?: string[];
}
export interface TokenResolutionInput {
    networkId?: string;
    symbol?: string;
    address?: string;
    standard?: TokenStandard;
    identityKey?: string;
    tokenId?: string;
}
export type TokenResolutionStatus = 'RESOLVED_EXACT' | 'RESOLVED_AMBIGUOUS' | 'UNRESOLVED' | 'AMBIGUOUS_TOKEN_IDENTITY' | 'INVALID_INPUT';
export interface TokenResolutionResult {
    status: TokenResolutionStatus;
    token?: TokenIdentity;
    matches?: TokenIdentity[];
    error?: string;
}
export type TokenConflictCategory = 'AGREEMENT' | 'EXPECTED_VARIANCE' | 'MATERIAL_CONFLICT' | 'IDENTITY_CONFLICT' | 'UNKNOWN';
export type TokenConflictType = 'DECIMALS_CONFLICT' | 'NETWORK_CONFLICT' | 'STANDARD_CONFLICT' | 'SYMBOL_CONFLICT' | 'NAME_CONFLICT' | 'CONTRACT_CODE_CONFLICT' | 'NONE';
export interface TokenConflictEvaluation {
    category: TokenConflictCategory;
    conflictType: TokenConflictType;
    details: string;
    canProceed: boolean;
}
export type DexProtocolTaxonomy = 'UNISWAP_V2_STYLE' | 'UNISWAP_V3_STYLE' | 'CONSTANT_PRODUCT_AMM' | 'STABLE_SWAP_AMM' | 'CONCENTRATED_LIQUIDITY_AMM' | 'WEIGHTED_AMM' | 'HYBRID_AMM' | 'ORDER_BOOK' | 'AGGREGATOR' | 'CUSTOM_AMM' | 'UNKNOWN';
export type DexPoolDiscoveryMethod = 'FACTORY_LOOKUP' | 'QUOTER_ASSISTED' | 'DEPLOYMENT_REGISTRY' | 'SUBGRAPH_INDEXER' | 'DIRECT_POOL_READ' | 'UNSUPPORTED';
export type DexStatus = 'ACTIVE' | 'DEPRECATED' | 'DISABLED';
export type DexVerificationStatus = 'UNVERIFIED' | 'ADDRESS_EXISTS' | 'CONTRACT_PRESENT' | 'EXPECTED_INTERFACE' | 'VERIFIED_DEPLOYMENT';
export type DexOnboardingState = 'DISCOVERED' | 'CONFIGURED' | 'IDENTITY_VERIFIED' | 'POOL_DISCOVERY_VERIFIED' | 'QUOTE_VERIFIED' | 'EXECUTION_ENABLED' | 'LIVE_VERIFIED' | 'DISABLED' | 'DEPRECATED';
export type DexAddressRole = 'ROUTER' | 'FACTORY' | 'QUOTER' | 'POOL' | 'POSITION_MANAGER' | 'OTHER';
export interface DexIdentity {
    readonly dexId: string;
    readonly canonicalName: string;
    readonly displayName: string;
    readonly networkId: string;
    readonly networkIdentityKey: string;
    readonly family: NetworkFamily;
    readonly protocolFamily: DexProtocolTaxonomy;
    readonly version: string;
    readonly deploymentId: string;
    readonly routerAddress: string;
    readonly factoryAddress: string;
    readonly quoterAddress?: string;
    readonly poolDiscoveryMethod: DexPoolDiscoveryMethod;
    readonly swapMethods: string[];
    readonly supportedTokenStandards: TokenStandard[];
    readonly status: DexStatus;
    readonly verificationStatus: DexVerificationStatus;
    readonly capabilityLevel: CapabilityLevel;
    readonly onboardingState: DexOnboardingState;
    readonly feeTiersBps?: number[];
    readonly universalRouterAddress?: string;
    readonly positionManagerAddress?: string;
    readonly quoteTtlMs?: number;
    readonly identityKey?: string;
    readonly metadata?: Record<string, any>;
}
export type QuoteFreshnessState = 'FRESH' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN';
export interface AuthoritativeDexQuote {
    readonly dexId: string;
    readonly networkId: string;
    readonly tokenIn: Token | TokenIdentity;
    readonly tokenOut: Token | TokenIdentity;
    readonly amountIn: bigint;
    readonly expectedAmountOut: bigint;
    readonly minimumAmountOut: bigint;
    readonly priceImpact: number | null;
    readonly fee: bigint;
    readonly feeTierBps?: number;
    readonly gasEstimate: bigint;
    readonly route: string[];
    readonly poolPath: string[];
    readonly quoteTimestamp: number;
    readonly expiration: number;
    readonly providerId: string;
    readonly capabilityLevel: CapabilityLevel;
    readonly verificationStatus: DexVerificationStatus;
    readonly executable: boolean;
    readonly freshness?: QuoteFreshnessState;
    readonly calldata?: string;
    readonly executionTarget?: string;
    readonly approvalTarget?: string;
    readonly value?: string;
    readonly poolAddress?: string;
    readonly blockNumber?: number;
}
export interface DexSwapTransaction {
    readonly chainId: number | string;
    readonly networkIdentityKey: string;
    readonly dexId: string;
    readonly router: string;
    readonly tokenIn: string;
    readonly tokenOut: string;
    readonly amountIn: string;
    readonly amountOutMinimum: string;
    readonly recipient: string;
    readonly deadline: number;
    readonly value: string;
    readonly calldata: string;
    readonly gasLimit: string;
    readonly maxFeePerGas?: string;
    readonly maxPriorityFeePerGas?: string;
    readonly gasPrice?: string;
    readonly nonce?: number;
    readonly semanticHash: string;
    readonly planHash: string;
}
export interface DexCapabilities {
    readonly dexId: string;
    readonly capabilityLevel: CapabilityLevel;
    readonly supportsQuotes: boolean;
    readonly supportsExecution: boolean;
    readonly supportsExactInput: boolean;
    readonly supportsExactOutput: boolean;
    readonly supportsPoolDiscovery: boolean;
    readonly supportsSimulation: boolean;
    readonly supportsPriceImpact: boolean;
    readonly supportedTokenStandards: TokenStandard[];
}
export interface DexPairValidationResult {
    readonly isValid: boolean;
    readonly reason?: string;
    readonly tokenInStandard?: TokenStandard;
    readonly tokenOutStandard?: TokenStandard;
}
export interface DexPoolDiscoveryResult {
    readonly poolFound: boolean;
    readonly poolAddress?: string;
    readonly dexId: string;
    readonly networkId: string;
    readonly token0?: string;
    readonly token1?: string;
    readonly feeTierBps?: number;
    readonly discoverySource: DexPoolDiscoveryMethod;
    readonly poolState?: any;
    readonly verificationStatus: DexVerificationStatus;
    readonly error?: string;
    readonly liquidity?: bigint;
    readonly sqrtPriceX96?: bigint;
}
export interface DexPoolState {
    readonly poolAddress: string;
    readonly dexId: string;
    readonly token0: string;
    readonly token1: string;
    readonly feeTierBps?: number;
    readonly reserve0?: bigint;
    readonly reserve1?: bigint;
    readonly sqrtPriceX96?: bigint;
    readonly tick?: number;
    readonly liquidity?: bigint;
    readonly blockNumber?: number;
}
export interface DexLiquidityState {
    readonly poolAddress: string;
    readonly totalLiquidityRaw: string;
    readonly reserve0Raw?: string;
    readonly reserve1Raw?: string;
    readonly activeTick?: number;
}
export interface DexDeploymentVerificationResult {
    readonly dexId: string;
    readonly routerStatus: DexVerificationStatus;
    readonly factoryStatus: DexVerificationStatus;
    readonly quoterStatus?: DexVerificationStatus;
    readonly verifiedAt: number;
    readonly overallStatus: DexVerificationStatus;
    readonly issues: string[];
}
export interface DexSimulationResult {
    readonly isSuccess: boolean;
    readonly simulatedAmountOut?: bigint;
    readonly gasUsed?: bigint;
    readonly revertReason?: string;
    readonly semanticEquivalenceValid: boolean;
    readonly minimumOutputValid: boolean;
    readonly gasReserveValid: boolean;
    readonly preflightPassed: boolean;
}
export type DexConflictCategory = 'AGREEMENT' | 'EXPECTED_VARIANCE' | 'MATERIAL_CONFLICT' | 'IDENTITY_CONFLICT' | 'UNKNOWN';
export type DexConflictType = 'ROUTER_ADDRESS_CONFLICT' | 'FACTORY_ADDRESS_CONFLICT' | 'QUOTER_ADDRESS_CONFLICT' | 'PROTOCOL_VERSION_CONFLICT' | 'NETWORK_CONFLICT' | 'DEPLOYMENT_CONFLICT' | 'TOKEN_STANDARD_CONFLICT' | 'POOL_DISCOVERY_CONFLICT' | 'INTERFACE_CONFLICT' | 'NONE';
export interface DexConflictEvaluation {
    readonly category: DexConflictCategory;
    readonly conflictType: DexConflictType;
    readonly details: string;
    readonly canProceed: boolean;
}
export interface DexResolutionInput {
    readonly dexId?: string;
    readonly canonicalName?: string;
    readonly networkId?: string;
    readonly identityKey?: string;
    readonly routerAddress?: string;
}
export type DexResolutionStatus = 'RESOLVED_EXACT' | 'RESOLVED_AMBIGUOUS' | 'UNRESOLVED' | 'INVALID_INPUT';
export interface DexResolutionResult {
    readonly status: DexResolutionStatus;
    readonly dex?: DexIdentity;
    readonly matches?: DexIdentity[];
    readonly error?: string;
}
export interface DexValidationResult {
    readonly isValid: boolean;
    readonly errors: string[];
    readonly warnings: string[];
}
export type LiveDexVerificationMode = 'READ_ONLY_LIVE' | 'PREFLIGHT_ONLY' | 'LIVE_ONCHAIN';
export interface LiveDexPathConfig {
    readonly networkId: string;
    readonly dexId: string;
    readonly tokenInSymbol: string;
    readonly tokenOutSymbol: string;
    readonly tokenInAddress?: string;
    readonly tokenOutAddress?: string;
    readonly amountInRaw: bigint;
    readonly slippageBps: number;
    readonly feeTierBps?: number;
    readonly recipientAddress?: string;
    readonly userAddress?: string;
}
export interface LiveOnchainGateChecklist {
    networkVerified: boolean;
    dexVerified: boolean;
    tokensVerified: boolean;
    poolVerified: boolean;
    liveQuoteAvailable: boolean;
    quoteFresh: boolean;
    capabilitySatisfied: boolean;
    routeArbitrated: boolean;
    executionPlanGenerated: boolean;
    planSealed: boolean;
    semanticEquivalencePassed: boolean;
    economicSafetyPassed: boolean;
    ethCallPassed: boolean;
    ethEstimateGasPassed: boolean;
    rpcProvidersConsistent: boolean;
    signerAuthorizationAvailable: boolean;
    sufficientTokenBalance: boolean;
    sufficientNativeGas: boolean;
    boundedApproval: boolean;
    destinationRecipientAuthorized: boolean;
    noActiveCircuitBreaker: boolean;
    noUnresolvedConflict: boolean;
}
export interface LiveDexVerificationEvidence {
    readonly taskId: string;
    readonly mode: LiveDexVerificationMode;
    readonly networkIdentity: string;
    readonly dexIdentity: string;
    readonly tokenIn: TokenIdentity | Token;
    readonly tokenOut: TokenIdentity | Token;
    readonly poolIdentity: string | null;
    readonly router: string;
    readonly quote: AuthoritativeDexQuote | null;
    readonly quoteBlock: number | null;
    readonly quoteTimestamp: number | null;
    readonly currentBlock: number | null;
    readonly capabilityBefore: CapabilityLevel;
    readonly capabilityAfter: CapabilityLevel;
    readonly transactionPayload: DexSwapTransaction | null;
    readonly semanticHash: string | null;
    readonly ethCallResult: {
        success: boolean;
        returnData?: string;
        revertReason?: string;
    } | null;
    readonly ethEstimateGasResult: {
        gasLimit: bigint;
        estimatedFeeNative?: bigint;
    } | null;
    readonly rpcHealth: ProviderHealthStatus;
    readonly providerAgreement: boolean;
    readonly economicChecks: {
        passed: boolean;
        amountIn: bigint;
        minimumAmountOut: bigint;
        slippageBps: number;
    };
    readonly simulationChecks: DexSimulationResult | null;
    readonly executionEligibility: {
        isEligible: boolean;
        reasons: string[];
    };
    readonly liveExecutionPerformed: boolean;
    readonly liveExecutionReady: boolean;
    readonly liveExecutionVerified: boolean;
    readonly liveOnchainGateBlocked: boolean;
    readonly checklist: LiveOnchainGateChecklist;
    readonly factory?: string | null;
    readonly quoter?: string | null;
    readonly amountInRaw?: bigint | null;
    readonly expectedAmountOutRaw?: bigint | null;
    readonly minimumAmountOutRaw?: bigint | null;
    readonly quoteFresh?: boolean | null;
    readonly providerConsensus?: boolean | null;
    readonly liveVerified?: boolean | null;
}
export interface LiveDexVerificationResult {
    readonly isSuccess: boolean;
    readonly evidence: LiveDexVerificationEvidence;
    readonly error?: string;
}
export interface MultiDexSweepItemEvidence {
    readonly taskId: string;
    readonly networkIdentity: string;
    readonly dexIdentity: string;
    readonly tokenIn: TokenIdentity | Token;
    readonly tokenOut: TokenIdentity | Token;
    readonly poolIdentity: string | null;
    readonly router: string;
    readonly factory: string | null;
    readonly quoter: string | null;
    readonly amountInRaw: bigint | null;
    readonly expectedAmountOutRaw: bigint | null;
    readonly minimumAmountOutRaw: bigint | null;
    readonly quoteBlock: number | null;
    readonly quoteTimestamp: number | null;
    readonly currentBlock: number | null;
    readonly quoteFresh: boolean | null;
    readonly transactionPayload: DexSwapTransaction | null;
    readonly semanticHash: string | null;
    readonly ethCallResult: {
        success: boolean;
        returnData?: string;
        revertReason?: string;
    } | null;
    readonly ethEstimateGasResult: {
        gasLimit: bigint;
        estimatedFeeNative?: bigint;
    } | null;
    readonly providerConsensus: boolean | null;
    readonly capabilityBefore: CapabilityLevel;
    readonly capabilityAfter: CapabilityLevel;
    readonly liveVerified: boolean;
    readonly liveExecutionReady: boolean;
    readonly liveExecutionPerformed: boolean;
    readonly status: 'VERIFIED' | 'PREFLIGHT_VERIFIED' | 'READ_ONLY_VERIFIED' | 'UNAVAILABLE' | 'BLOCKED';
    readonly failureReason?: string | null;
}
export interface MultiDexSweepMatrixRow {
    readonly network: string;
    readonly dex: string;
    readonly deployment: string;
    readonly quote: string;
    readonly pool: string;
    readonly ethCall: string;
    readonly capability: string;
    readonly preflight: string;
    readonly providerConsensus: string;
}
export interface MultiDexSweepResult {
    readonly taskId: string;
    readonly sweepTimestamp: number;
    readonly mode: LiveDexVerificationMode;
    readonly sweepItems: Record<string, MultiDexSweepItemEvidence>;
    readonly matrix: MultiDexSweepMatrixRow[];
    readonly mainnetBroadcasts: number;
    readonly mainnetSpending: string;
    readonly signingOperations: number;
    readonly allPassed: boolean;
}
export type ExecutionCapabilityState = 'DISCOVERED' | 'CONFIGURED' | 'UNIT_TESTED' | 'SIMULATION_VERIFIED' | 'PREFLIGHT_VERIFIED' | 'EXECUTION_AVAILABLE' | 'LIVE_EXECUTION_READY' | 'LIVE_VERIFIED' | 'FUNDING_BLOCKED' | 'DISABLED' | 'DEPRECATED';
export type EvidenceClass = 'ON_CHAIN_LIVE' | 'READ_ONLY_LIVE' | 'PREFLIGHT' | 'SIMULATION' | 'FIXTURE' | 'CONFIGURATION' | 'UNVERIFIED';
export type FundingStatus = 'FUNDED' | 'UNFUNDED' | 'FUNDING_BLOCKED' | 'NOT_APPLICABLE';
export type PreflightStatus = 'PASSED' | 'BLOCKED_BY_FUNDING' | 'FAILED' | 'NOT_RUN';
export type LiveExecutionState = 'VERIFIED' | 'READY_AWAITING_FUNDS' | 'BLOCKED' | 'NOT_CONFIGURED';
export type SettlementStatus = 'SETTLED_ON_CHAIN' | 'SIMULATED' | 'NOT_APPLICABLE';
export interface CanaryQuoteMetadata {
    readonly inputAmountRaw: bigint;
    readonly expectedOutputRaw: bigint;
    readonly minimumOutputRaw: bigint;
    readonly slippageBps: number;
    readonly quoteTimestamp: number;
}
export interface CanaryFinalityEvidence {
    readonly gasUsed?: bigint;
    readonly nonce?: number;
    readonly blockNumber?: number;
    readonly actualAmountInRaw?: bigint;
    readonly actualAmountOutRaw?: bigint;
    readonly explorerUrl?: string;
    readonly transferLogVerified?: boolean;
    readonly balanceDeltaVerified?: boolean;
}
export interface AuthoritativeCanaryEntry {
    readonly canaryId: string;
    readonly networkIdentity: string;
    readonly chainId: number;
    readonly executionFamily: string;
    readonly dex: string;
    readonly dexId: string;
    readonly inputToken: string;
    readonly outputToken: string;
    readonly executionMode: string;
    readonly capabilityState: ExecutionCapabilityState;
    readonly evidenceState: EvidenceClass;
    readonly fundingState: FundingStatus;
    readonly preflightState: PreflightStatus;
    readonly liveExecutionState: LiveExecutionState;
    readonly settlementState: SettlementStatus;
    readonly lastVerifiedBlock: number | null;
    readonly quoteMetadata: CanaryQuoteMetadata | null;
    readonly planHash: string | null;
    readonly semanticHash: string | null;
    readonly realTransactionHash: string | null;
    readonly finalityEvidence: CanaryFinalityEvidence | null;
    readonly blockingReason: string | null;
    readonly nextRequiredPrerequisite: string | null;
    readonly isLiveVerified: boolean;
    readonly isFundingBlocked: boolean;
    readonly isExecutableNow: boolean;
    readonly updatedAt: number;
}
export interface UiApiStatusContract {
    readonly network: string;
    readonly chainId: number;
    readonly dex: string;
    readonly capability: ExecutionCapabilityState;
    readonly evidence: EvidenceClass;
    readonly funding: 'FUNDED' | 'BLOCKED' | 'NOT_APPLICABLE';
    readonly executable_now: boolean;
    readonly live_verified: boolean;
    readonly reason?: string | null;
    readonly nextPrerequisite?: string | null;
}
export interface MultiChainReadinessSnapshot {
    readonly timestamp: number;
    readonly totalNetworksTracked: number;
    readonly liveVerifiedCanaries: number;
    readonly fundingBlockedCanaries: number;
    readonly simulationVerifiedCanaries: number;
    readonly configuredCanaries: number;
    readonly canaries: Record<string, AuthoritativeCanaryEntry>;
    readonly networkMatrix: Array<{
        network: string;
        chainId: number;
        status: string;
        capability: string;
        evidence: string;
    }>;
    readonly dexMatrix: Array<{
        dexId: string;
        network: string;
        capability: string;
        liveReady: boolean;
        liveVerified: boolean;
    }>;
    readonly bridgeMatrix: Array<{
        bridgeId: string;
        supportedRoutes: number;
        capability: string;
    }>;
}
export type CrossChainRouteCategory = 'DIRECT_CROSS_CHAIN' | 'COMPOSITE_CROSS_CHAIN';
export interface CanonicalCrossChainIntent {
    readonly intentId: string;
    readonly sourceChainId: number | string;
    readonly destinationChainId: number | string;
    readonly inputToken: TokenIdentity;
    readonly requestedOutputToken: TokenIdentity;
    readonly inputAmountRaw: bigint;
    readonly minimumOutputRaw: bigint;
    readonly recipient: string;
    readonly bridgeProvider: string;
    readonly sourceExecutionMode: 'DIRECT' | 'SWAP_AND_BRIDGE';
    readonly destinationExecutionMode: 'DIRECT' | 'BRIDGE_AND_SWAP';
    readonly routeType: CrossChainRouteCategory;
    readonly deadline: number;
    readonly slippageBps: number;
    readonly executionPlanId: string;
    readonly planHash: string;
    readonly semanticHash: string;
    readonly createdAt: number;
}
export type SourceSwapStepState = 'PLANNED' | 'PREFLIGHTED' | 'BROADCAST' | 'CONFIRMED' | 'FAILED' | 'BROADCAST_UNCERTAIN';
export type BridgeStepState = 'PLANNED' | 'QUOTED' | 'PREPARED' | 'SUBMITTED' | 'SOURCE_CONFIRMED' | 'RELAY_PENDING' | 'FILLED' | 'FAILED' | 'UNCERTAIN';
export type DestinationSwapStepState = 'PLANNED' | 'PREFLIGHTED' | 'BROADCAST' | 'CONFIRMED' | 'FAILED' | 'UNCERTAIN' | 'NOT_APPLICABLE';
export type DestinationVerificationStepState = 'NOT_STARTED' | 'TX_FOUND' | 'RECEIPT_VERIFIED' | 'TRANSFER_VERIFIED' | 'BALANCE_VERIFIED' | 'FINALITY_VERIFIED';
export type SettlementStepState = 'PENDING' | 'VERIFIED' | 'SETTLED' | 'SETTLEMENT_BLOCKED';
export type FinalityState = 'UNCONFIRMED' | 'CONFIRMED' | 'FINALITY_PENDING' | 'FINAL' | 'REORG_DETECTED' | 'FINALITY_UNKNOWN';
export type CompositeOverallState = 'QUOTING' | 'READY' | 'SOURCE_EXECUTING' | 'SOURCE_CONFIRMED' | 'BRIDGE_PENDING' | 'BRIDGE_FILLED' | 'DESTINATION_EXECUTING' | 'DESTINATION_CONFIRMING' | 'FINALITY_PENDING' | 'SETTLED' | 'FAILED' | 'UNCERTAIN' | 'RECONCILIATION_BLOCKED' | 'FUNDING_REQUIRED';
export type NormalizedMonitoringErrorCode = 'INTENT_INVALID' | 'PLAN_INVALID' | 'QUOTE_EXPIRED' | 'PREFLIGHT_FAILED' | 'SOURCE_EXECUTION_FAILED' | 'SOURCE_BROADCAST_UNCERTAIN' | 'ACTUAL_OUTPUT_UNAVAILABLE' | 'BRIDGE_QUOTE_UNAVAILABLE' | 'BRIDGE_SUBMISSION_FAILED' | 'BRIDGE_BROADCAST_UNCERTAIN' | 'BRIDGE_RELAY_PENDING' | 'BRIDGE_FILL_UNCONFIRMED' | 'DESTINATION_TX_NOT_FOUND' | 'DESTINATION_RECEIPT_FAILED' | 'DESTINATION_UNDERDELIVERY' | 'DESTINATION_RECIPIENT_MISMATCH' | 'DESTINATION_TARGET_MISMATCH' | 'SEMANTIC_MISMATCH' | 'FINALITY_UNKNOWN' | 'REORG_DETECTED' | 'RECONCILIATION_CONFLICT' | 'SETTLEMENT_BLOCKED';
export interface AmountTransitionAuditRecord {
    readonly stage: string;
    readonly token: string;
    readonly chainId: number | string;
    readonly expectedAmountRaw: bigint;
    readonly actualAmountRaw: bigint;
    readonly deltaRaw: bigint;
    readonly timestamp: number;
}
export interface MonitoringApiStatusResponse {
    readonly intentId: string;
    readonly planId: string;
    readonly overallState: CompositeOverallState;
    readonly source: {
        readonly state: SourceSwapStepState;
        readonly txHash: string | null;
        readonly confirmationState: string;
        readonly actualOutputRaw?: string | null;
    };
    readonly bridge: {
        readonly provider: string;
        readonly state: BridgeStepState;
        readonly evidenceTier: string;
        readonly sourceTxHash?: string | null;
        readonly fillTxHash?: string | null;
    };
    readonly destination: {
        readonly state: DestinationSwapStepState;
        readonly verificationState: DestinationVerificationStepState;
        readonly txHash: string | null;
        readonly receiptState: string;
        readonly evidenceTier: string;
        readonly finalityState: FinalityState;
        readonly actualOutputRaw?: string | null;
    };
    readonly settlement: {
        readonly state: SettlementStepState;
        readonly evidenceTier: string;
    };
    readonly blockingReason: string | null;
    readonly lastUpdated: number;
}
export interface CompositeTelemetryEvent {
    readonly intentId: string;
    readonly planId: string;
    readonly stepId: string;
    readonly network: string;
    readonly chainId: number | string;
    readonly token: string;
    readonly amount: string;
    readonly state: string;
    readonly previousState: string;
    readonly newState: string;
    readonly evidenceTier: string;
    readonly timestamp: number;
    readonly blockNumber?: number | null;
    readonly txHash?: string | null;
    readonly provider?: string | null;
    readonly errorCode?: NormalizedMonitoringErrorCode | null;
    readonly reconciliationStatus: string;
}
export type ArbitrationBenchmarkRouteCategory = 'SAME_CHAIN_DEX' | 'DIRECT_CROSS_CHAIN' | 'COMPOSITE_CROSS_CHAIN' | 'FULL_COMPOSITE';
export interface StageLatencyMetrics {
    readonly stage: string;
    readonly minMs: number;
    readonly meanMs: number;
    readonly medianMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly p99Ms: number;
    readonly maxMs: number;
    readonly sampleCount: number;
}
export interface RouteArbitrationStageLatencies {
    readonly discovery: StageLatencyMetrics;
    readonly capabilityFilter: StageLatencyMetrics;
    readonly quoteAggregation: StageLatencyMetrics;
    readonly arbitration: StageLatencyMetrics;
    readonly planBuild: StageLatencyMetrics;
    readonly totalRouteResolution: StageLatencyMetrics;
}
export interface QuoteLoadSimulationBatchResult {
    readonly concurrency: number;
    readonly totalRequests: number;
    readonly successfulResolutions: number;
    readonly rejectedRoutes: number;
    readonly failures: number;
    readonly p50LatencyMs: number;
    readonly p95LatencyMs: number;
    readonly p99LatencyMs: number;
    readonly maxLatencyMs: number;
    readonly meanLatencyMs: number;
    readonly minLatencyMs: number;
    readonly throughputReqPerSec: number;
    readonly timeoutCount: number;
    readonly staleQuoteCount: number;
    readonly providerFailureCount: number;
    readonly arbitrationFailures: number;
    readonly durationMs: number;
}
export interface MultiChainRouteMatrixRow {
    readonly network: string;
    readonly chainId: number;
    readonly dex: string;
    readonly bridgeProvider: string | null;
    readonly tokenPair: string;
    readonly routeType: ArbitrationBenchmarkRouteCategory;
    readonly capability: ExecutionCapabilityState;
    readonly evidence: EvidenceClass;
    readonly quoteStatus: 'FRESH' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNAVAILABLE';
    readonly executionEligibility: boolean;
    readonly fundingStatus: 'FUNDED' | 'FUNDING_BLOCKED' | 'NOT_APPLICABLE';
    readonly providerHealth: 'HEALTHY' | 'DEGRADED' | 'CIRCUIT_OPEN' | 'UNAVAILABLE';
    readonly arbitrationEligibility: boolean;
    readonly blockingReason: string | null;
}
export interface MemoryBenchmarkMetrics {
    readonly initialHeapUsedBytes: number;
    readonly peakHeapUsedBytes: number;
    readonly finalHeapUsedBytes: number;
    readonly heapGrowthBytes: number;
    readonly totalArbitrationCycles: number;
    readonly averageMemoryPerCycleBytes: number;
    readonly isMemoryBounded: boolean;
}
export interface CacheBenchmarkResult {
    readonly coldCacheLatencyMs: number;
    readonly warmCacheLatencyMs: number;
    readonly speedupFactor: number;
    readonly staleCacheEvictions: number;
    readonly invalidationCount: number;
    readonly concurrentCacheHits: number;
    readonly cacheIntegrityPreserved: boolean;
}
export interface ProviderFailureScenarioResult {
    readonly failureType: 'PROVIDER_TIMEOUT' | 'PROVIDER_UNAVAILABLE' | 'STALE_RESPONSE' | 'MALFORMED_QUOTE' | 'INVALID_AMOUNT' | 'RPC_DISAGREEMENT' | 'RATE_LIMIT' | 'CIRCUIT_OPEN' | 'PARTIAL_OUTAGE' | 'BRIDGE_UNAVAILABLE' | 'DEX_UNAVAILABLE';
    readonly simulatedProvider: string;
    readonly fallbackRouteSelected: boolean;
    readonly selectedRouteId: string | null;
    readonly failClosedTriggered: boolean;
    readonly broadcastUncertainProtected: boolean;
    readonly passed: boolean;
    readonly notes: string;
}
export interface ArbitrationStressScenarioResult {
    readonly scenarioId: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';
    readonly scenarioName: string;
    readonly expectedOutcome: string;
    readonly actualOutcome: string;
    readonly passed: boolean;
    readonly selectedRouteId: string | null;
    readonly fallbackOccurred: boolean;
    readonly failClosedPreserved: boolean;
    readonly durationMs: number;
}
export interface DeterministicFuzzingSummary {
    readonly totalFuzzIterations: number;
    readonly permutationInvariancePassed: boolean;
    readonly sortingStabilityPassed: boolean;
    readonly duplicateResiliencePassed: boolean;
    readonly malformedResiliencePassed: boolean;
    readonly largeIntegerMathPassed: boolean;
    readonly zeroNondeterminismViolations: boolean;
    readonly totalViolations: number;
}
export interface RouteArbitrationBenchmarkResult {
    readonly benchmarkId: string;
    readonly timestamp: number;
    readonly registrySnapshot: string;
    readonly routeCount: number;
    readonly candidateCount: number;
    readonly concurrencyBatches: QuoteLoadSimulationBatchResult[];
    readonly stageLatencies: RouteArbitrationStageLatencies;
    readonly multiChainMatrix: MultiChainRouteMatrixRow[];
    readonly stressScenarios: ArbitrationStressScenarioResult[];
    readonly providerFailures: ProviderFailureScenarioResult[];
    readonly cacheMetrics: CacheBenchmarkResult;
    readonly memoryMetrics: MemoryBenchmarkMetrics;
    readonly fuzzMetrics: DeterministicFuzzingSummary;
    readonly overallPassed: boolean;
    readonly broadcasts: 0;
    readonly signingOperations: 0;
    readonly fundsSpent: 0;
    readonly liveOnChain: false;
}
