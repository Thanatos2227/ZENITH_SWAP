import { Contract, Provider } from 'ethers';
import { DEXProtocol, Token } from '@zenith/types';
import { ZENITH_V1_FACTORY_ABI, ZENITH_V1_PAIR_ABI, ZENITH_V2_FACTORY_ABI, ZENITH_V2_POOL_ABI, ZENITH_V3_FACTORY_ABI, ZENITH_V3_POOL_ABI, getZenithV1Factory, getZenithV2Factory, getZenithV3Factory } from '@zenith/contracts';
import { ZenithPoolInfo } from './types';
const ERC20_MIN_ABI = [
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)'
];
export async function fetchTokenDetails(provider: Provider, address: string, chainId: number): Promise<Token> {
    try {
        const contract = new Contract(address, ERC20_MIN_ABI, provider);
        const [decimals, symbol, name] = await Promise.all([
            contract.decimals().catch(() => 18),
            contract.symbol().catch(() => 'UNKNOWN'),
            contract.name().catch(() => 'Unknown Token')
        ]);
        return {
            chainId: chainId.toString(),
            address,
            symbol,
            name,
            decimals: Number(decimals),
            isNative: false,
            verificationTier: 'COMMUNITY_VERIFIED'
        };
    }
    catch {
        return {
            chainId: chainId.toString(),
            address,
            symbol: 'UNKNOWN',
            name: 'Unknown Token',
            decimals: 18,
            isNative: false,
            verificationTier: 'COMMUNITY_VERIFIED'
        };
    }
}
export async function getZenithV1PoolInfo(provider: Provider, chainId: number, pairAddress: string): Promise<ZenithPoolInfo> {
    const pairContract = new Contract(pairAddress, ZENITH_V1_PAIR_ABI, provider);
    const [token0Addr, token1Addr, reserves, totalSupply] = await Promise.all([
        pairContract.token0(),
        pairContract.token1(),
        pairContract.getReserves(),
        pairContract.totalSupply()
    ]);
    const [token0, token1] = await Promise.all([
        fetchTokenDetails(provider, token0Addr, chainId),
        fetchTokenDetails(provider, token1Addr, chainId)
    ]);
    return {
        protocol: 'ZENITH_V1',
        chainId,
        address: pairAddress,
        token0,
        token1,
        feeBps: 30,
        reserve0: BigInt(reserves[0]),
        reserve1: BigInt(reserves[1]),
        totalLpSupply: BigInt(totalSupply)
    };
}
export async function getZenithV2PoolInfo(provider: Provider, chainId: number, poolAddress: string): Promise<ZenithPoolInfo> {
    const poolContract = new Contract(poolAddress, ZENITH_V2_POOL_ABI, provider);
    const [token0Addr, token1Addr, feeBps, reserves, totalSupply] = await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.feeBps(),
        poolContract.getReserves(),
        poolContract.totalSupply()
    ]);
    const [token0, token1] = await Promise.all([
        fetchTokenDetails(provider, token0Addr, chainId),
        fetchTokenDetails(provider, token1Addr, chainId)
    ]);
    return {
        protocol: 'ZENITH_V2',
        chainId,
        address: poolAddress,
        token0,
        token1,
        feeBps: Number(feeBps),
        reserve0: BigInt(reserves[0]),
        reserve1: BigInt(reserves[1]),
        totalLpSupply: BigInt(totalSupply)
    };
}
export async function getZenithV3PoolInfo(provider: Provider, chainId: number, poolAddress: string): Promise<ZenithPoolInfo> {
    const poolContract = new Contract(poolAddress, ZENITH_V3_POOL_ABI, provider);
    const [token0Addr, token1Addr, fee, slot0, liquidity] = await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
        poolContract.slot0(),
        poolContract.liquidity()
    ]);
    const [token0, token1] = await Promise.all([
        fetchTokenDetails(provider, token0Addr, chainId),
        fetchTokenDetails(provider, token1Addr, chainId)
    ]);
    return {
        protocol: 'ZENITH_V3',
        chainId,
        address: poolAddress,
        token0,
        token1,
        feeBps: Number(fee),
        sqrtPriceX96: BigInt(slot0[0]),
        tick: Number(slot0[1]),
        liquidity: BigInt(liquidity)
    };
}
export async function getPool(provider: Provider, chainId: number, poolAddress: string, protocol: DEXProtocol = 'ZENITH_V3'): Promise<ZenithPoolInfo> {
    switch (protocol) {
        case 'ZENITH_V1':
            return getZenithV1PoolInfo(provider, chainId, poolAddress);
        case 'ZENITH_V2':
            return getZenithV2PoolInfo(provider, chainId, poolAddress);
        case 'ZENITH_V3':
            return getZenithV3PoolInfo(provider, chainId, poolAddress);
        default:
            throw new Error(`Unsupported pool protocol: ${protocol}`);
    }
}
export async function getPools(provider: Provider, chainId: number, protocol?: DEXProtocol): Promise<ZenithPoolInfo[]> {
    const pools: ZenithPoolInfo[] = [];
    if (!protocol || protocol === 'ZENITH_V1') {
        const factoryAddr = getZenithV1Factory(chainId);
        if (factoryAddr) {
            try {
                const factory = new Contract(factoryAddr, ZENITH_V1_FACTORY_ABI, provider);
                const len = await factory.allPairsLength();
                const count = Math.min(Number(len), 50);
                for (let i = 0; i < count; i++) {
                    const pairAddr = await factory.allPairs(i);
                    const poolInfo = await getZenithV1PoolInfo(provider, chainId, pairAddr);
                    pools.push(poolInfo);
                }
            }
            catch (err) {
                console.warn(`[ZenithSDK] Failed to fetch V1 pools for chain ${chainId}:`, err);
            }
        }
    }
    if (!protocol || protocol === 'ZENITH_V2') {
        const factoryAddr = getZenithV2Factory(chainId);
        if (factoryAddr) {
            try {
                const factory = new Contract(factoryAddr, ZENITH_V2_FACTORY_ABI, provider);
                const len = await factory.allPoolsLength();
                const count = Math.min(Number(len), 50);
                for (let i = 0; i < count; i++) {
                    const poolAddr = await factory.allPools(i);
                    const poolInfo = await getZenithV2PoolInfo(provider, chainId, poolAddr);
                    pools.push(poolInfo);
                }
            }
            catch (err) {
                console.warn(`[ZenithSDK] Failed to fetch V2 pools for chain ${chainId}:`, err);
            }
        }
    }
    if (!protocol || protocol === 'ZENITH_V3') {
        const factoryAddr = getZenithV3Factory(chainId);
        if (factoryAddr) {
            try {
                const factory = new Contract(factoryAddr, ZENITH_V3_FACTORY_ABI, provider);
                const len = await factory.allPoolsLength();
                const count = Math.min(Number(len), 50);
                for (let i = 0; i < count; i++) {
                    const poolAddr = await factory.allPools(i);
                    const poolInfo = await getZenithV3PoolInfo(provider, chainId, poolAddr);
                    pools.push(poolInfo);
                }
            }
            catch (err) {
                console.warn(`[ZenithSDK] Failed to fetch V3 pools for chain ${chainId}:`, err);
            }
        }
    }
    return pools;
}
