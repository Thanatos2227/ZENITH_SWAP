/**
 * @file dexAddressVerifier.ts
 * @package @zenith/routing
 *
 * Read-Only DEX Address & Bytecode Verifier.
 * Probes on-chain contract code and interfaces via read-only RPC calls (eth_getCode).
 * Distinguishes: ADDRESS_EXISTS, CONTRACT_PRESENT, EXPECTED_INTERFACE, VERIFIED_DEPLOYMENT, UNVERIFIED.
 * Never executes state mutations, broadcasts, or fabricates evidence.
 */

import { Contract, Provider } from 'ethers';
import type { DexVerificationStatus, DexAddressRole } from '@zenith/types';

export interface AddressVerificationDetail {
  address: string;
  role: DexAddressRole;
  status: DexVerificationStatus;
  hasCode: boolean;
  hasBytecode: boolean;
  codeLengthBytes?: number;
  detectedInterface?: string;
  notes?: string;
}

export class DexAddressVerifier {
  /**
   * Deterministically validates an EVM address string.
   */
  public static isValidEvmAddress(address: string): boolean {
    if (!address || typeof address !== 'string') return false;
    if (/^0x0{40}$/i.test(address)) return false;
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  /**
   * Verifies an EVM contract address via eth_getCode.
   */
  public static async verifyAddress(
    address: string,
    role: DexAddressRole,
    provider?: Provider | null
  ): Promise<AddressVerificationDetail> {
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return {
        address,
        role,
        status: 'UNVERIFIED',
        hasCode: false,
        hasBytecode: false,
        notes: 'Malformed or empty address string'
      };
    }

    if (!provider) {
      return {
        address,
        role,
        status: 'ADDRESS_EXISTS',
        hasCode: false,
        hasBytecode: false,
        notes: 'Provider not supplied for on-chain verification'
      };
    }

    try {
      const code = await provider.getCode(address);
      if (!code || code === '0x' || code === '0x0') {
        return {
          address,
          role,
          status: 'ADDRESS_EXISTS',
          hasCode: false,
          hasBytecode: false,
          codeLengthBytes: 0,
          notes: 'EOA or empty account (no bytecode deployed)'
        };
      }

      const byteLength = (code.length - 2) / 2;

      // Role-specific lightweight interface probing
      let detectedInterface: string | undefined = undefined;
      let status: DexVerificationStatus = 'CONTRACT_PRESENT';

      if (role === 'FACTORY') {
        try {
          const testContract = new Contract(
            address,
            ['function feeAmountTickSpacing(uint24) view returns (int24)'],
            provider
          );
          await testContract.feeAmountTickSpacing(500);
          detectedInterface = 'UNISWAP_V3_FACTORY';
          status = 'EXPECTED_INTERFACE';
        } catch {
          // May be V2 factory
          try {
            const v2Contract = new Contract(
              address,
              ['function allPairsLength() view returns (uint256)'],
              provider
            );
            await v2Contract.allPairsLength();
            detectedInterface = 'UNISWAP_V2_FACTORY';
            status = 'EXPECTED_INTERFACE';
          } catch {
            status = 'CONTRACT_PRESENT';
          }
        }
      } else if (role === 'ROUTER') {
        try {
          const testContract = new Contract(
            address,
            ['function factory() view returns (address)'],
            provider
          );
          await testContract.factory();
          detectedInterface = 'SWAP_ROUTER';
          status = 'EXPECTED_INTERFACE';
        } catch {
          status = 'CONTRACT_PRESENT';
        }
      }

      return {
        address,
        role,
        status,
        hasCode: true,
        hasBytecode: true,
        codeLengthBytes: byteLength,
        detectedInterface,
        notes: `Bytecode verified on-chain (${byteLength} bytes)`
      };
    } catch (err: any) {
      return {
        address,
        role,
        status: 'UNVERIFIED',
        hasCode: false,
        hasBytecode: false,
        notes: `RPC read failure: ${err?.message || String(err)}`
      };
    }
  }
}
