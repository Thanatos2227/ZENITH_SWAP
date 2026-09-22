import { UnsupportedProtocolError } from '../errors';

export const DEBRIDGE_DLN_SOURCE_CONTRACTS: Record<number, string> = {
  1: '0xeF4fB24aD0916217251F553c0596F8Edc630EB66',
  10: '0xeF4fB24aD0916217251F553c0596F8Edc630EB66',
  56: '0xeF4fB24aD0916217251F553c0596F8Edc630EB66',
  137: '0xeF4fB24aD0916217251F553c0596F8Edc630EB66',
  8453: '0xeF4fB24aD0916217251F553c0596F8Edc630EB66',
  42161: '0xeF4fB24aD0916217251F553c0596F8Edc630EB66',
  43114: '0xeF4fB24aD0916217251F553c0596F8Edc630EB66',
  59144: '0xeF4fB24aD0916217251F553c0596F8Edc630EB66'
};

export const DEBRIDGE_DLN_SOURCE = DEBRIDGE_DLN_SOURCE_CONTRACTS;

export const DEBRIDGE_DLN_DESTINATION_CONTRACTS: Record<number, string> = {
  1: '0xE7351Fd770A37282b91D153Ee690B63579D6dd7f',
  10: '0xE7351Fd770A37282b91D153Ee690B63579D6dd7f',
  56: '0xE7351Fd770A37282b91D153Ee690B63579D6dd7f',
  137: '0xE7351Fd770A37282b91D153Ee690B63579D6dd7f',
  8453: '0xE7351Fd770A37282b91D153Ee690B63579D6dd7f',
  42161: '0xE7351Fd770A37282b91D153Ee690B63579D6dd7f',
  43114: '0xE7351Fd770A37282b91D153Ee690B63579D6dd7f',
  59144: '0xE7351Fd770A37282b91D153Ee690B63579D6dd7f'
};

export const DEBRIDGE_DLN_SOURCE_ABI = [
  'function createOrder((address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverAddress, bytes allowedTaker, bytes allowedCancelBeneficiary, bytes externalCall) orderCreation, bytes affiliateFee, uint32 referralCode, bytes permitEnvelope) external payable returns (bytes32 orderId)'
];

export function getDeBridgeSourceContract(chainId: number): string {
  const contract = DEBRIDGE_DLN_SOURCE_CONTRACTS[chainId];
  if (!contract) {
    throw new UnsupportedProtocolError('DEBRIDGE_DLN', chainId);
  }
  return contract;
}

export function isDeBridgeSupported(chainId: number): boolean {
  return Boolean(DEBRIDGE_DLN_SOURCE_CONTRACTS[chainId]);
}
