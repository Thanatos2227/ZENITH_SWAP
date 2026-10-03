# ZENITH Cross-Chain Execution & Settlement Security Model

This document outlines the authoritative security model, execution invariants, trust boundaries, and settlement semantics for `ZenithCrossChainRouter` and the ZENITH cross-chain execution pipeline.

---

## 1. Order Lifecycle & State Machine

Every cross-chain intent processed by `ZenithCrossChainRouter` follows a strictly monotonic on-chain state machine:

```text
       [ NONEXISTENT ]
              │
              │  initiateCrossChainSwap()
              ▼
        [ INITIATED ]
        /           \
       /             \  refundExpiredOrder() [after deadline]
      /               ▼
     │           [ REFUNDED ] (Terminal)
     │
     │  fulfillCrossChainOrder() [authorized solver, before deadline]
     ▼
[ FULFILLED ] (Terminal)
```

### Invariants:
- **Existence Enforcement**: `NONEXISTENT → FULFILLED` is strictly prohibited. Orders must be initiated with real deposited assets.
- **Double-Fill Prevention**: `FULFILLED → FULFILLED` reverts immediately.
- **Mutual Exclusion**: An order cannot be refunded once fulfilled (`FULFILLED → REFUNDED` reverts), nor fulfilled once refunded (`REFUNDED → FULFILLED` reverts).
- **Time Window**: Fulfillment is permitted only while `block.timestamp <= order.deadline`. Refunds are permitted only when `block.timestamp > order.deadline`.

---

## 2. Solver Authorization

- Only addresses explicitly whitelisted in `authorizedSolvers[solver]` by the protocol Governance Safe (`owner`) may call `fulfillCrossChainOrder()`.
- Unauthorized third-party callers revert with `"ZenithCrossChainRouter: Unauthorized solver"`.
- Governance can atomically revoke a compromised solver via `setSolverAuthorization(solver, false)`.

---

## 3. Recipient Binding

- The fulfillment recipient is strictly bound to `order.recipient`.
- Calling `fulfillCrossChainOrder()` with a divergent recipient reverts with `"ZenithCrossChainRouter: Recipient mismatch"`.
- Solvers cannot redirect user funds to intermediate or attacker addresses.

---

## 4. Minimum-Output Guarantee

- The contract verifies `params.outputAmount >= order.minAmountOut`.
- Fulfillments attempting to deliver less than `order.minAmountOut` revert with `"ZenithCrossChainRouter: Output below minimum"`.
- Protection against solver slippage extraction or partial fills is enforced at the contract layer.

---

## 5. Destination Token Semantics

- Destination tokens are validated on-chain via `_validateDestinationToken()`.
- For EVM destination tokens specified by contract address, the solver must supply the exact matching ERC20 token address.
- For native assets (`ETH`, `POL`, `MATIC`, `AVAX`, `BNB`, `NATIVE`, or `address(0)`), the solver must supply native currency with exact matching `msg.value == params.outputAmount`.
- Token mismatch reverts with `"ZenithCrossChainRouter: Destination token mismatch"`.

---

## 6. Refund Semantics

- If an order is not fulfilled prior to `order.deadline`, the user (or any caller on the user's behalf) can invoke `refundExpiredOrder(orderId)`.
- The router transfers the exact net deposited funds (`order.amountIn`) back to `order.user`.
- Reentrancy guards (`nonReentrant`) and state updates (`refundedOrders[orderId] = true`) precede fund release.

---

## 7. Nonce & Replay Protection

- Each user has a distinct namespace `executedNonces[msg.sender][nonce]`.
- Replaying the same nonce by the same sender reverts with `"ZenithCrossChainRouter: Nonce already used"`.
- Independent users can utilize identical nonce integers without cross-account collision or interference.

---

## 8. Circuit Breaker Integration

- `ZenithCrossChainRouter` integrates with `ZenithCircuitBreaker`.
- When emergency guardian or governance triggers a pause, `initiateCrossChainSwap()`, `fulfillCrossChainOrder()`, and `refundExpiredOrder()` are paused.

---

## 9. Settlement Evidence & Persistence

- Persistence records in SQLite require real on-chain transaction hashes, block receipts, and multi-node RPC verification before marking `verified = true`.
- An off-chain database flag is never accepted as authoritative proof of settlement without verified block finality.

---

## 10. Trust Boundaries

```text
[ USER EOA ] ────(Deposit)────► [ SOURCE CHAIN: ZenithCrossChainRouter ]
                                             │
                                     (Event Monitored)
                                             ▼
                                [ OFF-CHAIN SOLVER NETWORK ]
                                             │
                                   (Pre-Flight Simulation)
                                             ▼
[ RECIPIENT ] ◄───(Payout)──── [ DESTINATION CHAIN: Solver Settlement ]
```

| Boundary | On-Chain Guarantee | Off-Chain Operator Guarantee |
|---|---|---|
| Source Deposit | Funds locked in router until fulfilled or expired | Event indexed and submitted to solver pipeline |
| Settlement Validation | Recipient, amount, and token verified on-chain | Route optimization, gas pricing, speed |
| Finality | Local state monotonicity | Cross-chain block confirmation threshold verification |

---

## 11. Deployment Authority

- The `owner` of `ZenithCrossChainRouter` is set at constructor initialization to the protocol `governance` address (Multisig Safe).
- The deployer EOA retains zero permanent administrative or privileged authority post-broadcast.

---

## 12. Known Limitations

- Destination execution on foreign non-EVM chains relies on the solver network's cryptographic state proofs or canonical cross-chain bridge finality.
- In extreme network reorgs (> 128 blocks), solver recovery handles state reconciliation via standard idempotent replay.
