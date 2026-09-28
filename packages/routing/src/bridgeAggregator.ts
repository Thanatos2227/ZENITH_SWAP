import { GasPreset, SwapRoute, Token } from '@zenith/types';
import { defaultCrossChainAggregator, CrossChainAggregator } from './crosschain/crossChainAggregator';
export class BridgeAggregator {
    private crossChainAggregator: CrossChainAggregator;
    constructor(crossChainAggregator = defaultCrossChainAggregator) {
        this.crossChainAggregator = crossChainAggregator;
    }
    public async findCrossChainRoutes(params: {
        sourceChainId: string;
        destinationChainId: string;
        tokenIn: Token;
        tokenOut: Token;
        amountInRaw: string;
        amountInNum: number;
        gasPreset?: GasPreset;
        userAddress?: string;
    }): Promise<SwapRoute[]> {
        const isCrossChain = params.sourceChainId !== params.destinationChainId;
        if (!isCrossChain)
            return [];
        return await this.crossChainAggregator.findCrossChainRoutes({
            request: {
                sourceChainId: params.sourceChainId,
                destinationChainId: params.destinationChainId,
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                amountInRaw: params.amountInRaw,
                slippageTolerancePercent: 0.5,
                gasPreset: params.gasPreset,
                userWalletAddress: params.userAddress
            },
            userAddress: params.userAddress
        });
    }
}
export const defaultBridgeAggregator = new BridgeAggregator();
