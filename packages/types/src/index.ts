export type ExecutionEnvironment =
  | 'EVM'
  | 'SOLANA'
  | 'BITCOIN'
  | 'TVM'
  | 'COSMOS'
  | 'MOVE'
  | 'NEAR'
  | 'TON'
  | 'SUBSTRATE'
  | 'XRPL'
  | 'STELLAR'
  | 'UTXO'
  | 'ICP';

export type NetworkSupportTier = 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4';

export type OperationalStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'MAINTENANCE'
  | 'PARTIALLY_AVAILABLE'
  | 'PAUSED'
  | 'DISABLED';

export type NetworkCategory =
  | 'LAYER_1'
  | 'OPTIMISTIC_ROLLUP'
  | 'ZK_ROLLUP'
  | 'ORBIT_RWA'
  | 'PAYMENTS_NETWORK'
  | 'HIGH_THROUGHPUT_L1';

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

export type DEXProtocol =
  | 'ZENITH_V1'
  | 'ZENITH_V2'
  | 'ZENITH_V3'
  | 'ZENITH_V4_CONCENTRATED'
  | 'ZENITH_DUTCH_INTENT'
  | 'ZENITH_INTERNAL_RFIS'
  | 'UNISWAP_V2'
  | 'UNISWAP_V3'
  | 'UNISWAP_V4'
  | 'CURVE'
  | 'BALANCER_V2'
  | 'AERODROME'
  | 'VELODROME'
  | 'CAMELOT'
  | 'QUICKSWAP'
  | 'PANCAKESWAP'
  | 'TRADER_JOE'
  | 'RAYDIUM'
  | 'ORCA_WHIRLPOOL'
  | 'METEORA';

export type BridgeProtocol =
  | 'STARGATE'
  | 'STARGATE_V2'
  | 'ACROSS'
  | 'ACROSS_V3'
  | 'LIFI'
  | 'SOCKET'
  | 'CHAINLINK_CCIP'
  | 'DEBRIDGE'
  | 'DEBRIDGE_DLN'
  | 'WORMHOLE';

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

export type SettlementState =
  | 'CREATED'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'FULFILLING'
  | 'DESTINATION_FILLED'
  | 'VERIFIED'
  | 'SETTLING'
  | 'SETTLED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'FAILED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'TRACKING_TIMEOUT'
  | 'TRACKING_UNAVAILABLE';

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

export type TransactionStatus =
  | 'IDLE'
  | 'QUOTE_REQUESTED'
  | 'QUOTED'
  | 'SIMULATING'
  | 'SIMULATED'
  | 'APPROVAL_NEEDED'
  | 'APPROVING'
  | 'APPROVED'
  | 'SIGNING'
  | 'SUBMITTING'
  | 'BROADCASTED'
  | 'CONFIRMING'
  | 'COMPLETED'
  | 'BRIDGE_SOURCE_CONFIRMED'
  | 'BRIDGE_IN_FLIGHT'
  | 'BRIDGE_DESTINATION_CONFIRMED'
  | 'DESTINATION_FILLED'
  | 'SETTLED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'TRACKING_TIMEOUT'
  | 'TRACKING_UNAVAILABLE'
  | 'FAILED'
  | 'REVERTED'
  | 'CANCELLED';

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

export type WalletType =
  | 'METAMASK'
  | 'PHANTOM'
  | 'COINBASE'
  | 'RABBY'
  | 'OKX'
  | 'RAINBOW'
  | 'WALLETCONNECT'
  | 'INJECTED';

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
  historicalVolume: Array<{ timestamp: number; volumeUSD: number; tvlUSD: number }>;
}

// ==========================================
// EXECUTION PLAN & ARCHITECTURE TYPES
// ==========================================

export type CompositeExecutionMode =
  | 'ATOMIC'
  | 'SOLVER'
  | 'SEPARATE_DESTINATION_TX'
  | 'UNSUPPORTED';

export type ExecutionStepType =
  | 'VALIDATION'
  | 'APPROVAL'
  | 'SOURCE_APPROVAL'
  | 'SOURCE_SWAP'
  | 'BRIDGE_QUOTE_REFRESH'
  | 'BRIDGE_DEPOSIT'
  | 'BRIDGE_RELAY_WAIT'
  | 'DESTINATION_APPROVAL'
  | 'DESTINATION_SWAP'
  | 'DESTINATION_VERIFY'
  | 'SETTLEMENT_COMPLETE';

export type StepExecutionEnvironment = 'EVM' | 'SOLANA' | 'OFF_CHAIN';

export type StepStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'SIMULATING'
  | 'SIGNING'
  | 'SUBMITTED'
  | 'CONFIRMING'
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED';

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

export type BridgeCapabilityState =
  | 'CONFIGURED'
  | 'QUOTE_SUPPORTED'
  | 'EXECUTION_SUPPORTED'
  | 'DESTINATION_SETTLEMENT_SUPPORTED';

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
  inputAmountActual: string; // Base units from actual bridge output
  outputToken: Token;
  minimumOutputAmount: string; // Base units protecting slippage
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

export type TransactionLifecycleState =
  | 'CREATED'
  | 'PREFLIGHTING'
  | 'PREFLIGHT_PASSED'
  | 'READY_TO_BROADCAST'
  | 'BROADCASTING'
  | 'BROADCAST_UNCERTAIN'
  | 'BROADCAST_CONFIRMED'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'PREFLIGHT_FAILED'
  | 'BROADCAST_FAILED'
  | 'REVERTED'
  | 'DROPPED'
  | 'EXPIRED'
  | 'RECOVERY_REQUIRED';

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

