import type { DexIdentity, DexCapabilities, DexPairValidationResult, DexPoolDiscoveryResult, AuthoritativeDexQuote, DexSwapTransaction, DexSimulationResult, DexPoolState, DexDeploymentVerificationResult, DexLiquidityState, TokenIdentity, Token } from '@zenith/types';
import type { IDexAdapter, DexQuoteParams } from './dexAdapter.interface';
import { UnsupportedDexOperationError } from '@zenith/contracts';
export class NonEvmDexAdapter implements IDexAdapter {
    public readonly dexId: string;
    private readonly identity: DexIdentity;
    constructor(identity: DexIdentity) {
        this.identity = Object.freeze({ ...identity });
        this.dexId = identity.dexId;
    }
    public getDexIdentity(): DexIdentity {
        return { ...this.identity };
    }
    public getCapabilities(): DexCapabilities {
        return {
            dexId: this.dexId,
            capabilityLevel: this.identity.capabilityLevel,
            supportsQuotes: false,
            supportsExecution: false,
            supportsExactInput: false,
            supportsExactOutput: false,
            supportsPoolDiscovery: false,
            supportsSimulation: false,
            supportsPriceImpact: false,
            supportedTokenStandards: [...this.identity.supportedTokenStandards]
        };
    }
    public validateTokenPair(tokenIn: TokenIdentity | Token, tokenOut: TokenIdentity | Token): DexPairValidationResult {
        const stdIn = (tokenIn as any).standard || 'SPL';
        const stdOut = (tokenOut as any).standard || 'SPL';
        if (this.identity.family === 'SOLANA') {
            const valid = stdIn === 'SPL' && stdOut === 'SPL';
            return {
                isValid: valid,
                reason: valid ? undefined : 'Solana DEX requires SPL tokens',
                tokenInStandard: stdIn,
                tokenOutStandard: stdOut
            };
        }
        return {
            isValid: false,
            reason: `UNSUPPORTED_DEX_OPERATION: Family "${this.identity.family}" not supported for pair validation`,
            tokenInStandard: stdIn,
            tokenOutStandard: stdOut
        };
    }
    public async discoverPool(_tokenIn: TokenIdentity | Token, _tokenOut: TokenIdentity | Token, _feeTierBps?: number): Promise<DexPoolDiscoveryResult> {
        return {
            poolFound: false,
            dexId: this.dexId,
            networkId: this.identity.networkId,
            discoverySource: 'UNSUPPORTED',
            verificationStatus: 'UNVERIFIED',
            error: 'UNSUPPORTED_DEX_OPERATION: Pool discovery not supported on non-EVM DEX'
        };
    }
    public async getQuote(_params: DexQuoteParams): Promise<AuthoritativeDexQuote | null> {
        return null;
    }
    public async buildSwapTransaction(): Promise<DexSwapTransaction> {
        throw new UnsupportedDexOperationError(this.dexId, 'buildSwapTransaction', 'Cannot build swap transaction for non-EVM DEX');
    }
    public async simulateSwap(): Promise<DexSimulationResult> {
        return {
            isSuccess: false,
            revertReason: 'UNSUPPORTED_DEX_OPERATION: Simulation not supported on non-EVM DEX',
            semanticEquivalenceValid: false,
            minimumOutputValid: false,
            gasReserveValid: false,
            preflightPassed: false
        };
    }
    public async getPoolState(): Promise<DexPoolState | null> {
        return null;
    }
    public async verifyDeployment(): Promise<DexDeploymentVerificationResult> {
        return {
            dexId: this.dexId,
            routerStatus: 'UNVERIFIED',
            factoryStatus: 'UNVERIFIED',
            verifiedAt: Date.now(),
            overallStatus: 'UNVERIFIED',
            issues: ['Non-EVM verification not supported via EVM RPC']
        };
    }
    public async getLiquidityState(): Promise<DexLiquidityState | null> {
        return null;
    }
    public async getPriceImpact(): Promise<number | null> {
        return null;
    }
}
