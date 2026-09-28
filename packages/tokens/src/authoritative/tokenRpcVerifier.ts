import type {
  TokenVerificationState,
  TokenVerificationDimensions
} from '@zenith/types';
import {
  defaultAuthoritativeNetworkRegistry,
  defaultAuthoritativeRpcProviderRegistry,
  EvmRpcAdapter,
  INetworkRpcAdapter
} from '@zenith/chains';
import { normalizeTokenAddress } from './addressNormalizer';

export interface Erc20VerificationResult {
  verified: boolean;
  status: TokenVerificationState;
  dimensions: TokenVerificationDimensions;
  symbol?: string;
  name?: string;
  decimals?: number;
  hasBytecode: boolean;
  reason?: string;
}

export class TokenRpcVerifier {
  /**
   * Safe read-only ERC-20 contract verification.
   * Leverages authoritative RPC infrastructure from Task 38.
   * If RPC is unavailable or fails, returns UNKNOWN without synthetic fabrication.
   */
  public static async verifyErc20Token(
    networkId: string,
    rawAddress: string,
    customAdapter?: INetworkRpcAdapter
  ): Promise<Erc20VerificationResult> {
    const network = defaultAuthoritativeNetworkRegistry.getNetwork(networkId);
    if (!network) {
      return {
        verified: false,
        status: 'UNVERIFIED',
        hasBytecode: false,
        reason: `Network "${networkId}" not found in authoritative registry`,
        dimensions: {
          identityVerified: false,
          addressVerified: false,
          standardVerified: false,
          decimalsVerified: false,
          metadataVerified: false,
          contractCodeVerified: false,
          networkVerified: false
        }
      };
    }

    if (network.family !== 'EVM') {
      return {
        verified: false,
        status: 'UNVERIFIED',
        hasBytecode: false,
        reason: `RPC ERC-20 verification unsupported for non-EVM family: ${network.family}`,
        dimensions: {
          identityVerified: false,
          addressVerified: false,
          standardVerified: false,
          decimalsVerified: false,
          metadataVerified: false,
          contractCodeVerified: false,
          networkVerified: false
        }
      };
    }

    let normalizedAddress: string;
    try {
      normalizedAddress = normalizeTokenAddress('EVM', rawAddress, { allowZeroAddress: false });
    } catch (err: any) {
      return {
        verified: false,
        status: 'FAILED_VERIFICATION',
        hasBytecode: false,
        reason: `Address normalization failed: ${err.message}`,
        dimensions: {
          identityVerified: false,
          addressVerified: false,
          standardVerified: false,
          decimalsVerified: false,
          metadataVerified: false,
          contractCodeVerified: false,
          networkVerified: false
        }
      };
    }

    // Resolve RPC adapter
    let adapter = customAdapter;
    if (!adapter) {
      const best = defaultAuthoritativeRpcProviderRegistry.getBestProvider(networkId, 'READ_ONLY');
      if (!best) {
        return {
          verified: false,
          status: 'UNVERIFIED',
          hasBytecode: false,
          reason: `NO_HEALTHY_RPC_PROVIDERS available for network ${networkId}`,
          dimensions: {
            identityVerified: false,
            addressVerified: true,
            standardVerified: false,
            decimalsVerified: false,
            metadataVerified: false,
            contractCodeVerified: false,
            networkVerified: true
          }
        };
      }
      adapter = new EvmRpcAdapter(network, best);
    }

    try {
      // 1. Check bytecode existence
      const code = await adapter.getCodeOrEquivalent(normalizedAddress);
      if (!code || code === '0x' || code === '0x0') {
        return {
          verified: false,
          status: 'FAILED_VERIFICATION',
          hasBytecode: false,
          reason: `Address ${normalizedAddress} has no contract bytecode`,
          dimensions: {
            identityVerified: false,
            addressVerified: true,
            standardVerified: false,
            decimalsVerified: false,
            metadataVerified: false,
            contractCodeVerified: false,
            networkVerified: true
          }
        };
      }

      // 2. Query decimals (0x313ce567), symbol (0x95d89b41), and name (0x06fdde03)
      const decimalsRes = await adapter.simulateTransaction({
        to: normalizedAddress,
        data: '0x313ce567' // decimals()
      });

      let decimals: number | undefined;
      if (decimalsRes.success && decimalsRes.returnData && decimalsRes.returnData !== '0x') {
        try {
          decimals = parseInt(decimalsRes.returnData, 16);
        } catch {
          decimals = undefined;
        }
      }

      const symbolRes = await adapter.simulateTransaction({
        to: normalizedAddress,
        data: '0x95d89b41' // symbol()
      });

      let symbol: string | undefined;
      if (symbolRes.success && symbolRes.returnData && symbolRes.returnData !== '0x') {
        symbol = this.decodeString(symbolRes.returnData);
      }

      const nameRes = await adapter.simulateTransaction({
        to: normalizedAddress,
        data: '0x06fdde03' // name()
      });

      let name: string | undefined;
      if (nameRes.success && nameRes.returnData && nameRes.returnData !== '0x') {
        name = this.decodeString(nameRes.returnData);
      }

      const hasDecimals = decimals !== undefined && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36;
      const hasMetadata = Boolean(symbol && name);

      const isStandardVerified = hasDecimals && Boolean(symbol);

      return {
        verified: isStandardVerified,
        status: isStandardVerified ? 'STANDARD_VERIFIED' : 'CONTRACT_CODE_VERIFIED',
        hasBytecode: true,
        decimals,
        symbol,
        name,
        dimensions: {
          identityVerified: isStandardVerified,
          addressVerified: true,
          standardVerified: isStandardVerified,
          decimalsVerified: hasDecimals,
          metadataVerified: hasMetadata,
          contractCodeVerified: true,
          networkVerified: true
        }
      };
    } catch (err: any) {
      return {
        verified: false,
        status: 'UNVERIFIED',
        hasBytecode: false,
        reason: `RPC verification call failed: ${err.message}`,
        dimensions: {
          identityVerified: false,
          addressVerified: true,
          standardVerified: false,
          decimalsVerified: false,
          metadataVerified: false,
          contractCodeVerified: false,
          networkVerified: true
        }
      };
    }
  }

  private static decodeString(hex: string): string | undefined {
    try {
      const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
      // Handle standard ABI encoded string (offset, length, string bytes)
      if (clean.length >= 128) {
        const lengthHex = clean.slice(64, 128);
        const length = parseInt(lengthHex, 16);
        const dataHex = clean.slice(128, 128 + length * 2);
        return Buffer.from(dataHex, 'hex').toString('utf8').replace(/\0/g, '').trim();
      }
      // Handle bytes32 string (e.g. MKR old pattern)
      if (clean.length === 64) {
        return Buffer.from(clean, 'hex').toString('utf8').replace(/\0/g, '').trim();
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
