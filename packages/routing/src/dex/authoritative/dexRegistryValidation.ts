import type { DexIdentity, DexValidationResult } from '@zenith/types';
import { defaultAuthoritativeNetworkRegistry, AuthoritativeNetworkRegistry } from '@zenith/chains';
import { DexNetworkMismatchError, DexEnvironmentMismatchError, DexFamilyMismatchError, ZERO_ADDRESS } from '@zenith/contracts';
import { isFungibleStandard, isStandardSupportedForFamily } from '@zenith/tokens';
export class DexRegistryValidation {
    public static validateSingle(dex: DexIdentity, networkRegistry: AuthoritativeNetworkRegistry = defaultAuthoritativeNetworkRegistry): DexValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        if (!dex.dexId || typeof dex.dexId !== 'string' || dex.dexId.trim() === '') {
            errors.push('dexId is required and must be non-empty');
        }
        if (!dex.canonicalName || typeof dex.canonicalName !== 'string') {
            errors.push('canonicalName is required and must be non-empty');
        }
        if (!dex.networkId || typeof dex.networkId !== 'string') {
            errors.push('networkId is required and must be non-empty');
        }
        if (!dex.protocolFamily || typeof dex.protocolFamily !== 'string') {
            errors.push('protocolFamily is required and must be non-empty');
        }
        const net = networkRegistry.getNetwork(dex.networkId);
        if (!net) {
            throw new DexNetworkMismatchError(dex.dexId, dex.networkId, 'UNKNOWN_OR_UNREGISTERED_NETWORK');
        }
        const isMainnetNet = net.isMainnet;
        const isTestnetNet = net.isTestnet;
        const isDevnet = net.environment === 'DEVNET' || net.environment === 'LOCAL';
        if (dex.deploymentId && dex.deploymentId.includes('testnet') && isMainnetNet) {
            throw new DexEnvironmentMismatchError(dex.dexId, 'TESTNET', 'MAINNET');
        }
        if (dex.deploymentId && dex.deploymentId.includes('mainnet') && isTestnetNet && !isDevnet) {
            throw new DexEnvironmentMismatchError(dex.dexId, 'MAINNET', 'TESTNET');
        }
        if (dex.family !== net.family) {
            throw new DexFamilyMismatchError(dex.dexId, net.family, dex.family);
        }
        if (dex.networkIdentityKey && dex.networkIdentityKey !== net.networkIdentityKey) {
            throw new DexNetworkMismatchError(dex.dexId, net.networkIdentityKey, dex.networkIdentityKey);
        }
        if (dex.family === 'EVM') {
            if (!dex.routerAddress || dex.routerAddress === ZERO_ADDRESS) {
                errors.push(`routerAddress is invalid or ZeroAddress on EVM DEX "${dex.dexId}"`);
            }
            else if (!/^0x[a-fA-F0-9]{40}$/.test(dex.routerAddress)) {
                errors.push(`routerAddress "${dex.routerAddress}" is not a valid 20-byte EVM hex address on DEX "${dex.dexId}"`);
            }
            if (!dex.factoryAddress || dex.factoryAddress === ZERO_ADDRESS) {
                errors.push(`factoryAddress is invalid or ZeroAddress on EVM DEX "${dex.dexId}"`);
            }
            else if (!/^0x[a-fA-F0-9]{40}$/.test(dex.factoryAddress)) {
                errors.push(`factoryAddress "${dex.factoryAddress}" is not a valid 20-byte EVM hex address on DEX "${dex.dexId}"`);
            }
            if (dex.quoterAddress) {
                if (!/^0x[a-fA-F0-9]{40}$/.test(dex.quoterAddress) || dex.quoterAddress === ZERO_ADDRESS) {
                    errors.push(`quoterAddress "${dex.quoterAddress}" is invalid on EVM DEX "${dex.dexId}"`);
                }
            }
            if (dex.universalRouterAddress) {
                if (!/^0x[a-fA-F0-9]{40}$/.test(dex.universalRouterAddress) || dex.universalRouterAddress === ZERO_ADDRESS) {
                    errors.push(`universalRouterAddress "${dex.universalRouterAddress}" is invalid on EVM DEX "${dex.dexId}"`);
                }
            }
        }
        if (!Array.isArray(dex.supportedTokenStandards) || dex.supportedTokenStandards.length === 0) {
            errors.push(`DEX "${dex.dexId}" must declare at least one supported token standard`);
        }
        else {
            for (const std of dex.supportedTokenStandards) {
                if (!isStandardSupportedForFamily(dex.family, std)) {
                    errors.push(`Token standard "${std}" is not supported for network family "${dex.family}" on DEX "${dex.dexId}"`);
                }
                if (!isFungibleStandard(std)) {
                    errors.push(`Non-fungible token standard "${std}" cannot be registered as swap-compatible on DEX "${dex.dexId}"`);
                }
            }
        }
        if (dex.capabilityLevel === 'LIVE_VERIFIED' && dex.onboardingState !== 'LIVE_VERIFIED') {
            warnings.push(`DEX "${dex.dexId}" declares LIVE_VERIFIED capability but onboarding state is "${dex.onboardingState}"`);
        }
        if (dex.capabilityLevel === 'EXECUTION_AVAILABLE' && (dex.onboardingState === 'DISCOVERED' || dex.onboardingState === 'CONFIGURED')) {
            errors.push(`DEX "${dex.dexId}" cannot have capability EXECUTION_AVAILABLE while in onboarding state "${dex.onboardingState}"`);
        }
        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }
    public static validate(dex: DexIdentity | readonly DexIdentity[], networkRegistry: AuthoritativeNetworkRegistry = defaultAuthoritativeNetworkRegistry): DexValidationResult & {
        violations: Array<{
            message: string;
        }>;
    } {
        if (Array.isArray(dex)) {
            const allErrors: string[] = [];
            const allWarnings: string[] = [];
            for (const d of dex) {
                const res = this.validateSingle(d, networkRegistry);
                allErrors.push(...res.errors);
                allWarnings.push(...res.warnings);
            }
            return {
                isValid: allErrors.length === 0,
                errors: allErrors,
                warnings: allWarnings,
                violations: allErrors.map((msg) => ({ message: msg }))
            };
        }
        else {
            const single = dex as DexIdentity;
            const res = this.validateSingle(single, networkRegistry);
            return {
                ...res,
                violations: res.errors.map((msg) => ({ message: msg }))
            };
        }
    }
    public static assertValidDex(dex: DexIdentity, networkRegistry: AuthoritativeNetworkRegistry = defaultAuthoritativeNetworkRegistry): void {
        const res = this.validateSingle(dex, networkRegistry);
        if (!res.isValid) {
            throw new Error(`DEX validation failed for "${dex.dexId}": ${res.errors.join('; ')}`);
        }
    }
}
export const DexRegistryValidationEngine = DexRegistryValidation;
