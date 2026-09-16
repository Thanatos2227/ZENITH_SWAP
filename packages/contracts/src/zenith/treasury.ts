import { ConfigurationError } from '../errors';
import { getZenithDeployment } from '../deployments';

export const ZENITH_TREASURY: Record<string | number, string | undefined> = {
  1: undefined,
  10: undefined,
  56: undefined,
  137: undefined,
  8453: undefined,
  42161: undefined,
  43114: undefined,
  solana: undefined
};

export const ZENITH_PROTOCOL_FEE_RECIPIENT: Record<string | number, string | undefined> = {
  1: undefined,
  10: undefined,
  56: undefined,
  137: undefined,
  8453: undefined,
  42161: undefined,
  43114: undefined,
  solana: undefined
};

export function getZenithTreasury(chainId: string | number): string {
  const deployment = typeof chainId === 'number' ? getZenithDeployment(chainId) : undefined;
  const address = ZENITH_TREASURY[chainId] || deployment?.treasury;
  if (!address) {
    throw new ConfigurationError(
      `ZENITH Treasury address is not configured for chain ${chainId}. Protocol fee collection cannot proceed.`,
      'ZENITH_TREASURY_NOT_CONFIGURED'
    );
  }
  return address;
}

export const getZenithTreasuryAddress = getZenithTreasury;

export function getZenithFeeControllerAddress(chainId: string | number): string {
  const deployment = typeof chainId === 'number' ? getZenithDeployment(chainId) : undefined;
  const address = deployment?.feeController;
  if (!address) {
    throw new ConfigurationError(
      `ZENITH Fee Controller is not configured for chain ${chainId}.`,
      'ZENITH_FEE_CONTROLLER_NOT_CONFIGURED'
    );
  }
  return address;
}

export function getZenithProtocolFeeRecipient(chainId: string | number): string {
  const address = ZENITH_PROTOCOL_FEE_RECIPIENT[chainId];
  if (!address) {
    throw new ConfigurationError(
      `ZENITH Protocol Fee Recipient is not configured for chain ${chainId}.`,
      'ZENITH_FEE_RECIPIENT_NOT_CONFIGURED'
    );
  }
  return address;
}

export function isZenithTreasuryConfigured(chainId: string | number): boolean {
  const deployment = typeof chainId === 'number' ? getZenithDeployment(chainId) : undefined;
  return Boolean(ZENITH_TREASURY[chainId] || deployment?.treasury);
}
