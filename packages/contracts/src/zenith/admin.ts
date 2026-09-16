import { ConfigurationError } from '../errors';

export const ZENITH_ADMIN: Record<string | number, string | undefined> = {
  1: undefined,
  10: undefined,
  56: undefined,
  137: undefined,
  8453: undefined,
  42161: undefined,
  43114: undefined,
  solana: undefined
};

export const ZENITH_GUARDIAN_PAUSER: Record<string | number, string | undefined> = {
  1: undefined,
  10: undefined,
  56: undefined,
  137: undefined,
  8453: undefined,
  42161: undefined,
  43114: undefined,
  solana: undefined
};

export function getZenithAdmin(chainId: string | number): string {
  const address = ZENITH_ADMIN[chainId];
  if (!address) {
    throw new ConfigurationError(
      `ZENITH Admin address is not configured for chain ${chainId}.`,
      'ZENITH_ADMIN_NOT_CONFIGURED'
    );
  }
  return address;
}

export function getZenithGuardianPauser(chainId: string | number): string {
  const address = ZENITH_GUARDIAN_PAUSER[chainId];
  if (!address) {
    throw new ConfigurationError(
      `ZENITH Guardian Pauser address is not configured for chain ${chainId}.`,
      'ZENITH_GUARDIAN_NOT_CONFIGURED'
    );
  }
  return address;
}
