import type { ExecutionCapabilityState, EvidenceClass, AuthoritativeCanaryEntry, UiApiStatusContract, MultiChainReadinessSnapshot } from '@zenith/types';
export const CAPABILITY_STATE_RANKS: Record<ExecutionCapabilityState, number> = {
    DISCOVERED: 0,
    CONFIGURED: 10,
    UNIT_TESTED: 20,
    SIMULATION_VERIFIED: 30,
    PREFLIGHT_VERIFIED: 40,
    EXECUTION_AVAILABLE: 50,
    LIVE_EXECUTION_READY: 60,
    LIVE_VERIFIED: 70,
    FUNDING_BLOCKED: 45,
    DISABLED: -10,
    DEPRECATED: -20
};
export const EVIDENCE_CLASS_RANKS: Record<EvidenceClass, number> = {
    UNVERIFIED: 0,
    CONFIGURATION: 10,
    FIXTURE: 20,
    SIMULATION: 30,
    PREFLIGHT: 40,
    READ_ONLY_LIVE: 50,
    ON_CHAIN_LIVE: 60
};
function deepClone<T>(obj: T): T {
    if (obj === undefined || obj === null)
        return obj;
    if (typeof obj === 'bigint')
        return obj;
    return JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? `${v.toString()}n` : v)), (_, v) => (typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));
}
export const CANONICAL_CANARIES: readonly AuthoritativeCanaryEntry[] = [
    {
        canaryId: 'polygon:quickswap-v3:wmatic-usdc',
        networkIdentity: 'polygon',
        chainId: 137,
        executionFamily: 'EVM',
        dex: 'QuickSwap V3',
        dexId: 'polygon:quickswap-v3',
        inputToken: 'WMATIC',
        outputToken: 'USDC',
        executionMode: 'LIVE_ONCHAIN',
        capabilityState: 'LIVE_VERIFIED',
        evidenceState: 'ON_CHAIN_LIVE',
        fundingState: 'FUNDED',
        preflightState: 'PASSED',
        liveExecutionState: 'VERIFIED',
        settlementState: 'SETTLED_ON_CHAIN',
        lastVerifiedBlock: 94484284,
        quoteMetadata: {
            inputAmountRaw: 1000000000000000000n,
            expectedOutputRaw: 118537n,
            minimumOutputRaw: 117351n,
            slippageBps: 100,
            quoteTimestamp: 1727349132000
        },
        planHash: '0x5f242137de9fcfb2fc377759dc23c8c7fdf9e512cb598dfba96e6d1a938c8237',
        semanticHash: '0x5f242137de9fcfb2fc377759dc23c8c7fdf9e512cb598dfba96e6d1a938c8237',
        realTransactionHash: '0x66d379b1806fff0c291cbf31143dfdf3bd5a8ddce66ff578f9d7e6aac16130dd',
        finalityEvidence: {
            gasUsed: 462737n,
            nonce: 36,
            blockNumber: 94484284,
            actualAmountInRaw: 1000000000000000000n,
            actualAmountOutRaw: 118537n,
            explorerUrl: 'https://polygonscan.com/tx/0x66d379b1806fff0c291cbf31143dfdf3bd5a8ddce66ff578f9d7e6aac16130dd',
            transferLogVerified: true,
            balanceDeltaVerified: true
        },
        blockingReason: null,
        nextRequiredPrerequisite: null,
        isLiveVerified: true,
        isFundingBlocked: false,
        isExecutableNow: true,
        updatedAt: 1727351000000
    },
    {
        canaryId: 'arbitrum:uniswap-v3:weth-usdc',
        networkIdentity: 'arbitrum',
        chainId: 42161,
        executionFamily: 'EVM',
        dex: 'Uniswap V3',
        dexId: 'arbitrum:uniswap-v3',
        inputToken: 'WETH',
        outputToken: 'USDC',
        executionMode: 'PREFLIGHT_ONLY',
        capabilityState: 'EXECUTION_AVAILABLE',
        evidenceState: 'READ_ONLY_LIVE',
        fundingState: 'FUNDING_BLOCKED',
        preflightState: 'BLOCKED_BY_FUNDING',
        liveExecutionState: 'READY_AWAITING_FUNDS',
        settlementState: 'SIMULATED',
        lastVerifiedBlock: 400588665,
        quoteMetadata: {
            inputAmountRaw: 100000000000000n,
            expectedOutputRaw: 268996n,
            minimumOutputRaw: 267651n,
            slippageBps: 50,
            quoteTimestamp: 1727387000000
        },
        planHash: '0x09861e6fa4360e224e75878db618cb3e7d9b73dc2d53bf59ca6e0ee76b71f97b',
        semanticHash: '0x09861e6fa4360e224e75878db618cb3e7d9b73dc2d53bf59ca6e0ee76b71f97b',
        realTransactionHash: null,
        finalityEvidence: null,
        blockingReason: 'Arbitrum Uniswap V3 execution is technically ready but live execution is blocked because the authorized wallet currently has insufficient native ETH.',
        nextRequiredPrerequisite: 'Fund authorized wallet 0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88 with minimum 0.0008188 ETH on Arbitrum One',
        isLiveVerified: false,
        isFundingBlocked: true,
        isExecutableNow: false,
        updatedAt: 1727388000000
    },
    {
        canaryId: 'base:aerodrome-v2:weth-usdc',
        networkIdentity: 'base',
        chainId: 8453,
        executionFamily: 'EVM',
        dex: 'Aerodrome',
        dexId: 'base:aerodrome-v2',
        inputToken: 'WETH',
        outputToken: 'USDC',
        executionMode: 'SIMULATION',
        capabilityState: 'CONFIGURED',
        evidenceState: 'CONFIGURATION',
        fundingState: 'NOT_APPLICABLE',
        preflightState: 'NOT_RUN',
        liveExecutionState: 'NOT_CONFIGURED',
        settlementState: 'NOT_APPLICABLE',
        lastVerifiedBlock: null,
        quoteMetadata: null,
        planHash: null,
        semanticHash: null,
        realTransactionHash: null,
        finalityEvidence: null,
        blockingReason: 'Base Aerodrome is strictly configured-only; live canary execution is disabled until Task 42 live sweep prerequisites are met.',
        nextRequiredPrerequisite: 'Complete Aerodrome V2 adapter certification and live capability sweep',
        isLiveVerified: false,
        isFundingBlocked: false,
        isExecutableNow: false,
        updatedAt: 1727300000000
    }
];
export class AuthoritativeCanaryRegistry {
    private canaries: Map<string, AuthoritativeCanaryEntry> = new Map();
    private chainIdToCanaryIds: Map<number, Set<string>> = new Map();
    constructor(seedCanaries: readonly AuthoritativeCanaryEntry[] = CANONICAL_CANARIES) {
        for (const canary of seedCanaries) {
            this.registerCanaryInternal(canary);
        }
    }
    private registerCanaryInternal(canary: AuthoritativeCanaryEntry): void {
        if (canary.capabilityState === 'LIVE_VERIFIED') {
            if (canary.evidenceState !== 'ON_CHAIN_LIVE') {
                throw new Error(`Cannot mark canary "${canary.canaryId}" as LIVE_VERIFIED without evidenceState="ON_CHAIN_LIVE" (got "${canary.evidenceState}")`);
            }
            if (!canary.realTransactionHash || !canary.realTransactionHash.startsWith('0x') || canary.realTransactionHash.length !== 66) {
                throw new Error(`Cannot mark canary "${canary.canaryId}" as LIVE_VERIFIED without valid realTransactionHash`);
            }
            if (!canary.finalityEvidence?.blockNumber || !canary.finalityEvidence?.actualAmountOutRaw) {
                throw new Error(`Cannot mark canary "${canary.canaryId}" as LIVE_VERIFIED without authoritative finality evidence`);
            }
        }
        if (canary.networkIdentity === 'arbitrum' && canary.capabilityState === 'LIVE_VERIFIED') {
            throw new Error('Arbitrum One must not be marked LIVE_VERIFIED (0 on-chain broadcasts permitted in zero-cost mode)');
        }
        if (canary.dexId === 'base:aerodrome-v2' && canary.capabilityState !== 'CONFIGURED') {
            throw new Error('Base Aerodrome must remain in CONFIGURED state until live evidence is collected');
        }
        const cloned = deepClone(canary);
        this.canaries.set(cloned.canaryId, cloned);
        let chainSet = this.chainIdToCanaryIds.get(cloned.chainId);
        if (!chainSet) {
            chainSet = new Set();
            this.chainIdToCanaryIds.set(cloned.chainId, chainSet);
        }
        chainSet.add(cloned.canaryId);
    }
    public registerCanary(canary: AuthoritativeCanaryEntry): void {
        if (this.canaries.has(canary.canaryId)) {
            const existing = this.canaries.get(canary.canaryId)!;
            if (existing.chainId !== canary.chainId) {
                throw new Error(`Chain ID mismatch for canary "${canary.canaryId}": Existing chainId ${existing.chainId} !== New chainId ${canary.chainId}`);
            }
        }
        this.registerCanaryInternal(canary);
    }
    public getCanary(canaryId: string): AuthoritativeCanaryEntry | undefined {
        const entry = this.canaries.get(canaryId);
        return entry ? deepClone(entry) : undefined;
    }
    public getCanariesForChain(chainId: number): AuthoritativeCanaryEntry[] {
        const ids = this.chainIdToCanaryIds.get(chainId);
        if (!ids)
            return [];
        return Array.from(ids).map(id => deepClone(this.canaries.get(id)!));
    }
    public getAllCanaries(): AuthoritativeCanaryEntry[] {
        return Array.from(this.canaries.values()).map(c => deepClone(c));
    }
    public isCanaryExecutableNow(canaryId: string): {
        isExecutable: boolean;
        reason?: string;
    } {
        const canary = this.canaries.get(canaryId);
        if (!canary) {
            return { isExecutable: false, reason: `Canary "${canaryId}" not found in authoritative registry` };
        }
        if (canary.isFundingBlocked) {
            return {
                isExecutable: false,
                reason: canary.blockingReason || 'Execution is blocked due to insufficient wallet funding.'
            };
        }
        if (canary.capabilityState === 'CONFIGURED') {
            return {
                isExecutable: false,
                reason: canary.blockingReason || 'Canary is in configuration-only state.'
            };
        }
        if (canary.capabilityState === 'DISABLED' || canary.capabilityState === 'DEPRECATED') {
            return {
                isExecutable: false,
                reason: `Canary is ${canary.capabilityState}.`
            };
        }
        if (!canary.isExecutableNow) {
            return {
                isExecutable: false,
                reason: canary.blockingReason || 'Canary is not marked executable.'
            };
        }
        return { isExecutable: true };
    }
    public getUiApiStatusContract(canaryId: string): UiApiStatusContract | undefined {
        const canary = this.canaries.get(canaryId);
        if (!canary)
            return undefined;
        return {
            network: canary.networkIdentity.toUpperCase(),
            chainId: canary.chainId,
            dex: canary.dex,
            capability: canary.capabilityState,
            evidence: canary.evidenceState,
            funding: canary.fundingState === 'FUNDED' ? 'FUNDED' : canary.fundingState === 'FUNDING_BLOCKED' ? 'BLOCKED' : 'NOT_APPLICABLE',
            executable_now: canary.isExecutableNow,
            live_verified: canary.isLiveVerified,
            reason: canary.blockingReason,
            nextPrerequisite: canary.nextRequiredPrerequisite
        };
    }
    public getReadinessSnapshot(): MultiChainReadinessSnapshot {
        const canaries = this.getAllCanaries();
        const canariesMap: Record<string, AuthoritativeCanaryEntry> = {};
        let liveVerifiedCount = 0;
        let fundingBlockedCount = 0;
        let simulationCount = 0;
        let configuredCount = 0;
        for (const c of canaries) {
            canariesMap[c.canaryId] = c;
            if (c.isLiveVerified)
                liveVerifiedCount++;
            if (c.isFundingBlocked)
                fundingBlockedCount++;
            if (c.capabilityState === 'SIMULATION_VERIFIED' || c.evidenceState === 'SIMULATION')
                simulationCount++;
            if (c.capabilityState === 'CONFIGURED')
                configuredCount++;
        }
        return {
            timestamp: Date.now(),
            totalNetworksTracked: this.chainIdToCanaryIds.size,
            liveVerifiedCanaries: liveVerifiedCount,
            fundingBlockedCanaries: fundingBlockedCount,
            simulationVerifiedCanaries: simulationCount,
            configuredCanaries: configuredCount,
            canaries: canariesMap,
            networkMatrix: [
                { network: 'Polygon Mainnet', chainId: 137, status: 'HEALTHY', capability: 'LIVE_VERIFIED', evidence: 'ON_CHAIN_LIVE' },
                { network: 'Arbitrum One', chainId: 42161, status: 'HEALTHY', capability: 'EXECUTION_AVAILABLE (FUNDING_BLOCKED)', evidence: 'READ_ONLY_LIVE + SIMULATION' },
                { network: 'Base', chainId: 8453, status: 'HEALTHY', capability: 'CONFIGURED', evidence: 'CONFIGURATION' },
                { network: 'Ethereum Mainnet', chainId: 1, status: 'HEALTHY', capability: 'EXECUTION_AVAILABLE', evidence: 'PREFLIGHT' },
                { network: 'Optimism', chainId: 10, status: 'HEALTHY', capability: 'EXECUTION_AVAILABLE', evidence: 'PREFLIGHT' },
                { network: 'BNB Smart Chain', chainId: 56, status: 'HEALTHY', capability: 'EXECUTION_AVAILABLE', evidence: 'PREFLIGHT' },
                { network: 'Solana Mainnet', chainId: 101, status: 'HEALTHY', capability: 'EXECUTION_AVAILABLE', evidence: 'PREFLIGHT' }
            ],
            dexMatrix: [
                { dexId: 'polygon:quickswap-v3', network: 'polygon', capability: 'LIVE_VERIFIED', liveReady: true, liveVerified: true },
                { dexId: 'arbitrum:uniswap-v3', network: 'arbitrum', capability: 'EXECUTION_AVAILABLE', liveReady: true, liveVerified: false },
                { dexId: 'base:aerodrome-v2', network: 'base', capability: 'CONFIGURED', liveReady: false, liveVerified: false },
                { dexId: 'ethereum:uniswap-v3', network: 'ethereum', capability: 'EXECUTION_AVAILABLE', liveReady: true, liveVerified: false },
                { dexId: 'optimism:uniswap-v3', network: 'optimism', capability: 'EXECUTION_AVAILABLE', liveReady: true, liveVerified: false },
                { dexId: 'bsc:pancakeswap-v3', network: 'bsc', capability: 'EXECUTION_AVAILABLE', liveReady: true, liveVerified: false }
            ],
            bridgeMatrix: [
                { bridgeId: 'across', supportedRoutes: 14, capability: 'EXECUTION_AVAILABLE' },
                { bridgeId: 'debridge', supportedRoutes: 12, capability: 'EXECUTION_AVAILABLE' },
                { bridgeId: 'stargate', supportedRoutes: 8, capability: 'CONFIGURED' }
            ]
        };
    }
}
export const defaultAuthoritativeCanaryRegistry = new AuthoritativeCanaryRegistry();
