import { Contract, Provider, ZeroAddress } from 'ethers';
import {
  ZENITH_V1_FACTORY_ABI,
  ZENITH_V1_PAIR_ABI,
  ZENITH_V2_FACTORY_ABI,
  ZENITH_V2_POOL_ABI,
  ZENITH_V3_FACTORY_ABI,
  ZENITH_V3_POOL_ABI,
  getZenithV1Factory,
  getZenithV2Factory,
  getZenithV3Factory
} from '@zenith/contracts';
import { TickInfo } from '../math/v3ExactMath';

export interface ZenithV1LivePoolState {
  chainId: number;
  poolAddress: string;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  blockTimestampLast: number;
  blockNumber: number;
}

export interface ZenithV2LivePoolState {
  chainId: number;
  poolAddress: string;
  token0: string;
  token1: string;
  feeBps: number;
  reserve0: bigint;
  reserve1: bigint;
  blockTimestampLast: number;
  blockNumber: number;
}

export interface ZenithV3LivePoolState {
  chainId: number;
  poolAddress: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  sqrtPriceX96: bigint;
  tick: number;
  unlocked: boolean;
  liquidity: bigint;
  initializedTicks: TickInfo[];
  blockNumber: number;
}

export class PoolStateReader {
  // ==========================================
  // ZENITH V1 LIVE STATE
  // ==========================================
  public static async getV1PairAddress(
    factoryAddress: string,
    tokenA: string,
    tokenB: string,
    provider: Provider
  ): Promise<string> {
    const factory = new Contract(factoryAddress, ZENITH_V1_FACTORY_ABI, provider);
    const pairAddress: string = await factory.getPair(tokenA, tokenB);
    return pairAddress;
  }

  public static async readLiveV1PoolState(
    chainId: number,
    poolAddress: string,
    provider: Provider
  ): Promise<ZenithV1LivePoolState> {
    if (!poolAddress || poolAddress === ZeroAddress) {
      throw new Error(`Invalid Zenith V1 pair address: ${poolAddress}`);
    }

    const code = await provider.getCode(poolAddress);
    if (!code || code === '0x') {
      throw new Error(`Zenith V1 pair contract not deployed at ${poolAddress}`);
    }

    const pair = new Contract(poolAddress, ZENITH_V1_PAIR_ABI, provider);

    const [token0, token1, reserves, blockNumber] = await Promise.all([
      pair.token0(),
      pair.token1(),
      pair.getReserves(),
      provider.getBlockNumber()
    ]);

    return {
      chainId,
      poolAddress,
      token0,
      token1,
      reserve0: BigInt(reserves[0].toString()),
      reserve1: BigInt(reserves[1].toString()),
      blockTimestampLast: Number(reserves[2]),
      blockNumber
    };
  }

  public static async getLiveV1PoolStateForPair(
    chainId: number,
    tokenA: string,
    tokenB: string,
    provider: Provider
  ): Promise<ZenithV1LivePoolState | null> {
    const factoryAddress = getZenithV1Factory(chainId);
    if (!factoryAddress) return null;

    const pairAddress = await this.getV1PairAddress(factoryAddress, tokenA, tokenB, provider);
    if (!pairAddress || pairAddress === ZeroAddress) return null;

    try {
      return await this.readLiveV1PoolState(chainId, pairAddress, provider);
    } catch {
      return null;
    }
  }

  // ==========================================
  // ZENITH V2 LIVE STATE
  // ==========================================
  public static async getV2PoolAddress(
    factoryAddress: string,
    tokenA: string,
    tokenB: string,
    feeBps: number,
    provider: Provider
  ): Promise<string> {
    const factory = new Contract(factoryAddress, ZENITH_V2_FACTORY_ABI, provider);
    const poolAddress: string = await factory.getPool(tokenA, tokenB, feeBps);
    return poolAddress;
  }

  public static async readLiveV2PoolState(
    chainId: number,
    poolAddress: string,
    provider: Provider
  ): Promise<ZenithV2LivePoolState> {
    if (!poolAddress || poolAddress === ZeroAddress) {
      throw new Error(`Invalid Zenith V2 pool address: ${poolAddress}`);
    }

    const code = await provider.getCode(poolAddress);
    if (!code || code === '0x') {
      throw new Error(`Zenith V2 pool contract not deployed at ${poolAddress}`);
    }

    const pool = new Contract(poolAddress, ZENITH_V2_POOL_ABI, provider);

    const [token0, token1, feeBps, reserves, blockNumber] = await Promise.all([
      pool.token0(),
      pool.token1(),
      pool.feeBps(),
      pool.getReserves(),
      provider.getBlockNumber()
    ]);

    return {
      chainId,
      poolAddress,
      token0,
      token1,
      feeBps: Number(feeBps),
      reserve0: BigInt(reserves[0].toString()),
      reserve1: BigInt(reserves[1].toString()),
      blockTimestampLast: Number(reserves[2]),
      blockNumber
    };
  }

