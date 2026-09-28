import type { NetworkFamily } from '@zenith/types';
export class InvalidTokenAddressError extends Error {
    public readonly code = 'INVALID_TOKEN_ADDRESS';
    public readonly family: NetworkFamily;
    public readonly address: string;
    constructor(message: string, family: NetworkFamily, address: string) {
        super(message);
        this.name = 'InvalidTokenAddressError';
        this.family = family;
        this.address = address;
        Object.setPrototypeOf(this, InvalidTokenAddressError.prototype);
    }
}
export class UnsupportedAddressFamilyError extends Error {
    public readonly code = 'UNSUPPORTED_ADDRESS_FAMILY';
    public readonly family: string;
    constructor(family: string) {
        super(`Unsupported address family for token normalization: ${family}`);
        this.name = 'UnsupportedAddressFamilyError';
        this.family = family;
        Object.setPrototypeOf(this, UnsupportedAddressFamilyError.prototype);
    }
}
const EVM_HEX_REGEX = /^0x[0-9a-fA-F]{40}$/;
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BECH32_COSMOS_REGEX = /^([a-z0-9]{1,83}1[ac-hj-np-z0-9]{38,58}|ibc\/[0-9A-Fa-f]{64}|u[a-z0-9]{2,12})$/;
const MOVE_STRUCT_REGEX = /^0x[0-9a-fA-F]{1,64}(::[a-zA-Z0-9_]+::[a-zA-Z0-9_]+)?$/;
const BITCOIN_UTXO_REGEX = /^(bc1[ac-hj-np-z0-9]{11,71}|tb1[ac-hj-np-z0-9]{11,71}|[13mn2][a-km-zA-HJ-NP-Z1-9]{25,34}|(ord|rune):[a-z0-9_•]+)$/i;
const TON_ADDRESS_REGEX = /^(-1|0):[0-9a-fA-F]{64}$|^[EQ][a-zA-Z0-9_-]{47}$/;
const XRPL_ADDRESS_REGEX = /^r[1-9A-HJ-NP-Za-km-z]{24,35}$/;
const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;
const ICP_PRINCIPAL_REGEX = /^([a-z0-9]{5}-){1,10}[a-z0-9]{3,5}$|^[0-9a-fA-F]{64}$/;
const ZERO_EVM_ADDRESS = `0x${'0'.repeat(40)}`;
const FORBIDDEN_EVM_PLACEHOLDERS = new Set([
    ZERO_EVM_ADDRESS,
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',
    '0x4444444444444444444444444444444444444444',
    '0x5555555555555555555555555555555555555555',
    '0x6666666666666666666666666666666666666666',
    '0x7777777777777777777777777777777777777777',
    '0x8888888888888888888888888888888888888888',
    '0x9999999999999999999999999999999999999999',
    '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead',
    '0x000000000000000000000000000000000000dead'
]);
export interface NormalizationOptions {
    allowZeroAddress?: boolean;
    allowNativeSentinel?: boolean;
}
export function normalizeTokenAddress(family: NetworkFamily, address: string | undefined | null, options: NormalizationOptions = {}): string {
    if (!address || typeof address !== 'string') {
        throw new InvalidTokenAddressError('Token address is empty, null, or undefined', family, String(address));
    }
    const trimmed = address.trim();
    if (trimmed.length === 0) {
        throw new InvalidTokenAddressError('Token address is empty whitespace', family, address);
    }
    switch (family) {
        case 'EVM': {
            if (!EVM_HEX_REGEX.test(trimmed)) {
                throw new InvalidTokenAddressError(`Invalid EVM token address format: "${address}". Expected 40 hex characters prefixed with "0x".`, family, address);
            }
            const lower = trimmed.toLowerCase();
            if (!options.allowZeroAddress && lower === ZERO_EVM_ADDRESS) {
                throw new InvalidTokenAddressError('Token address cannot be the zero address (0x00...00)', family, address);
            }
            if (FORBIDDEN_EVM_PLACEHOLDERS.has(lower) && (!options.allowZeroAddress || lower !== ZERO_EVM_ADDRESS)) {
                throw new InvalidTokenAddressError(`Forbidden EVM placeholder address: "${address}". Real token contracts cannot target test placeholders.`, family, address);
            }
            return lower;
        }
        case 'SOLANA': {
            if (!BASE58_REGEX.test(trimmed)) {
                throw new InvalidTokenAddressError(`Invalid Solana token address format: "${address}". Expected 32-44 Base58 characters.`, family, address);
            }
            return trimmed;
        }
        case 'MOVE': {
            if (!MOVE_STRUCT_REGEX.test(trimmed)) {
                throw new InvalidTokenAddressError(`Invalid Move token address format: "${address}". Expected Move struct identifier or hex account.`, family, address);
            }
            return trimmed;
        }
        case 'COSMOS': {
            if (!BECH32_COSMOS_REGEX.test(trimmed)) {
                throw new InvalidTokenAddressError(`Invalid Cosmos token address / denom format: "${address}". Expected bech32 or IBC denom.`, family, address);
            }
            return trimmed;
        }
        case 'BITCOIN':
        case 'UTXO': {
            if (!BITCOIN_UTXO_REGEX.test(trimmed)) {
                throw new InvalidTokenAddressError(`Invalid Bitcoin/UTXO token address format: "${address}". Expected bech32, base58check, or ord/rune identifier.`, family, address);
            }
            return trimmed;
        }
        case 'TON':
        case 'TVM': {
            if (!TON_ADDRESS_REGEX.test(trimmed)) {
                throw new InvalidTokenAddressError(`Invalid TON token address format: "${address}". Expected raw address or Base64url user-friendly address.`, family, address);
            }
            return trimmed;
        }
        case 'XRPL': {
            if (!XRPL_ADDRESS_REGEX.test(trimmed)) {
                throw new InvalidTokenAddressError(`Invalid XRPL token address format: "${address}". Expected valid Ripple r-address.`, family, address);
            }
            return trimmed;
        }
        case 'STELLAR': {
            if (!STELLAR_ADDRESS_REGEX.test(trimmed)) {
                throw new InvalidTokenAddressError(`Invalid Stellar token address format: "${address}". Expected valid G-address (Strkey).`, family, address);
            }
            return trimmed;
        }
        case 'ICP': {
            if (!ICP_PRINCIPAL_REGEX.test(trimmed)) {
                throw new InvalidTokenAddressError(`Invalid ICP token identifier format: "${address}". Expected principal ID or 64-hex account.`, family, address);
            }
            return trimmed;
        }
        case 'SUBSTRATE': {
            if (trimmed.length < 5 || trimmed.length > 100) {
                throw new InvalidTokenAddressError(`Invalid Substrate token address format: "${address}".`, family, address);
            }
            return trimmed;
        }
        case 'NEAR': {
            if (trimmed.length < 2 || trimmed.length > 64) {
                throw new InvalidTokenAddressError(`Invalid NEAR token address format: "${address}".`, family, address);
            }
            return trimmed;
        }
        default:
            throw new UnsupportedAddressFamilyError(family);
    }
}
