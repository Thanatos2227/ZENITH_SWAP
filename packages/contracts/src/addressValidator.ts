import {
  InvalidAddressError,
  InvalidTokenAddressError,
  InvalidRecipientAddressError,
  InvalidExecutionTargetError
} from './errors';

const FORBIDDEN_PLACEHOLDER_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
  '0x5555555555555555555555555555555555555555',
  '0x6666666666666666666666666666666666666666',
  '0x7777777777777777777777777777777777777777',
  '0x8888888888888888888888888888888888888888',
  '0x9999999999999999999999999999999999999999',
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0xcccccccccccccccccccccccccccccccccccccccc',
  '0xdddddddddddddddddddddddddddddddddddddddd',
  '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead',
  '0x000000000000000000000000000000000000dead'
]);

export const CANONICAL_NATIVE_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const EVM_HEX_REGEX = /^0x[0-9a-fA-F]{40}$/;
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validateEvmAddress(address: string | undefined | null, context = 'EVM Address'): string {
  if (!address || typeof address !== 'string') {
    throw new InvalidAddressError(`[${context}] Address is empty, null, or undefined.`);
  }

  const trimmed = address.trim();
  if (!EVM_HEX_REGEX.test(trimmed)) {
    throw new InvalidAddressError(`[${context}] Invalid EVM address format: "${address}". Must be a 40-hex character string starting with "0x".`);
  }

  const lower = trimmed.toLowerCase();
  if (FORBIDDEN_PLACEHOLDER_ADDRESSES.has(lower)) {
    throw new InvalidAddressError(
      `[${context}] Address "${address}" is a forbidden placeholder/test address. Real production operations cannot target placeholder addresses.`
    );
  }

  return trimmed;
}

export function validateSolanaAddress(address: string | undefined | null, context = 'Solana Address'): string {
  if (!address || typeof address !== 'string') {
    throw new InvalidAddressError(`[${context}] Solana address is empty, null, or undefined.`);
  }

  const trimmed = address.trim();
  if (!BASE58_REGEX.test(trimmed)) {
    throw new InvalidAddressError(`[${context}] Invalid Solana public key format: "${address}". Must be 32-44 Base58 characters.`);
  }

  return trimmed;
}

export function validateTokenAddress(
  address: string | undefined | null,
  chainId: string | number,
  isNative = false
): string {
  if (!address) {
    throw new InvalidTokenAddressError(String(address), chainId, 'Token address is missing');
  }

  if (isNative || address.toLowerCase() === CANONICAL_NATIVE_ADDRESS.toLowerCase()) {
    return CANONICAL_NATIVE_ADDRESS;
  }

  const chainStr = String(chainId).toLowerCase();
  if (chainStr === 'solana') {
    try {
      return validateSolanaAddress(address, `Token on chain ${chainId}`);
    } catch (err: any) {
      throw new InvalidTokenAddressError(address, chainId, err.message);
    }
  }

  try {
    return validateEvmAddress(address, `Token on chain ${chainId}`);
  } catch (err: any) {
    throw new InvalidTokenAddressError(address, chainId, err.message);
  }
}

export function validateRecipientAddress(
  address: string | undefined | null,
  chainId: string | number
): string {
  if (!address) {
    throw new InvalidRecipientAddressError(String(address), chainId, 'Recipient address cannot be empty');
  }

  const chainStr = String(chainId).toLowerCase();
  if (chainStr === 'solana') {
    try {
      return validateSolanaAddress(address, `Recipient on chain ${chainId}`);
    } catch (err: any) {
      throw new InvalidRecipientAddressError(address, chainId, err.message);
    }
  }

  try {
    return validateEvmAddress(address, `Recipient on chain ${chainId}`);
  } catch (err: any) {
    throw new InvalidRecipientAddressError(address, chainId, err.message);
  }
}

export function validateExecutionTarget(
  target: string | undefined | null,
  chainId: string | number
): string {
  if (!target) {
    throw new InvalidExecutionTargetError(String(target), chainId, 'Target contract address is missing');
  }

  const chainStr = String(chainId).toLowerCase();
  if (chainStr === 'solana') {
    try {
      return validateSolanaAddress(target, `Execution target on chain ${chainId}`);
    } catch (err: any) {
      throw new InvalidExecutionTargetError(target, chainId, err.message);
    }
  }

  try {
    return validateEvmAddress(target, `Execution target on chain ${chainId}`);
  } catch (err: any) {
    throw new InvalidExecutionTargetError(target, chainId, err.message);
  }
}

export function validateApprovalTarget(
  spender: string | undefined | null,
  chainId: string | number
): string {
  return validateExecutionTarget(spender, chainId);
}