  public static async getLiveV2PoolStateForPair(
    chainId: number,
    tokenA: string,
    tokenB: string,
    feeBps: number,
    provider: Provider
  ): Promise<ZenithV2LivePoolState | null> {
    const factoryAddress = getZenithV2Factory(chainId);
    if (!factoryAddress) return null;

    const poolAddress = await this.getV2PoolAddress(factoryAddress, tokenA, tokenB, feeBps, provider);
    if (!poolAddress || poolAddress === ZeroAddress) return null;

    try {
      return await this.readLiveV2PoolState(chainId, poolAddress, provider);
    } catch {
      return null;
    }
  }

  // ==========================================
  // ZENITH V3 LIVE STATE
  // ==========================================
  public static async getV3PoolAddress(
    factoryAddress: string,
    tokenA: string,
    tokenB: string,
    fee: number,
    provider: Provider
  ): Promise<string> {
    const factory = new Contract(factoryAddress, ZENITH_V3_FACTORY_ABI, provider);
    const poolAddress: string = await factory.getPool(tokenA, tokenB, fee);
    return poolAddress;
  }

  public static async readLiveV3PoolState(
    chainId: number,
    poolAddress: string,
    provider: Provider
  ): Promise<ZenithV3LivePoolState> {
    if (!poolAddress || poolAddress === ZeroAddress) {
      throw new Error(`Invalid Zenith V3 pool address: ${poolAddress}`);
    }

    const code = await provider.getCode(poolAddress);
    if (!code || code === '0x') {
      throw new Error(`Zenith V3 pool contract not deployed at ${poolAddress}`);
    }

    const pool = new Contract(poolAddress, ZENITH_V3_POOL_ABI, provider);

    const [
      token0,
      token1,
      feeBig,
      tickSpacingBig,
      slot0,
      liquidity,
      blockNumber
    ] = await Promise.all([
      pool.token0(),
      pool.token1(),
      pool.fee(),
      pool.tickSpacing(),
      pool.slot0(),
      pool.liquidity(),
      provider.getBlockNumber()
    ]);

    const fee = Number(feeBig);
    const tickSpacing = Number(tickSpacingBig);
    const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96.toString());
    const tick = Number(slot0.tick);
    const unlocked = Boolean(slot0.unlocked);

    const initializedTicks: TickInfo[] = [];

    const currentWord = Math.floor(tick / (tickSpacing * 256));
    const wordsToScan = [currentWord - 1, currentWord, currentWord + 1];

    for (const wordPos of wordsToScan) {
      try {
        const bitmap: bigint = BigInt((await pool.tickBitmap(wordPos)).toString());
        if (bitmap !== 0n) {
          for (let bit = 0; bit < 256; bit++) {
            if ((bitmap & (1n << BigInt(bit))) !== 0n) {
              const tickIndex = (wordPos * 256 + bit) * tickSpacing;
              try {
                const tickData = await pool.ticks(tickIndex);
                if (tickData.initialized) {
                  initializedTicks.push({
                    tick: tickIndex,
                    liquidityNet: BigInt(tickData.liquidityNet.toString())
                  });
                }
              } catch {
                // Ignore query error for boundary tick
              }
            }
          }
        }
      } catch {
        // Fallback for bitmap
      }
    }

    return {
      chainId,
      poolAddress,
      token0,
      token1,
      fee,
      tickSpacing,
      sqrtPriceX96,
      tick,
      unlocked,
      liquidity: BigInt(liquidity.toString()),
      initializedTicks,
      blockNumber
    };
  }

  public static async getLiveV3PoolStateForPair(
    chainId: number,
    tokenA: string,
    tokenB: string,
    fee: number,
    provider: Provider
  ): Promise<ZenithV3LivePoolState | null> {
    const factoryAddress = getZenithV3Factory(chainId);
    if (!factoryAddress) return null;

    const poolAddress = await this.getV3PoolAddress(factoryAddress, tokenA, tokenB, fee, provider);
    if (!poolAddress || poolAddress === ZeroAddress) {
      return null;
    }

    try {
      return await this.readLiveV3PoolState(chainId, poolAddress, provider);
    } catch {
      return null;
    }
  }
}
