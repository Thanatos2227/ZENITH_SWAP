import { CircuitBreakerState } from '@zenith/types';
export class CircuitBreakerMonitor {
    private state: CircuitBreakerState = {
        isEmergencyPaused: false,
        pausedChains: [],
        priceDeviationCapPercent: 15.0,
        authorizedPauseSigner: ''
    };
    public getState(): CircuitBreakerState {
        return { ...this.state };
    }
    public isChainPaused(chainId: string): boolean {
        if (this.state.isEmergencyPaused)
            return true;
        return this.state.pausedChains.includes(chainId.toLowerCase());
    }
    public validatePriceDeviation(params: {
        oraclePriceUSD: number;
        quotedPriceUSD: number;
    }): {
        isValid: boolean;
        deviationPercent: number;
        reason?: string;
    } {
        if (params.oraclePriceUSD <= 0 || params.quotedPriceUSD <= 0) {
            return { isValid: true, deviationPercent: 0 };
        }
        const diff = Math.abs(params.quotedPriceUSD - params.oraclePriceUSD);
        const deviationPercent = (diff / params.oraclePriceUSD) * 100;
        if (deviationPercent > this.state.priceDeviationCapPercent) {
            return {
                isValid: false,
                deviationPercent,
                reason: `Price deviation of ${deviationPercent.toFixed(2)}% exceeds the circuit breaker threshold (${this.state.priceDeviationCapPercent}%). Execution halted for fund safety.`
            };
        }
        return { isValid: true, deviationPercent };
    }
    public emergencyPause(reason: string, signerAddress: string, chainId?: string): void {
        if (chainId) {
            const lower = chainId.toLowerCase();
            if (!this.state.pausedChains.includes(lower)) {
                this.state.pausedChains.push(lower);
            }
        }
        else {
            this.state.isEmergencyPaused = true;
        }
        this.state.lastPausedTimestamp = Date.now();
        this.state.pauseReason = reason;
        this.state.authorizedPauseSigner = signerAddress;
    }
    public resume(signerAddress: string, chainId?: string): void {
        if (chainId) {
            this.state.pausedChains = this.state.pausedChains.filter((c) => c !== chainId.toLowerCase());
        }
        else {
            this.state.isEmergencyPaused = false;
        }
        this.state.pauseReason = undefined;
        this.state.authorizedPauseSigner = signerAddress;
    }
}
export const defaultCircuitBreaker = new CircuitBreakerMonitor();
