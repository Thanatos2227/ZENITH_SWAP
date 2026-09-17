import { Contract, Provider, ZeroAddress } from 'ethers';
import { ZENITH_V3_POOL_ABI, ZENITH_V3_FACTORY_ABI, getZenithV3Factory } from '@zenith/contracts';
import { TickInfo } from '../math/v3ExactMath';

export interface ZenithV3LivePoolState {
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
  public static async getPoolAddress(
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

  public static async readLivePoolState(
    poolAddress: string,
    provider: Provider
  ): Promise<ZenithV3LivePoolState> {
    if (!poolAddress || poolAddress === ZeroAddress) {
      throw new Error(`Invalid Zenith V3 pool address: ${poolAddress}`);
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

  public static async getLivePoolStateForPair(
    chainId: number,
    tokenA: string,
    tokenB: string,
    fee: number,
    provider: Provider
  ): Promise<ZenithV3LivePoolState | null> {
    const factoryAddress = getZenithV3Factory(chainId);
    if (!factoryAddress) return null;

    const poolAddress = await this.getPoolAddress(factoryAddress, tokenA, tokenB, fee, provider);
    if (!poolAddress || poolAddress === ZeroAddress) {
      return null;
    }

    return this.readLivePoolState(poolAddress, provider);
  }
}
