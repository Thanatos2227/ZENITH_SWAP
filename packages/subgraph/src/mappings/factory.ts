import { BigInt, BigDecimal, Address } from "@graphprotocol/graph-ts";
import { PairCreated as V1PairCreated } from "../../generated/ZenithV1Factory/ZenithV1Factory";
import { PoolCreated as V2PoolCreated } from "../../generated/ZenithV2Factory/ZenithV2Factory";
import { PoolCreated as V3PoolCreated } from "../../generated/ZenithV3Factory/ZenithV3Factory";
import { ZenithV1Pair as V1PairTemplate, ZenithV3Pool as V3PoolTemplate } from "../../generated/templates";
import { Pool, Token, ZenithProtocol } from "../../generated/schema";

const PROTOCOL_ID = "zenith-v4-canonical";
const ZERO_BD = BigDecimal.fromString("0");
const ZERO_BI = BigInt.fromI32(0);

export function getOrCreateProtocol(): ZenithProtocol {
  let protocol = ZenithProtocol.load(PROTOCOL_ID);
  if (protocol === null) {
    protocol = new ZenithProtocol(PROTOCOL_ID);
    protocol.totalValueLockedUSD = ZERO_BD;
    protocol.totalVolumeUSD = ZERO_BD;
    protocol.untrackedVolumeUSD = ZERO_BD;
    protocol.totalFeesUSD = ZERO_BD;
    protocol.totalTreasuryFeesUSD = ZERO_BD;
    protocol.txCount = ZERO_BI;
    protocol.poolCount = ZERO_BI;
    protocol.tokenCount = ZERO_BI;
    protocol.save();
  }
  return protocol;
}

export function getOrCreateToken(address: Address): Token {
  let token = Token.load(address.toHexString());
  if (token === null) {
    token = new Token(address.toHexString());
    token.symbol = "UNKNOWN";
    token.name = "Unknown Token";
    token.decimals = BigInt.fromI32(18);
    token.totalSupply = ZERO_BI;
    token.tradeVolumeUSD = ZERO_BD;
    token.totalValueLockedUSD = ZERO_BD;
    token.derivedETH = ZERO_BD;
    token.txCount = ZERO_BI;
    token.save();

    let protocol = getOrCreateProtocol();
    protocol.tokenCount = protocol.tokenCount.plus(BigInt.fromI32(1));
    protocol.save();
  }
  return token;
}

export function handleV1PairCreated(event: V1PairCreated): void {
  let token0 = getOrCreateToken(event.params.token0);
  let token1 = getOrCreateToken(event.params.token1);

  let pool = new Pool(event.params.pair.toHexString());
  pool.version = "V1";
  pool.createdAtTimestamp = event.block.timestamp;
  pool.createdAtBlockNumber = event.block.number;
  pool.token0 = token0.id;
  pool.token1 = token1.id;
  pool.feeTier = BigInt.fromI32(30); // 30 BPS standard V1
  pool.liquidity = ZERO_BI;
  pool.sqrtPriceX96 = ZERO_BI;
  pool.token0Price = ZERO_BD;
  pool.token1Price = ZERO_BD;
  pool.volumeToken0 = ZERO_BD;
  pool.volumeToken1 = ZERO_BD;
  pool.volumeUSD = ZERO_BD;
  pool.totalValueLockedToken0 = ZERO_BD;
  pool.totalValueLockedToken1 = ZERO_BD;
  pool.totalValueLockedUSD = ZERO_BD;
  pool.txCount = ZERO_BI;
  pool.save();

  let protocol = getOrCreateProtocol();
  protocol.poolCount = protocol.poolCount.plus(BigInt.fromI32(1));
  protocol.save();

  V1PairTemplate.create(event.params.pair);
}

export function handleV2PoolCreated(event: V2PoolCreated): void {
  let token0 = getOrCreateToken(event.params.token0);
  let token1 = getOrCreateToken(event.params.token1);

  let pool = new Pool(event.params.pool.toHexString());
  pool.version = "V2";
  pool.createdAtTimestamp = event.block.timestamp;
  pool.createdAtBlockNumber = event.block.number;
  pool.token0 = token0.id;
  pool.token1 = token1.id;
  pool.feeTier = event.params.feeTier;
  pool.liquidity = ZERO_BI;
  pool.sqrtPriceX96 = ZERO_BI;
  pool.token0Price = ZERO_BD;
  pool.token1Price = ZERO_BD;
  pool.volumeToken0 = ZERO_BD;
  pool.volumeToken1 = ZERO_BD;
  pool.volumeUSD = ZERO_BD;
  pool.totalValueLockedToken0 = ZERO_BD;
  pool.totalValueLockedToken1 = ZERO_BD;
  pool.totalValueLockedUSD = ZERO_BD;
  pool.txCount = ZERO_BI;
  pool.save();

  let protocol = getOrCreateProtocol();
  protocol.poolCount = protocol.poolCount.plus(BigInt.fromI32(1));
  protocol.save();
}

export function handleV3PoolCreated(event: V3PoolCreated): void {
  let token0 = getOrCreateToken(event.params.token0);
  let token1 = getOrCreateToken(event.params.token1);

  let pool = new Pool(event.params.pool.toHexString());
  pool.version = "V3";
  pool.createdAtTimestamp = event.block.timestamp;
  pool.createdAtBlockNumber = event.block.number;
  pool.token0 = token0.id;
  pool.token1 = token1.id;
  pool.feeTier = BigInt.fromI32(event.params.fee);
  pool.liquidity = ZERO_BI;
  pool.sqrtPriceX96 = ZERO_BI;
  pool.tick = BigInt.fromI32(event.params.tickSpacing);
  pool.token0Price = ZERO_BD;
  pool.token1Price = ZERO_BD;
  pool.volumeToken0 = ZERO_BD;
  pool.volumeToken1 = ZERO_BD;
  pool.volumeUSD = ZERO_BD;
  pool.totalValueLockedToken0 = ZERO_BD;
  pool.totalValueLockedToken1 = ZERO_BD;
  pool.totalValueLockedUSD = ZERO_BD;
  pool.txCount = ZERO_BI;
  pool.save();

  let protocol = getOrCreateProtocol();
  protocol.poolCount = protocol.poolCount.plus(BigInt.fromI32(1));
  protocol.save();

  V3PoolTemplate.create(event.params.pool);
}
