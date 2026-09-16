import { ConfigurationError } from '../errors';

export const ZENITH_SETTLEMENT_CONTRACT: Record<string | number, string | undefined> = {
  1: undefined,
  10: undefined,
  56: undefined,
  137: undefined,
  8453: undefined,
  42161: undefined,
  43114: undefined,
  solana: undefined
};

export const ZENITH_SOLVER_CONTRACT: Record<string | number, string | undefined> = {
  1: undefined,
  10: undefined,
  56: undefined,
  137: undefined,
  8453: undefined,
  42161: undefined,
  43114: undefined,
  solana: undefined
};

export function getZenithSettlementContract(chainId: string | number): string {
  const address = ZENITH_SETTLEMENT_CONTRACT[chainId];
  if (!address) {
    throw new ConfigurationError(
      `ZENITH Settlement contract is not deployed or configured for chain ${chainId}.`,
      'ZENITH_SETTLEMENT_NOT_CONFIGURED'
    );
  }
  return address;
}

export function getZenithSolverContract(chainId: string | number): string {
  const address = ZENITH_SOLVER_CONTRACT[chainId];
  if (!address) {
    throw new ConfigurationError(
      `ZENITH Solver contract is not deployed or configured for chain ${chainId}.`,
      'ZENITH_SOLVER_NOT_CONFIGURED'
    );
  }
  return address;
}
