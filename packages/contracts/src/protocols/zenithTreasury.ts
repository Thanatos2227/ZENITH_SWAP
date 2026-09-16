import { getZenithDeployment } from '../deployments';

export const ZENITH_TREASURY_ABI = [

  'function governance() external view returns (address)',
  'function pendingGovernance() external view returns (address)',
  'function isEmergencyPaused() external view returns (bool)',
  'function authorizedCollector(address collector) external view returns (bool)',
  'function isAuthorizedCollector(address collector) external view returns (bool)',
  'function cumulativeFeesCollected(address token) external view returns (uint256)',
  'function getTreasuryBalance(address token) external view returns (uint256)',
  'function getCollectedFees(address token) external view returns (uint256)',

  'function depositERC20Fee(address token, uint256 amount) external',
  'function depositNativeFee() external payable',
  'function withdraw(address token, address payable recipient, uint256 amount) external',
  'function setFeeCollector(address collector, bool authorized) external',
  'function setEmergencyPause(bool paused) external',
  'function rescueToken(address token, address payable recipient, uint256 amount) external',
  'function transferGovernance(address newGovernance) external',
  'function acceptGovernance() external',

  'event FeeReceived(address indexed token, address indexed collector, uint256 amount)',
  'event DirectNativeReceived(address indexed from, uint256 amount)',
  'event TreasuryWithdrawal(address indexed token, address indexed recipient, uint256 amount)',
  'event EmergencyPaused(address indexed actor)',
  'event EmergencyUnpaused(address indexed actor)',
  'event EmergencyTokenRescue(address indexed token, address indexed recipient, uint256 amount)',
  'event FeeCollectorUpdated(address indexed collector, bool authorized)',
  'event GovernanceTransferInitiated(address indexed currentGovernance, address indexed pendingGovernance)',
  'event GovernanceTransferred(address indexed oldGovernance, address indexed newGovernance)'
];

export const ZENITH_FEE_CONTROLLER_ABI = [

  'function MAX_PROTOCOL_FEE_BPS() external view returns (uint256)',
  'function MAX_CROSS_CHAIN_FEE_BPS() external view returns (uint256)',
  'function governance() external view returns (address)',
  'function pendingGovernance() external view returns (address)',
  'function treasury() external view returns (address)',
  'function protocolFeeBps() external view returns (uint256)',
  'function crossChainFeeBps() external view returns (uint256)',
  'function v1TotalFeeBps() external view returns (uint256)',
  'function isV2FeeTierAllowed(uint24 feeTierBps) external view returns (bool)',
  'function isV3FeeTierAllowed(uint24 feeTier) external view returns (bool)',
  'function v3TickSpacings(uint24 feeTier) external view returns (int24)',
  'function isFeeCollector(address collector) external view returns (bool)',
  'function calculateProtocolFee(uint256 amount) external view returns (uint256 feeAmount)',
  'function calculateCrossChainFee(uint256 amount) external view returns (uint256 feeAmount)',

  'function setProtocolFeeBps(uint256 newFeeBps) external',
  'function setCrossChainFeeBps(uint256 newFeeBps) external',
  'function setV1TotalFeeBps(uint256 newFeeBps) external',
  'function setTreasury(address newTreasury) external',
  'function setFeeCollector(address collector, bool authorized) external',
  'function configureV2FeeTier(uint24 feeTierBps, bool allowed) external',
  'function configureV3FeeTier(uint24 feeTier, int24 tickSpacing, bool allowed) external',
  'function transferGovernance(address newGovernance) external',
  'function acceptGovernance() external',

  'event ProtocolFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps)',
  'event CrossChainFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps)',
  'event V1TotalFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps)',
  'event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury)',
  'event FeeCollectorUpdated(address indexed collector, bool authorized)',
  'event GovernanceTransferInitiated(address indexed currentGovernance, address indexed pendingGovernance)',
  'event GovernanceTransferred(address indexed oldGovernance, address indexed newGovernance)',
  'event V2FeeTierConfigured(uint24 indexed feeTierBps, bool allowed)',
  'event V3FeeTierConfigured(uint24 indexed feeTier, int24 tickSpacing, bool allowed)'
];

export function getZenithFeeController(chainId: number): string | undefined {
  const deployment = getZenithDeployment(chainId);
  return deployment?.feeController || undefined;
}
