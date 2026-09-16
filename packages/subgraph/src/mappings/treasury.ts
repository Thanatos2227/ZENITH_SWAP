import { BigInt, BigDecimal } from "@graphprotocol/graph-ts";
import { FeeReceived } from "../../generated/ZenithTreasury/ZenithTreasury";
import { TreasuryFeeEvent, ZenithProtocol, Token } from "../../generated/schema";

const PROTOCOL_ID = "zenith-v4-canonical";
const ZERO_BD = BigDecimal.fromString("0");

export function handleFeeReceived(event: FeeReceived): void {
  let eventId = event.transaction.hash.toHexString().concat("-").concat(event.logIndex.toString());
  let feeEvent = new TreasuryFeeEvent(eventId);
  feeEvent.transactionHash = event.transaction.hash;
  feeEvent.timestamp = event.block.timestamp;
  feeEvent.token = event.params.token.toHexString();
  feeEvent.sender = event.params.sender;
  feeEvent.amount = event.params.amount.toBigDecimal();
  feeEvent.amountUSD = ZERO_BD;
  feeEvent.save();

  let protocol = ZenithProtocol.load(PROTOCOL_ID);
  if (protocol !== null) {
    protocol.totalTreasuryFeesUSD = protocol.totalTreasuryFeesUSD.plus(ZERO_BD);
    protocol.save();
  }
}
