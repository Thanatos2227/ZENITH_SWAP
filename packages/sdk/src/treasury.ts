import { Contract, Provider } from 'ethers';
import {
  ZENITH_TREASURY_ABI,
  ZENITH_FEE_CONTROLLER_ABI,
  getZenithTreasuryAddress,
  getZenithFeeController
} from '@zenith/contracts';
import { ZenithTreasuryInfo } from './types';

export async function getTreasuryInfo(
  provider: Provider,
  chainId: number
): Promise<ZenithTreasuryInfo> {
  const treasuryAddress = getZenithTreasuryAddress(chainId);
  const feeControllerAddress = getZenithFeeController(chainId);

  if (!treasuryAddress) {
    throw new Error(`ZENITH_TREASURY_NOT_CONFIGURED for chain ${chainId}`);
  }
  if (!feeControllerAddress) {
    throw new Error(`ZENITH_FEE_CONTROLLER_NOT_CONFIGURED for chain ${chainId}`);
  }

  const treasuryContract = new Contract(treasuryAddress, ZENITH_TREASURY_ABI, provider);
  const feeControllerContract = new Contract(feeControllerAddress, ZENITH_FEE_CONTROLLER_ABI, provider);

  const [owner, protocolFeeBps] = await Promise.all([
    treasuryContract.governance(),
    feeControllerContract.protocolFeeBps()
  ]);

  return {
    chainId,
    treasuryAddress,
    feeControllerAddress,
    defaultFeeBps: Number(protocolFeeBps),
    owner
  };
}
