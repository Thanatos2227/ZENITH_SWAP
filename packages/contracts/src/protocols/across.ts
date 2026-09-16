import { UnsupportedProtocolError } from '../errors';

export const ACROSS_V3_SPOKE_POOLS: Record<number, string> = {
  1: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
  10: '0x6f26Bf09B1C792e3228e5467807a900A50DeECAa',
  137: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
  8453: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',
  42161: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A',
  59144: '0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2d752',
  534352: '0x3BaD7ad0728f9917d1Bf08af5782dCbD516cD961',
  81457: '0x2D509190Ed0172ba588407D4c2df908d53F0222C',
  34443: '0x3B95452d3BE21f63231495A519fCE79D3B51AC50',
  324: '0xE0B01066d5308388F90280C371c2A272543b7773'
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
