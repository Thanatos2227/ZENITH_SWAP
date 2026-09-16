import { ConfigurationError } from '../errors';

export const PERMIT2_CANONICAL_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

export const PERMIT2_SUPPORTED_CHAINS: ReadonlySet<number> = new Set([
  1,
  10,
  56,
  137,
  324,
  8453,
  42161,
  43114,
  59144,
  534352,
  81457,
  34443,
  1101,
  42220,
  100,
  252
]);

export function getPermit2Address(chainId: number): string {
  if (PERMIT2_SUPPORTED_CHAINS.has(chainId)) {
    return PERMIT2_CANONICAL_ADDRESS;
  }
  throw new ConfigurationError(
    `Permit2 is not supported or verified on chain ID ${chainId}`,
    'PERMIT2_UNAVAILABLE'
  );
}

export function isPermit2Supported(chainId: number): boolean {
  return PERMIT2_SUPPORTED_CHAINS.has(chainId);
}