export type ProviderHealthStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNHEALTHY'
  | 'CIRCUIT_OPEN'
  | 'RECOVERING';

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

export type EvidenceSourceType =
  | 'ON_CHAIN_RECEIPT'
  | 'TRANSACTION_LOOKUP'
  | 'PROVIDER_API'
  | 'INFORMATIONAL_API'
  | 'LOCAL_CACHE';

export interface ReconciliationEvidence {
  evidenceId: string;
  source: EvidenceSourceType;
  priority: number; // 1: ON_CHAIN_RECEIPT, 2: TRANSACTION_LOOKUP, 3: PROVIDER_API, 4: INFORMATIONAL_API, 5: LOCAL_CACHE
  timestamp: number;
  providerId?: string;
  chainId?: string;
  txHash?: string;
  blockNumber?: number;
  status?: string;
  data?: any;
}

export type ReconciliationStatus =
  | 'SETTLED'
  | 'DESTINATION_FILLED'
  | 'FULFILLING'
  | 'STATUS_UNKNOWN'
  | 'DESTINATION_STATUS_UNCERTAIN'
  | 'STATUS_CONFLICT'
  | 'RECOVERY_REQUIRED'
  | 'FAILED'
  | 'REFUNDED';

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

// ============================================================================
// PHASE 0 / TASK 6: CROSS-CHAIN QUOTE PROVIDER DIAGNOSTICS & NORMALIZATION
// ============================================================================

// Standardized Provider Capability Levels (Phase 1 Task 26)
export type ProviderCapabilityLevel =
  | 'UNIT_TESTED'
  | 'CONFIGURED'
  | 'QUOTE_AVAILABLE'
  | 'EXECUTION_AVAILABLE'
  | 'LIVE_VERIFIED'
  | 'UNSUPPORTED';

// Standardized 16-Category Provider Error Taxonomy (Phase 1 Task 26)
export type ProviderErrorCategory =
  | 'UNSUPPORTED_ROUTE'
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INVALID_QUOTE'
  | 'EXPIRED_QUOTE'
  | 'MISSING_EXECUTION_DATA'
  | 'INVALID_CALLDATA'
  | 'INVALID_TARGET'
  | 'INVALID_TOKEN'
  | 'INVALID_CHAIN'
  | 'INSUFFICIENT_LIQUIDITY'
  | 'DESTINATION_UNAVAILABLE'
  | 'TRACKING_UNAVAILABLE'
  | 'STATUS_UNKNOWN'
  | 'STATUS_CONFLICT'
  | 'EXECUTION_UNAVAILABLE';

export type CrossChainQuoteErrorCode =
  | ProviderErrorCategory
  | 'QUOTE_EXPIRED'
  | 'API_AUTH_REQUIRED'
  | 'UNSUPPORTED_TOKEN'
  | 'INVALID_AMOUNT'
  | 'MALFORMED_RESPONSE'
  | 'INVALID_EXECUTION_DATA'
  | 'UNKNOWN_PROVIDER_ERROR'
  | 'DESTINATION_EXECUTION_UNAVAILABLE'
  | 'SOURCE_SWAP_UNAVAILABLE'
  | 'QUOTE_UNAVAILABLE';

export type CrossChainCapabilityStatus =
  | 'UNIT_TESTED'
  | 'CONFIGURED'
  | 'QUOTE_AVAILABLE'
  | 'EXECUTION_AVAILABLE'
  | 'TRACKING_AVAILABLE'
  | 'LIVE_VERIFIED'
  | 'UNSUPPORTED';

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

// Provider-Agnostic Normalized Bridge Quote (Phase 1 Task 26)
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

// Universal 15-Gate Executability Validation (Phase 1 Task 26)
export type UniversalValidationGate =
  | 'ROUTE_SUPPORTED'
  | 'LIVE_QUOTE_VERIFIED'
  | 'VALID_SOURCE_TOKEN'
  | 'VALID_DESTINATION_TOKEN'
  | 'VALID_CHAIN_IDS'
  | 'VALID_INPUT_AMOUNT'
  | 'VALID_EXPECTED_OUTPUT'
  | 'VALID_MINIMUM_OUTPUT'
  | 'VALID_EXECUTION_TARGET'
  | 'VALID_CALLDATA'
  | 'VALID_APPROVAL_TARGET'
  | 'VALID_EXPIRATION'
  | 'VALID_RECEIVER'
  | 'VALID_TRANSACTION_VALUE'
  | 'CAPABILITY_PERMITS_EXECUTION';

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

// ============================================================================
// PHASE 0 / TASK 11: OPERATOR CONTROL & AUDIT TRAIL TYPES
// ============================================================================

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

// ============================================================================
// PHASE 1 / TASK 24: GOLDEN PATH EXECUTION OBSERVABILITY & METRICS
// ============================================================================

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

// ============================================================================
// PHASE 1 / TASK 27: CROSS-PROVIDER ROUTE SELECTION & QUOTE ARBITRATION TYPES
// ============================================================================

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
  // Optional execution and routing payloads
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
  rejectedCandidates: Array<{ route: NormalizedRoute; reason: string }>;
  selectionMetrics: {
    totalEvaluated: number;
    totalExecutable: number;
    arbitrationDurationMs: number;
    tieBrokenByRouteId: boolean;
  };
}

