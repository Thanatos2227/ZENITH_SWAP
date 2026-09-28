/**
 * @file networkRegistryValidation.ts
 * @package @zenith/chains
 *
 * 20-Rule Authoritative Registry Validation Engine.
 * Enforces fail-closed validation of network identity, chain namespaces,
 * environments, gas models, finality, and cross-registry boundaries.
 */

import {
  AuthoritativeNetworkIdentity,
  NetworkEnvironment
} from './networkIdentity.types';
import {
  NETWORK_CAPABILITY_HIERARCHY,
  ONBOARDING_PROGRESSION
} from '../capabilities/networkCapabilityTypes';
import { NETWORK_FAMILIES } from '../capabilities/networkFamilies';

export interface ValidationViolation {
  ruleNumber: number;
  ruleName: string;
  networkId: string;
  message: string;
}

export interface RegistryValidationReport {
  isValid: boolean;
  totalNetworksChecked: number;
  violations: ValidationViolation[];
}

export class NetworkRegistryValidationEngine {
  /**
   * Validates an entire registry of AuthoritativeNetworkIdentity records
   * against all 20 authoritative rules.
   * Throws an Error if any violation is detected (fail-closed).
   */
  public static validateRegistry(
    networks: Record<string, AuthoritativeNetworkIdentity> | Map<string, AuthoritativeNetworkIdentity>
  ): RegistryValidationReport {
    const list: AuthoritativeNetworkIdentity[] = networks instanceof Map
      ? Array.from(networks.values())
      : Object.values(networks);

    const violations: ValidationViolation[] = [];

    const allCanonicalIds = new Set(list.map((n) => (n.networkId || '').toLowerCase().trim()));
    const seenNetworkIds = new Set<string>();
    const seenCanonicalNames = new Map<string, string>();
    const seenChainIdentityKeys = new Map<string, string>();
    const seenEvmChainIds = new Map<number, string>();
    const seenAliases = new Map<string, string>();

    for (const net of list) {
      const id = net.networkId;

      // Rule 1: networkId uniqueness & format
      if (!id || typeof id !== 'string' || id.trim() === '' || id !== id.toLowerCase()) {
        violations.push({
          ruleNumber: 1,
          ruleName: 'networkId uniqueness & formatting',
          networkId: id || 'UNKNOWN',
          message: `Network ID must be non-empty lowercase string. Found: "${id}"`
        });
      } else if (seenNetworkIds.has(id)) {
        violations.push({
          ruleNumber: 1,
          ruleName: 'networkId uniqueness & formatting',
          networkId: id,
          message: `Duplicate networkId detected: "${id}"`
        });
      } else {
        seenNetworkIds.add(id);
      }

      // Rule 2: canonicalName uniqueness
      if (!net.canonicalName || net.canonicalName.trim() === '') {
        violations.push({
          ruleNumber: 2,
          ruleName: 'canonicalName uniqueness',
          networkId: id,
          message: `Canonical name is missing for network "${id}"`
        });
      } else {
        const lowerName = net.canonicalName.toLowerCase();
        if (seenCanonicalNames.has(lowerName)) {
          violations.push({
            ruleNumber: 2,
            ruleName: 'canonicalName uniqueness',
            networkId: id,
            message: `Duplicate canonicalName "${net.canonicalName}" already used by "${seenCanonicalNames.get(lowerName)}"`
          });
        } else {
          seenCanonicalNames.set(lowerName, id);
        }
      }

      // Rule 3: family validity
      if (!net.family || !(net.family in NETWORK_FAMILIES)) {
        violations.push({
          ruleNumber: 3,
          ruleName: 'family validity',
          networkId: id,
          message: `Invalid family "${net.family}" for network "${id}". Must be one of: ${Object.keys(NETWORK_FAMILIES).join(', ')}`
        });
      }

      // Rule 4: environment validity
      const validEnvs: NetworkEnvironment[] = ['MAINNET', 'TESTNET', 'DEVNET', 'LOCAL', 'HISTORICAL', 'UNKNOWN'];
      if (!net.environment || !validEnvs.includes(net.environment)) {
        violations.push({
          ruleNumber: 4,
          ruleName: 'environment validity',
          networkId: id,
          message: `Invalid environment "${net.environment}" for network "${id}"`
        });
      }

      // Rule 5: chain identity key uniqueness
      if (!net.networkIdentityKey || net.networkIdentityKey.trim() === '') {
        violations.push({
          ruleNumber: 5,
          ruleName: 'chainIdentityKey uniqueness',
          networkId: id,
          message: `Network identity key is missing for network "${id}"`
        });
      } else {
        const lowerKey = net.networkIdentityKey.toLowerCase();
        if (seenChainIdentityKeys.has(lowerKey)) {
          violations.push({
            ruleNumber: 5,
            ruleName: 'chainIdentityKey uniqueness',
            networkId: id,
            message: `Duplicate networkIdentityKey "${net.networkIdentityKey}" already bound to "${seenChainIdentityKeys.get(lowerKey)}"`
          });
        } else {
          seenChainIdentityKeys.set(lowerKey, id);
        }
      }

      // Rule 6: EVM chain ID uniqueness
      if (net.family === 'EVM') {
        if (typeof net.numericChainId !== 'number' || net.numericChainId <= 0) {
          violations.push({
            ruleNumber: 6,
            ruleName: 'EVM chain ID uniqueness',
            networkId: id,
            message: `EVM network "${id}" must have a positive numeric numericChainId. Found: ${net.numericChainId}`
          });
        } else if (seenEvmChainIds.has(net.numericChainId)) {
          violations.push({
            ruleNumber: 6,
            ruleName: 'EVM chain ID uniqueness',
            networkId: id,
            message: `EVM Chain ID collision: Chain ID ${net.numericChainId} is already registered to "${seenEvmChainIds.get(net.numericChainId)}"`
          });
        } else {
          seenEvmChainIds.set(net.numericChainId, id);
        }
      }

      // Rule 7: Mainnet/Testnet strict separation
      if (net.isMainnet && net.isTestnet) {
        violations.push({
          ruleNumber: 7,
          ruleName: 'Mainnet/Testnet separation',
          networkId: id,
          message: `Network "${id}" cannot be both isMainnet=true and isTestnet=true`
        });
      }
      if (net.isMainnet && net.environment !== 'MAINNET') {
        violations.push({
          ruleNumber: 7,
          ruleName: 'Mainnet/Testnet separation',
          networkId: id,
          message: `Network "${id}" has isMainnet=true but environment is "${net.environment}"`
        });
      }
      if (net.isTestnet && net.environment !== 'TESTNET') {
        violations.push({
          ruleNumber: 7,
          ruleName: 'Mainnet/Testnet separation',
          networkId: id,
          message: `Network "${id}" has isTestnet=true but environment is "${net.environment}"`
        });
      }

      // Rule 8: Alias uniqueness and collision-freedom
      if (Array.isArray(net.aliases)) {
        for (const alias of net.aliases) {
          const lowerAlias = alias.toLowerCase().trim();
          if (lowerAlias === '') continue;
          if (allCanonicalIds.has(lowerAlias) && lowerAlias !== id) {
            violations.push({
              ruleNumber: 8,
              ruleName: 'Alias uniqueness',
              networkId: id,
              message: `Alias collision: Alias "${alias}" collides with canonical networkId "${lowerAlias}"`
            });
          } else if (seenAliases.has(lowerAlias)) {
            violations.push({
              ruleNumber: 8,
              ruleName: 'Alias uniqueness',
              networkId: id,
              message: `Alias collision: Alias "${alias}" is already mapped to "${seenAliases.get(lowerAlias)}", cannot map to "${id}"`
            });
          } else {
            seenAliases.set(lowerAlias, id);
          }
        }
      }

      // Rule 9: Native asset ownership
      if (!net.nativeAsset) {
        violations.push({
          ruleNumber: 9,
          ruleName: 'Native asset ownership',
          networkId: id,
          message: `Native asset metadata missing for network "${id}"`
        });
      } else {
        if (net.nativeAsset.networkId !== id) {
          violations.push({
            ruleNumber: 9,
            ruleName: 'Native asset ownership',
            networkId: id,
            message: `Native asset networkId "${net.nativeAsset.networkId}" does not match parent networkId "${id}"`
          });
        }
        if (net.nativeAsset.family !== net.family) {
          violations.push({
            ruleNumber: 9,
            ruleName: 'Native asset ownership',
            networkId: id,
            message: `Native asset family "${net.nativeAsset.family}" does not match network family "${net.family}"`
          });
        }
        if (net.nativeAsset.isWrappedEquivalent && net.nativeAsset.isGasAsset) {
          violations.push({
            ruleNumber: 9,
            ruleName: 'Native asset ownership',
            networkId: id,
            message: `Wrapped native asset cannot be marked as native isGasAsset=true on "${id}"`
          });
        }
      }

      // Rule 10: Native decimals validity (bounded 0 to 24)
      if (
        typeof net.nativeDecimals !== 'number' ||
        !Number.isInteger(net.nativeDecimals) ||
        net.nativeDecimals < 0 ||
        net.nativeDecimals > 24
      ) {
        violations.push({
          ruleNumber: 10,
          ruleName: 'Native decimals validity',
          networkId: id,
          message: `Native decimals must be an integer between 0 and 24. Found: ${net.nativeDecimals} on "${id}"`
        });
      }
      if (net.nativeAsset && net.nativeAsset.decimals !== net.nativeDecimals) {
        violations.push({
          ruleNumber: 10,
          ruleName: 'Native decimals validity',
          networkId: id,
          message: `Native asset decimals (${net.nativeAsset.decimals}) must match nativeDecimals (${net.nativeDecimals}) on "${id}"`
        });
      }

      // Rule 11: Gas model validity
      if (!net.gasModel || !net.gasModel.modelType) {
        violations.push({
          ruleNumber: 11,
          ruleName: 'Gas model validity',
          networkId: id,
          message: `Gas model missing or invalid on "${id}"`
        });
      } else {
        if (net.family === 'EVM' && !net.gasModel.modelType.startsWith('EVM_')) {
          violations.push({
            ruleNumber: 11,
            ruleName: 'Gas model validity',
            networkId: id,
            message: `EVM network "${id}" must declare an EVM gas model. Found: ${net.gasModel.modelType}`
          });
        }
        if (net.family !== 'EVM' && net.gasModel.modelType.startsWith('EVM_')) {
          violations.push({
            ruleNumber: 11,
            ruleName: 'Gas model validity',
            networkId: id,
            message: `Non-EVM network "${id}" cannot declare EVM gas model "${net.gasModel.modelType}"`
          });
        }
      }

      // Rule 12: Finality model validity
      if (!net.finality || !net.finality.model) {
        violations.push({
          ruleNumber: 12,
          ruleName: 'Finality model validity',
          networkId: id,
          message: `Finality config missing on "${id}"`
        });
      } else {
        const validFinalityStatuses = ['KNOWN', 'RUNTIME_REQUIRED', 'UNKNOWN', 'UNSUPPORTED'];
        if (!validFinalityStatuses.includes(net.finality.status)) {
          violations.push({
            ruleNumber: 12,
            ruleName: 'Finality model validity',
            networkId: id,
            message: `Invalid finality status "${net.finality.status}" on "${id}"`
          });
        }
        if (net.capabilityLevel === 'LIVE_VERIFIED' && net.finality.status === 'UNKNOWN') {
          violations.push({
            ruleNumber: 12,
            ruleName: 'Finality model validity',
            networkId: id,
            message: `Network "${id}" cannot be promoted to LIVE_VERIFIED while finality model is UNKNOWN`
          });
        }
      }

      // Rule 13: RPC identity consistency
      if (Array.isArray(net.rpcEndpoints)) {
        for (const rpc of net.rpcEndpoints) {
          if (rpc.networkId !== id) {
            violations.push({
              ruleNumber: 13,
              ruleName: 'RPC identity consistency',
              networkId: id,
              message: `RPC endpoint "${rpc.url}" has networkId "${rpc.networkId}" but belongs to "${id}"`
            });
          }
          if (rpc.expectedFamily !== net.family) {
            violations.push({
              ruleNumber: 13,
              ruleName: 'RPC identity consistency',
              networkId: id,
              message: `RPC endpoint expectedFamily "${rpc.expectedFamily}" does not match network family "${net.family}"`
            });
          }
          if (rpc.environment !== net.environment) {
            violations.push({
              ruleNumber: 13,
              ruleName: 'RPC identity consistency',
              networkId: id,
              message: `RPC endpoint environment "${rpc.environment}" does not match network environment "${net.environment}"`
            });
          }
        }
      }

      // Rule 14: Explorer metadata consistency
      if (net.explorer) {
        if (net.explorer.networkId !== id) {
          violations.push({
            ruleNumber: 14,
            ruleName: 'Explorer metadata consistency',
            networkId: id,
            message: `Explorer networkId "${net.explorer.networkId}" does not match parent networkId "${id}"`
          });
        }
        if (net.explorer.environment !== net.environment) {
          violations.push({
            ruleNumber: 14,
            ruleName: 'Explorer metadata consistency',
            networkId: id,
            message: `Explorer environment "${net.explorer.environment}" does not match network environment "${net.environment}"`
          });
        }
      }

      // Rule 15: Capability profile consistency
      if (!net.capabilityLevel || !(net.capabilityLevel in NETWORK_CAPABILITY_HIERARCHY)) {
        violations.push({
          ruleNumber: 15,
          ruleName: 'Capability profile consistency',
          networkId: id,
          message: `Invalid capabilityLevel "${net.capabilityLevel}" on "${id}"`
        });
      }
      if (net.capabilityLevel === 'LIVE_VERIFIED' && net.onboardingState !== 'LIVE_VERIFIED') {
        violations.push({
          ruleNumber: 15,
          ruleName: 'Capability profile consistency',
          networkId: id,
          message: `Network "${id}" cannot be LIVE_VERIFIED unless onboardingState is "LIVE_VERIFIED". Found: "${net.onboardingState}"`
        });
      }

      // Rule 16: Onboarding state consistency
      if (!net.onboardingState || !ONBOARDING_PROGRESSION.includes(net.onboardingState as any)) {
        violations.push({
          ruleNumber: 16,
          ruleName: 'Onboarding state consistency',
          networkId: id,
          message: `Invalid onboardingState "${net.onboardingState}" on "${id}"`
        });
      }

      // Rule 17: DEX metadata references
      if (Array.isArray(net.dexRegistryReferences)) {
        for (const dexId of net.dexRegistryReferences) {
          if (!dexId || typeof dexId !== 'string' || dexId.trim() === '') {
            violations.push({
              ruleNumber: 17,
              ruleName: 'DEX metadata references',
              networkId: id,
              message: `Empty or invalid DEX reference on network "${id}"`
            });
          }
        }
      }

      // Rule 18: Bridge metadata references
      if (Array.isArray(net.bridgeRegistryReferences)) {
        for (const bridgeId of net.bridgeRegistryReferences) {
          if (!bridgeId || typeof bridgeId !== 'string' || bridgeId.trim() === '') {
            violations.push({
              ruleNumber: 18,
              ruleName: 'Bridge metadata references',
              networkId: id,
              message: `Empty or invalid bridge reference on network "${id}"`
            });
          }
        }
      }

      // Rule 19: Token registry references
      if (Array.isArray(net.tokenRegistryReferences)) {
        for (const tokenSymbol of net.tokenRegistryReferences) {
          if (!tokenSymbol || typeof tokenSymbol !== 'string' || tokenSymbol.trim() === '') {
            violations.push({
              ruleNumber: 19,
              ruleName: 'Token registry references',
              networkId: id,
              message: `Empty or invalid token reference on network "${id}"`
            });
          }
        }
      }

      // Rule 20: Execution adapter references
      if (!net.executionAdapterReference || typeof net.executionAdapterReference !== 'string') {
        violations.push({
          ruleNumber: 20,
          ruleName: 'Execution adapter references',
          networkId: id,
          message: `Missing execution adapter reference on network "${id}"`
        });
      }
    }

    const isValid = violations.length === 0;

    if (!isValid) {
      const summary = violations
        .map((v) => `[Rule ${v.ruleNumber}: ${v.ruleName}] Network "${v.networkId}": ${v.message}`)
        .join('; ');
      throw new Error(`Authoritative Network Registry Validation Failed with ${violations.length} violation(s): ${summary}`);
    }

    return {
      isValid: true,
      totalNetworksChecked: list.length,
      violations: []
    };
  }

