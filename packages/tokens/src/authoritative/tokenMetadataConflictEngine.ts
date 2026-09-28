import type { TokenIdentity, TokenConflictEvaluation } from '@zenith/types';
export class TokenMetadataConflictEngine {
    public static evaluate(canonical: TokenIdentity, candidate: {
        networkId?: string;
        standard?: string;
        address?: string;
        symbol?: string;
        name?: string;
        decimals?: number;
        contractCode?: string;
    }): TokenConflictEvaluation {
        if (candidate.networkId && candidate.networkId.trim().toLowerCase() !== canonical.networkId.trim().toLowerCase()) {
            return {
                category: 'IDENTITY_CONFLICT',
                conflictType: 'NETWORK_CONFLICT',
                details: `Network ID mismatch: Canonical is "${canonical.networkId}", candidate reported "${candidate.networkId}"`,
                canProceed: false
            };
        }
        if (candidate.standard && candidate.standard.trim().toUpperCase() !== canonical.standard.trim().toUpperCase()) {
            return {
                category: 'IDENTITY_CONFLICT',
                conflictType: 'STANDARD_CONFLICT',
                details: `Token standard mismatch: Canonical is "${canonical.standard}", candidate reported "${candidate.standard}"`,
                canProceed: false
            };
        }
        if (candidate.address && canonical.normalizedAddress) {
            const candNorm = candidate.address.trim().toLowerCase();
            if (candNorm !== canonical.normalizedAddress.toLowerCase()) {
                return {
                    category: 'IDENTITY_CONFLICT',
                    conflictType: 'CONTRACT_CODE_CONFLICT',
                    details: `Contract address mismatch: Canonical is "${canonical.normalizedAddress}", candidate reported "${candidate.address}"`,
                    canProceed: false
                };
            }
        }
        if (candidate.decimals !== undefined && candidate.decimals !== null) {
            if (typeof candidate.decimals !== 'number' || !Number.isInteger(candidate.decimals) || candidate.decimals < 0) {
                return {
                    category: 'MATERIAL_CONFLICT',
                    conflictType: 'DECIMALS_CONFLICT',
                    details: `Invalid candidate decimals: ${candidate.decimals}. Must be non-negative integer.`,
                    canProceed: false
                };
            }
            if (candidate.decimals !== canonical.decimals) {
                return {
                    category: 'MATERIAL_CONFLICT',
                    conflictType: 'DECIMALS_CONFLICT',
                    details: `CRITICAL DECIMALS CONFLICT: Canonical is ${canonical.decimals}, candidate reported ${candidate.decimals}. Execution must fail closed.`,
                    canProceed: false
                };
            }
        }
        if (candidate.symbol) {
            const candSym = candidate.symbol.trim().toUpperCase();
            const canonSym = canonical.symbol.trim().toUpperCase();
            if (candSym !== canonSym) {
                return {
                    category: 'MATERIAL_CONFLICT',
                    conflictType: 'SYMBOL_CONFLICT',
                    details: `Symbol conflict: Canonical is "${canonical.symbol}", candidate reported "${candidate.symbol}". Cannot overwrite canonical symbol.`,
                    canProceed: false
                };
            }
        }
        if (candidate.name) {
            const candName = candidate.name.trim();
            if (candName.toLowerCase() !== canonical.name.toLowerCase()) {
                return {
                    category: 'EXPECTED_VARIANCE',
                    conflictType: 'NAME_CONFLICT',
                    details: `Minor name variance: Canonical is "${canonical.name}", candidate reported "${candidate.name}"`,
                    canProceed: true
                };
            }
        }
        return {
            category: 'AGREEMENT',
            conflictType: 'NONE',
            details: 'Candidate token data agrees with canonical token identity',
            canProceed: true
        };
    }
}
