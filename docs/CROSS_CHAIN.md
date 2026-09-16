# ZENITH Cross-Chain Engine & Settlement Specification

## 1. Overview

`ZenithCrossChainRouter.sol` coordinates multi-chain swap execution across EVM networks using native intent mechanics and bridge adapters.

## 2. 12-State Deterministic Lifecycle

Cross-chain operations transition through a rigorous state machine:

1. `QUOTE_RECEIVED`: Route and fees calculated from verified network states.
2. `QUOTE_VALIDATED`: Token decimals, slippage limits, and bridge compatibility confirmed.
3. `SOURCE_SWAP_REQUIRED`: Source chain AMM swap needed to convert source asset into bridgeable asset.
4. `SOURCE_SWAP_SUBMITTED`: Source AMM swap submitted to network mempool.
5. `SOURCE_SWAP_CONFIRMED`: Source transaction mined and receipt validated.
6. `BRIDGE_SUBMITTED`: Bridge deposit payload submitted to canonical bridge contract.
7. `BRIDGE_IN_FLIGHT`: Bridge cross-chain message transmitted.
8. `BRIDGE_CONFIRMED`: Bridge relayer/validator consensus finalized.
9. `DESTINATION_SWAP_REQUIRED`: Destination AMM swap required to convert bridged asset to destination token.
10. `DESTINATION_SWAP_SUBMITTED`: Destination swap transaction broadcast.
11. `DESTINATION_SWAP_CONFIRMED`: Destination swap receipt confirmed.
12. `COMPLETED`: Destination balance change verified on-chain.

### Failure / Refund States:
- `SOURCE_SWAP_FAILED`
- `BRIDGE_FAILED`
- `DESTINATION_SWAP_FAILED`
- `TIMEOUT`
- `REFUND_REQUIRED`

## 3. Bridge Integration & Adapter Policy

- Real bridge adapters (Across V3, deBridge DLN, Stargate V2) are utilized when genuine network and credential configuration is active.
- If bridge infrastructure or API credentials are unavailable, the engine fails closed with structured error `ZENITH_BRIDGE_UNSUPPORTED` or `CROSS_CHAIN_QUOTE_UNAVAILABLE`.
- Mocking bridge completion in production is strictly prohibited.