  // ==========================================================================
  // CROSS-SYSTEM BOUNDARY VALIDATION
  // ==========================================================================

  /**
   * Validates a token registration against the authoritative network registry boundary.
   */
  public static validateTokenBoundary(
    token: { networkId: string; symbol: string; address?: string },
    isRegisteredFn: (networkId: string) => boolean
  ): boolean {
    if (!token.networkId || !isRegisteredFn(token.networkId)) {
      throw new Error(`Token Registry Boundary Violation: Token "${token.symbol}" references unknown or uncertified network "${token.networkId}"`);
    }
    return true;
  }

  /**
   * Validates a DEX registration against the authoritative network registry boundary.
   */
  public static validateDexBoundary(
    dex: { networkId: string; dexId: string; routerAddress?: string },
    isRegisteredFn: (networkId: string) => boolean
  ): boolean {
    if (!dex.networkId || !isRegisteredFn(dex.networkId)) {
      throw new Error(`DEX Registry Boundary Violation: DEX "${dex.dexId}" references unknown network "${dex.networkId}"`);
    }
    return true;
  }

  /**
   * Validates a bridge corridor against the authoritative network registry boundary.
   */
  public static validateBridgeBoundary(
    corridor: { sourceNetworkId: string; destNetworkId: string; providerId: string },
    isRegisteredFn: (networkId: string) => boolean
  ): boolean {
    if (!corridor.sourceNetworkId || !isRegisteredFn(corridor.sourceNetworkId)) {
      throw new Error(`Bridge Registry Boundary Violation: Corridor references unknown source network "${corridor.sourceNetworkId}"`);
    }
    if (!corridor.destNetworkId || !isRegisteredFn(corridor.destNetworkId)) {
      throw new Error(`Bridge Registry Boundary Violation: Corridor references unknown destination network "${corridor.destNetworkId}"`);
    }
    return true;
  }
}
