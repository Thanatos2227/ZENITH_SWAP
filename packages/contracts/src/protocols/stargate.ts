import { UnsupportedProtocolError } from '../errors';

export const STARGATE_V2_ROUTERS: Record<number, string> = {
  1: '0x8731d54E9D02c286767d56ac03e8037C07e01e98',
  10: '0xB0D502E938ed5f4df2E681fE6E419ff29631d62b',
  56: '0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8',
  137: '0x45A01E4e04F14f7A4a1dA563391C99f3679C3eb0',
  8453: '0x45f1A95A4D3f3836523F5c83673c797f4d4d263B',
  42161: '0x53Bf833A5d6c4ddA888F69c22C88C9f356a41614',
  43114: '0x45A01E4e04F14f7A4a1dA563391C99f3679C3eb0',
  59144: '0x53Bf833A5d6c4ddA888F69c22C88C9f356a41614',
  534352: '0x2F6F07CDcf3588944Bf4C42aC07ff614588E673f'
};

export const STARGATE_ROUTER_ABI = [
  'function swap(uint16 _dstChainId, uint256 _srcPoolId, uint256 _dstPoolId, address payable _refundAddress, uint256 _amountLD, uint256 _minAmountLD, (uint256 dstGasForCall, uint256 dstNativeAmount, bytes dstNativeAddr) _lzTxParams, bytes _to, bytes _payload) external payable',
  'function quoteLayerZeroFee(uint16 _dstChainId, uint8 _functionType, bytes _toAddress, bytes _transferAndCallPayload, (uint256 dstGasForCall, uint256 dstNativeAmount, bytes dstNativeAddr) _lzTxParams) external view returns (uint256, uint256)'
];

export function getStargateRouter(chainId: number): string {
  const router = STARGATE_V2_ROUTERS[chainId];
  if (!router) {
    throw new UnsupportedProtocolError('STARGATE', chainId);
  }
  return router;
}

export function isStargateSupported(chainId: number): boolean {
  return Boolean(STARGATE_V2_ROUTERS[chainId]);
}
