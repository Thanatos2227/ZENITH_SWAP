import type { DexIdentity, DexConflictEvaluation } from '@zenith/types';
export class DexMetadataConflictEngine {
    public static evaluate(primary: DexIdentity, candidate: Partial<DexIdentity>): DexConflictEvaluation {
        if (candidate.networkId && candidate.networkId.toLowerCase() !== primary.networkId.toLowerCase()) {
            return {
                category: 'IDENTITY_CONFLICT',
                conflictType: 'NETWORK_CONFLICT',
                details: `Network mismatch: primary is on "${primary.networkId}", candidate declares "${candidate.networkId}"`,
                canProceed: false
            };
        }
        if (candidate.networkIdentityKey &&
            candidate.networkIdentityKey.toLowerCase() !== primary.networkIdentityKey.toLowerCase()) {
            return {
                category: 'IDENTITY_CONFLICT',
                conflictType: 'NETWORK_CONFLICT',
                details: `NetworkIdentityKey mismatch: primary has "${primary.networkIdentityKey}", candidate has "${candidate.networkIdentityKey}"`,
                canProceed: false
            };
        }
        if (candidate.deploymentId &&
            candidate.deploymentId.toLowerCase() !== primary.deploymentId.toLowerCase()) {
            return {
                category: 'IDENTITY_CONFLICT',
                conflictType: 'DEPLOYMENT_CONFLICT',
                details: `Deployment ID mismatch: primary has "${primary.deploymentId}", candidate has "${candidate.deploymentId}"`,
                canProceed: false
            };
        }
        if (candidate.version &&
            candidate.version.toUpperCase() !== primary.version.toUpperCase()) {
            return {
                category: 'MATERIAL_CONFLICT',
                conflictType: 'PROTOCOL_VERSION_CONFLICT',
                details: `Protocol version mismatch: primary version "${primary.version}", candidate version "${candidate.version}"`,
                canProceed: false
            };
        }
        if (candidate.routerAddress &&
            candidate.routerAddress.toLowerCase() !== primary.routerAddress.toLowerCase()) {
            if (primary.universalRouterAddress &&
                candidate.routerAddress.toLowerCase() === primary.universalRouterAddress.toLowerCase()) {
                return {
                    category: 'EXPECTED_VARIANCE',
                    conflictType: 'ROUTER_ADDRESS_CONFLICT',
                    details: `Candidate router matches registered Universal Router address "${primary.universalRouterAddress}"`,
                    canProceed: true
                };
            }
            return {
                category: 'MATERIAL_CONFLICT',
                conflictType: 'ROUTER_ADDRESS_CONFLICT',
                details: `Router address mismatch: primary is "${primary.routerAddress}", candidate is "${candidate.routerAddress}"`,
                canProceed: false
            };
        }
        if (candidate.factoryAddress &&
            candidate.factoryAddress.toLowerCase() !== primary.factoryAddress.toLowerCase()) {
            return {
                category: 'MATERIAL_CONFLICT',
                conflictType: 'FACTORY_ADDRESS_CONFLICT',
                details: `Factory address mismatch: primary is "${primary.factoryAddress}", candidate is "${candidate.factoryAddress}"`,
                canProceed: false
            };
        }
        if (candidate.quoterAddress &&
            primary.quoterAddress &&
            candidate.quoterAddress.toLowerCase() !== primary.quoterAddress.toLowerCase()) {
            return {
                category: 'EXPECTED_VARIANCE',
                conflictType: 'QUOTER_ADDRESS_CONFLICT',
                details: `Quoter address variant: primary is "${primary.quoterAddress}", candidate is "${candidate.quoterAddress}"`,
                canProceed: true
            };
        }
        if (candidate.supportedTokenStandards) {
            const primaryStandards = new Set(primary.supportedTokenStandards);
            for (const std of candidate.supportedTokenStandards) {
                if (!primaryStandards.has(std)) {
                    return {
                        category: 'MATERIAL_CONFLICT',
                        conflictType: 'TOKEN_STANDARD_CONFLICT',
                        details: `Unsupported token standard "${std}" declared by candidate; not in primary [${primary.supportedTokenStandards.join(', ')}]`,
                        canProceed: false
                    };
                }
            }
        }
        if (candidate.poolDiscoveryMethod &&
            candidate.poolDiscoveryMethod !== primary.poolDiscoveryMethod) {
            return {
                category: 'EXPECTED_VARIANCE',
                conflictType: 'POOL_DISCOVERY_CONFLICT',
                details: `Pool discovery method difference: primary is "${primary.poolDiscoveryMethod}", candidate is "${candidate.poolDiscoveryMethod}"`,
                canProceed: true
            };
        }
        return {
            category: 'AGREEMENT',
            conflictType: 'NONE',
            details: 'DEX metadata is in full agreement.',
            canProceed: true
        };
    }
}
