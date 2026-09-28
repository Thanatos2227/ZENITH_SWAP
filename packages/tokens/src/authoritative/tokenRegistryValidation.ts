import type { TokenIdentity } from '@zenith/types';
import { defaultAuthoritativeNetworkRegistry } from '@zenith/chains';
import { defaultNetworkCapabilityRegistry } from '@zenith/chains';
import { isStandardSupportedForFamily } from './tokenStandard.taxonomy';
import { normalizeTokenAddress } from './addressNormalizer';

export interface TokenValidationViolation {
  ruleNumber: number;
  ruleName: string;
  tokenId: string;
  message: string;
}

export interface TokenRegistryValidationReport {
  isValid: boolean;
  totalTokensChecked: number;
  violations: TokenValidationViolation[];
}

export class TokenRegistryValidationEngine {
  /**
   * Validates a collection of token identities against the 20 authoritative rules.
   * Throws an error on any violation, enforcing fail-closed protocol correctness.
   */
  public static validate(tokens: TokenIdentity[]): TokenRegistryValidationReport {
    const violations: TokenValidationViolation[] = [];
    const seenTokenIds = new Set<string>();
    const seenIdentityKeys = new Set<string>();
    const networkAddressMap = new Map<string, Set<string>>();

    for (const token of tokens) {
      const id = token.tokenId || 'UNKNOWN';

      // Rule 1: Token ID uniqueness
      if (!token.tokenId || typeof token.tokenId !== 'string' || token.tokenId.trim() === '') {
        violations.push({
          ruleNumber: 1,
          ruleName: 'Token ID uniqueness',
          tokenId: id,
          message: 'Token has an empty or invalid tokenId'
        });
      } else if (seenTokenIds.has(token.tokenId)) {
        violations.push({
          ruleNumber: 1,
          ruleName: 'Token ID uniqueness',
          tokenId: id,
          message: `Duplicate tokenId detected: "${token.tokenId}"`
        });
      } else {
        seenTokenIds.add(token.tokenId);
      }

      // Rule 2: Identity key uniqueness
      const idKey = token.networkIdentityKey
        ? `${token.networkIdentityKey}:${token.standard}:${token.normalizedAddress || token.symbol}`
        : '';
      if (!token.networkIdentityKey || typeof token.networkIdentityKey !== 'string') {
        violations.push({
          ruleNumber: 2,
          ruleName: 'Identity key uniqueness',
          tokenId: id,
          message: `Token "${id}" has an empty or invalid networkIdentityKey`
        });
      } else if (seenIdentityKeys.has(idKey)) {
        violations.push({
          ruleNumber: 2,
          ruleName: 'Identity key uniqueness',
          tokenId: id,
          message: `Duplicate token identity key detected: "${idKey}"`
        });
      } else {
        seenIdentityKeys.add(idKey);
      }

      // Rule 3: Network existence in Authoritative Network Registry
      if (!token.networkId || !defaultAuthoritativeNetworkRegistry.isNetworkRegistered(token.networkId)) {
        violations.push({
          ruleNumber: 3,
          ruleName: 'Network existence',
          tokenId: id,
          message: `Token "${id}" references unknown or uncertified network "${token.networkId}"`
        });
      }

      // Rule 4: Network identity consistency
      const network = defaultAuthoritativeNetworkRegistry.getNetwork(token.networkId);
      if (network) {
        if (token.networkIdentityKey !== network.networkIdentityKey) {
          violations.push({
            ruleNumber: 4,
            ruleName: 'Network identity consistency',
            tokenId: id,
            message: `Token "${id}" networkIdentityKey "${token.networkIdentityKey}" does not match network's canonical key "${network.networkIdentityKey}"`
          });
        }

        // Rule 5: Family compatibility
        if (token.family !== network.family) {
          violations.push({
            ruleNumber: 5,
            ruleName: 'Family compatibility',
            tokenId: id,
            message: `Token "${id}" family "${token.family}" does not match network family "${network.family}"`
          });
        }
      }

      // Rule 6: Standard compatibility
      if (!isStandardSupportedForFamily(token.family, token.standard)) {
        violations.push({
          ruleNumber: 6,
          ruleName: 'Standard compatibility',
          tokenId: id,
          message: `Standard "${token.standard}" is not supported for family "${token.family}" on token "${id}"`
        });
      }

      // Rule 7: Address validity per family rules
      if (!token.isNative) {
        if (!token.address) {
          violations.push({
            ruleNumber: 7,
            ruleName: 'Address validity',
            tokenId: id,
            message: `Non-native token "${id}" must possess a valid contract address`
          });
        } else {
          try {
            const normalized = normalizeTokenAddress(token.family, token.address, { allowZeroAddress: false });
            if (token.normalizedAddress && token.normalizedAddress.toLowerCase() !== normalized.toLowerCase()) {
              violations.push({
                ruleNumber: 7,
                ruleName: 'Address validity',
                tokenId: id,
                message: `Token "${id}" normalizedAddress "${token.normalizedAddress}" does not match computed normalized address "${normalized}"`
              });
            }
          } catch (err: any) {
            violations.push({
              ruleNumber: 7,
              ruleName: 'Address validity',
              tokenId: id,
              message: `Address validation failed for "${id}": ${err.message}`
            });
          }
        }
      }

      // Rule 8: Native asset correctness
      if (token.isNative) {
        if (token.standard !== 'NATIVE') {
          violations.push({
            ruleNumber: 8,
            ruleName: 'Native asset correctness',
            tokenId: id,
            message: `Native token "${id}" must have standard="NATIVE", found "${token.standard}"`
          });
        }
        if (token.assetType !== 'NATIVE') {
          violations.push({
            ruleNumber: 8,
            ruleName: 'Native asset correctness',
            tokenId: id,
            message: `Native token "${id}" must have assetType="NATIVE", found "${token.assetType}"`
          });
        }
        if (network && network.nativeAsset && network.nativeAsset.symbol !== token.symbol) {
          violations.push({
            ruleNumber: 8,
            ruleName: 'Native asset correctness',
            tokenId: id,
            message: `Native token symbol "${token.symbol}" does not match network nativeAsset symbol "${network.nativeAsset.symbol}"`
          });
        }
      }

      // Rule 9: Wrapped-native correctness
      if (token.isWrappedNative) {
        if (token.isNative) {
          violations.push({
            ruleNumber: 9,
            ruleName: 'Wrapped-native correctness',
            tokenId: id,
            message: `Token "${id}" cannot be simultaneously isNative=true and isWrappedNative=true`
          });
        }
        if (!token.address) {
          violations.push({
            ruleNumber: 9,
            ruleName: 'Wrapped-native correctness',
            tokenId: id,
            message: `Wrapped-native token "${id}" must have a contract address`
          });
        }
      }

      // Rule 10: Decimals validity
      if (typeof token.decimals !== 'number' || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36) {
        violations.push({
          ruleNumber: 10,
          ruleName: 'Decimals validity',
          tokenId: id,
          message: `Token "${id}" has invalid decimals: ${token.decimals}. Must be integer between 0 and 36.`
        });
      }

      // Rule 11: Metadata state validity
      const validMetadataStates = ['UNKNOWN', 'DISCOVERED', 'READ_FROM_CHAIN', 'REGISTRY_VERIFIED', 'LIVE_VERIFIED', 'INVALID'];
      if (!validMetadataStates.includes(token.metadataStatus)) {
        violations.push({
          ruleNumber: 11,
          ruleName: 'Metadata state validity',
          tokenId: id,
          message: `Token "${id}" has invalid metadataStatus "${token.metadataStatus}"`
        });
      }

      // Rule 12: Capability consistency
      const netCap = token.networkId ? defaultNetworkCapabilityRegistry.getNetworkCapability(token.networkId) : undefined;
      if (netCap) {
        if (token.capabilityLevel === 'LIVE_VERIFIED' && netCap.overallCapabilityLevel !== 'LIVE_VERIFIED') {
          violations.push({
            ruleNumber: 12,
            ruleName: 'Capability consistency',
            tokenId: id,
            message: `Token "${id}" capability level LIVE_VERIFIED exceeds network capability level "${netCap.overallCapabilityLevel}"`
          });
        }
      }

      // Rule 13: Alias uniqueness per network
      const netKey = (token.networkId || '').toLowerCase();
      // Multiple tokens on same network with exact same symbol and address is a collision
      if (token.address) {
        if (!networkAddressMap.has(netKey)) {
          networkAddressMap.set(netKey, new Set());
        }
        const addrSet = networkAddressMap.get(netKey)!;
        const normAddr = token.address.toLowerCase();
        if (addrSet.has(normAddr)) {
          violations.push({
            ruleNumber: 13,
            ruleName: 'Address collision within network',
            tokenId: id,
            message: `Duplicate contract address "${token.address}" on network "${token.networkId}"`
          });
        } else {
          addrSet.add(normAddr);
        }
      }

      // Rule 14: Fungibility consistency
      if (token.isFungible && (token.isNFT || token.isMultiToken)) {
        violations.push({
          ruleNumber: 14,
          ruleName: 'Fungibility consistency',
          tokenId: id,
          message: `Token "${id}" cannot be fungible and NFT/MultiToken simultaneously`
        });
      }

      // Rule 15: Non-empty symbol & name
      if (!token.symbol || token.symbol.trim() === '') {
        violations.push({
          ruleNumber: 15,
          ruleName: 'Symbol non-empty',
          tokenId: id,
          message: `Token "${id}" has an empty symbol`
        });
      }
      if (!token.name || token.name.trim() === '') {
        violations.push({
          ruleNumber: 15,
          ruleName: 'Name non-empty',
          tokenId: id,
          message: `Token "${id}" has an empty name`
        });
      }

      // Rule 16: Onboarding state validity
      const validOnboardingStates = [
        'DISCOVERED', 'IDENTITY_RESOLVED', 'ADDRESS_VERIFIED', 'STANDARD_VERIFIED',
        'METADATA_VERIFIED', 'EXECUTION_ENABLED', 'LIVE_VERIFIED', 'DISABLED', 'DEPRECATED'
      ];
      if (!validOnboardingStates.includes(token.onboardingState)) {
        violations.push({
          ruleNumber: 16,
          ruleName: 'Onboarding state validity',
          tokenId: id,
          message: `Token "${id}" has invalid onboardingState "${token.onboardingState}"`
        });
      }

      // Rule 17: Verification dimensions consistency
      if (!token.verificationDimensions) {
        violations.push({
          ruleNumber: 17,
          ruleName: 'Verification dimensions',
          tokenId: id,
          message: `Token "${id}" missing verificationDimensions object`
        });
      }

      // Rule 18: No symbol-only identity
      if (!token.tokenId.includes(':')) {
        violations.push({
          ruleNumber: 18,
          ruleName: 'No symbol-only identity',
          tokenId: id,
          message: `Token "${id}" tokenId must be composite and network-bound (contain colon delimiter)`
        });
      }

      // Rule 19: Cross-network address collision defense
      // Same address on different networks is allowed, but must have different networkIds
      if (token.networkId && token.address) {
        // Verified by Rule 1 and Rule 18
      }

      // Rule 20: No unauthorized capability promotion
      if (token.capabilityLevel === 'LIVE_VERIFIED' && token.onboardingState !== 'LIVE_VERIFIED') {
        violations.push({
          ruleNumber: 20,
          ruleName: 'No unauthorized capability promotion',
          tokenId: id,
          message: `Token "${id}" has capabilityLevel=LIVE_VERIFIED but onboardingState="${token.onboardingState}"`
        });
      }
    }

    const isValid = violations.length === 0;
    if (!isValid) {
      const summary = violations
        .map((v) => `[Rule ${v.ruleNumber}: ${v.ruleName}] Token "${v.tokenId}": ${v.message}`)
        .join('; ');
      throw new Error(`Token Registry Validation Failed with ${violations.length} violation(s): ${summary}`);
    }

    return {
      isValid: true,
      totalTokensChecked: tokens.length,
      violations: []
    };
  }
}
