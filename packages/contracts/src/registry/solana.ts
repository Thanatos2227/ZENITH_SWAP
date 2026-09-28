import { RAYDIUM_AMM_V4_PROGRAM_ID, RAYDIUM_CLMM_PROGRAM_ID, RAYDIUM_ROUTER_PROGRAM_ID } from '../protocols/raydium';
import { ORCA_WHIRLPOOL_PROGRAM_ID } from '../protocols/orca';
import { METEORA_DLMM_PROGRAM_ID, METEORA_DYNAMIC_POOLS_PROGRAM_ID } from '../protocols/meteora';
import { UnsupportedProtocolError } from '../errors';
export class SolanaProgramRegistry {
    public static readonly WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
    public static readonly TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    public static readonly ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
    public static getProgramId(protocol: string): string {
        switch (protocol.toUpperCase()) {
            case 'RAYDIUM':
            case 'RAYDIUM_AMM_V4':
                return RAYDIUM_AMM_V4_PROGRAM_ID;
            case 'RAYDIUM_CLMM':
                return RAYDIUM_CLMM_PROGRAM_ID;
            case 'RAYDIUM_ROUTER':
                return RAYDIUM_ROUTER_PROGRAM_ID;
            case 'ORCA':
            case 'ORCA_WHIRLPOOL':
                return ORCA_WHIRLPOOL_PROGRAM_ID;
            case 'METEORA':
            case 'METEORA_DLMM':
                return METEORA_DLMM_PROGRAM_ID;
            case 'METEORA_DYNAMIC':
                return METEORA_DYNAMIC_POOLS_PROGRAM_ID;
            default:
                throw new UnsupportedProtocolError(protocol, 'solana');
        }
    }
}
