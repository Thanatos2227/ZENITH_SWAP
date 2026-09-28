import { Contract, Provider } from 'ethers';
import { ZENITH_V3_POSITION_MANAGER_ABI, getZenithV3PositionManager, CANONICAL_NATIVE_ADDRESS } from '@zenith/contracts';
import { ZenithV3PositionInfo } from './types';
export async function getZenithV3Position(provider: Provider, chainId: number, tokenId: bigint | string): Promise<ZenithV3PositionInfo> {
    const managerAddr = getZenithV3PositionManager(chainId);
    if (!managerAddr) {
        throw new Error(`Zenith V3 Position Manager is not configured for chain ${chainId}`);
    }
    const manager = new Contract(managerAddr, ZENITH_V3_POSITION_MANAGER_ABI, provider);
    const pos = await manager.positions(tokenId);
    return {
        tokenId: BigInt(tokenId),
        nonce: 0n,
        operator: CANONICAL_NATIVE_ADDRESS,
        token0: pos.token0,
        token1: pos.token1,
        fee: Number(pos.fee),
        tickLower: Number(pos.tickLower),
        tickUpper: Number(pos.tickUpper),
        liquidity: BigInt(pos.liquidity),
        feeGrowthInside0LastX128: 0n,
        feeGrowthInside1LastX128: 0n,
        tokensOwed0: BigInt(pos.tokensOwed0),
        tokensOwed1: BigInt(pos.tokensOwed1)
    };
}
