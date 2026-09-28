import type {
  TokenIdentity,
  TokenConflictEvaluation
} from '@zenith/types';

export class TokenMetadataConflictEngine {
  /**
   * Compares candidate token metadata against a canonical token identity.
   * Enforces fail-closed evaluation on critical dimensions (decimals, network, standard).
   */
  public static evaluate(
    canonical: TokenIdentity,
    candidate: {
      networkId?: string;
      standard?: string;
      address?: string;
      symbol?: string;
      name?: string;
      decimals?: number;
      contractCode?: string;
    }
  ): TokenConflictEvaluation {
    // 1. Network Conflict
    if (candidate.networkId && candidate.networkId.trim().toLowerCase() !== canonical.networkId.trim().toLowerCase()) {
      return {
        category: 'IDENTITY_CONFLICT',
        conflictType: 'NETWORK_CONFLICT',
        details: `Network ID mismatch: Canonical is "${canonical.networkId}", candidate reported "${candidate.networkId}"`,
        canProceed: false
      };
    }

    // 2. Standard Conflict
    if (candidate.standard && candidate.standard.trim().toUpperCase() !== canonical.standard.trim().toUpperCase()) {
      return {
        category: 'IDENTITY_CONFLICT',
        conflictType: 'STANDARD_CONFLICT',
        details: `Token standard mismatch: Canonical is "${canonical.standard}", candidate reported "${candidate.standard}"`,
        canProceed: false
      };
    }

    // 3. Address Conflict (for contract tokens)
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

    // 4. Decimals Conflict (CRITICAL: Fail-Closed)
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

    // 5. Symbol Conflict
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

    // 6. Name Conflict
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

    // 7. Complete Agreement
    return {
      category: 'AGREEMENT',
      conflictType: 'NONE',
      details: 'Candidate token data agrees with canonical token identity',
      canProceed: true
    };
  }
}
