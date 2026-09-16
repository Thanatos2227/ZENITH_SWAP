import { BigInt, BigDecimal, Address, ethereum } from "@graphprotocol/graph-ts";
import { Swap as V1SwapEvent, Sync as V1SyncEvent } from "../../generated/templates/ZenithV1Pair/ZenithV1Pair";
import { Swap as V3SwapEvent } from "../../generated/templates/ZenithV3Pool/ZenithV3Pool";
import { Pool, Swap, PoolDayData, PoolHourData, ZenithDayData, ZenithProtocol } from "../../generated/schema";

const PROTOCOL_ID = "zenith-v4-canonical";
const ZERO_BD = BigDecimal.fromString("0");
const ZERO_BI = BigInt.fromI32(0);
const ONE_BI = BigInt.fromI32(1);

export function getOrCreatePoolDayData(pool: Pool, event: ethereum.Event): PoolDayData {
  let timestamp = event.block.timestamp.toI32();
  let dayId = timestamp / 86400;
  let id = pool.id.concat("-").concat(BigInt.fromI32(dayId).toString());

  let poolDayData = PoolDayData.load(id);
  if (poolDayData === null) {
    poolDayData = new PoolDayData(id);
    poolDayData.date = dayId * 86400;
    poolDayData.pool = pool.id;
    poolDayData.liquidity = pool.liquidity;
    poolDayData.sqrtPriceX96 = pool.sqrtPriceX96;
    poolDayData.token0Price = pool.token0Price;
    poolDayData.token1Price = pool.token1Price;
    poolDayData.tvlUSD = pool.totalValueLockedUSD;
    poolDayData.volumeToken0 = ZERO_BD;
    poolDayData.volumeToken1 = ZERO_BD;
    poolDayData.volumeUSD = ZERO_BD;
    poolDayData.feesUSD = ZERO_BD;
    poolDayData.txCount = ZERO_BI;
    poolDayData.save();
  }
  return poolDayData;
}

export function handleV1Swap(event: V1SwapEvent): void {
  let pool = Pool.load(event.address.toHexString());
  if (pool === null) return;

  let swapId = event.transaction.hash.toHexString().concat("-").concat(event.logIndex.toString());
  let swap = new Swap(swapId);
  swap.transactionHash = event.transaction.hash;
  swap.timestamp = event.block.timestamp;
  swap.pool = pool.id;
  swap.token0 = pool.token0;
  swap.token1 = pool.token1;
  swap.sender = event.params.sender;
  swap.recipient = event.params.to;
  swap.origin = event.transaction.from;

  let amount0 = event.params.amount0In.gt(ZERO_BI)
    ? event.params.amount0In.toBigDecimal()
    : event.params.amount0Out.toBigDecimal().neg();
  let amount1 = event.params.amount1In.gt(ZERO_BI)
    ? event.params.amount1In.toBigDecimal()
    : event.params.amount1Out.toBigDecimal().neg();

  swap.amount0 = amount0;
  swap.amount1 = amount1;
  swap.amountUSD = ZERO_BD;
  swap.sqrtPriceX96 = pool.sqrtPriceX96;
  swap.tick = pool.tick;
  swap.logIndex = event.logIndex;
  swap.save();

  pool.txCount = pool.txCount.plus(ONE_BI);
  pool.save();

  let poolDayData = getOrCreatePoolDayData(pool, event);
  poolDayData.txCount = poolDayData.txCount.plus(ONE_BI);
  poolDayData.save();
}

export function handleV1Sync(event: V1SyncEvent): void {
  let pool = Pool.load(event.address.toHexString());
  if (pool === null) return;
  pool.save();
}

export function handleV3Swap(event: V3SwapEvent): void {
  let pool = Pool.load(event.address.toHexString());
  if (pool === null) return;

  let swapId = event.transaction.hash.toHexString().concat("-").concat(event.logIndex.toString());
  let swap = new Swap(swapId);
  swap.transactionHash = event.transaction.hash;
  swap.timestamp = event.block.timestamp;
  swap.pool = pool.id;
  swap.token0 = pool.token0;
  swap.token1 = pool.token1;
  swap.sender = event.params.sender;
  swap.recipient = event.params.recipient;
  swap.origin = event.transaction.from;
  swap.amount0 = event.params.amount0.toBigDecimal();
  swap.amount1 = event.params.amount1.toBigDecimal();
  swap.amountUSD = ZERO_BD;
  swap.sqrtPriceX96 = BigInt.fromUnsignedBytes(event.params.sqrtPriceX96);
  swap.tick = BigInt.fromI32(event.params.tick);
  swap.logIndex = event.logIndex;
  swap.save();

  pool.sqrtPriceX96 = BigInt.fromUnsignedBytes(event.params.sqrtPriceX96);
  pool.liquidity = BigInt.fromUnsignedBytes(event.params.liquidity);
  pool.tick = BigInt.fromI32(event.params.tick);
  pool.txCount = pool.txCount.plus(ONE_BI);
  pool.save();
}
