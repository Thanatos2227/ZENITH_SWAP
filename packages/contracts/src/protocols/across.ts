import { UnsupportedProtocolError } from '../errors';

export const ACROSS_V3_SPOKE_POOLS: Record<number, string> = {
  1: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
  10: '0x6f26Bf09B1C792e3228e5467807a900A503c0281',
  137: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
  8453: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',
  42161: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A',
  59144: '0x7E63A5f1a8F0B4d0934B2F2327dAED3F6BB2d752',
  534352: '0x3Bad7AD0728F9917D1Bf08af5782DCBd516Cd961',
  81457: '0x2d509190eD0172bA588407D4C2DF908D53F0222C',
  34443: '0x3B95452D3BE21F63231495A519fce79D3b51ac50',
  324: '0xE0B01066d5308388F90280C371c2a272543b7773',
  11155111: '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662',
  421614: '0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75',
  84532: '0x82B564983aE7274c86695917BBf8C99ECb6F0F8F',
  11155420: '0x4e8E101924eDE233C13e2D8622DC8aED2872d505'
};

export const ACROSS_SPOKE_POOLS = ACROSS_V3_SPOKE_POOLS;

export const ACROSS_SPOKE_POOL_ABI = [
  'function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) external payable',
  'function deposit(address recipient, address originToken, uint256 amount, uint256 destinationChainId, int64 relayerFeePct, uint32 quoteTimestamp, bytes message, uint256 maxCount) external payable'
];

export function getAcrossSpokePool(chainId: number): string {
  const pool = ACROSS_V3_SPOKE_POOLS[chainId];
  if (!pool) {
    throw new UnsupportedProtocolError('ACROSS', chainId);
  }
  return pool;
}

export function isAcrossSupported(chainId: number): boolean {
  return Boolean(ACROSS_V3_SPOKE_POOLS[chainId]);
}
