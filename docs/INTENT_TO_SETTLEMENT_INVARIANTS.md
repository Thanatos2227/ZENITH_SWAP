# ZENITH — Intent-to-Settlement Formal Invariants

## Core Principle

> A transaction can reach `SETTLED` ONLY if the exact user intent, authorized execution plan, actual transactions, destination evidence, and finality evidence are cryptographically and logically consistent.

---

## The 20 Mandatory Protocol Invariants

### 1. User Intent Immutability
Once execution begins, `sourceChainId`, `destinationChainId`, `sourceToken`, `destinationToken`, `sourceAmount`, `minimumDestinationAmount`, `recipient`, and `deadline` cannot silently change. Any deviation causes immediate rejection (`AuthorizationBoundaryBreachError`).

### 2. Execution Plan Integrity
Sealed plans are committed via deterministic canonical SHA-256 serialization. Any mutation of route, tokens, amounts, targets, calldata, or steps invalidates the seal (`PlanIntegrityBreachError`).

### 3. Plan-Authorization Binding
Authorization signatures or grant tokens are cryptographically bound to the plan integrity seal. An authorization generated for Plan A cannot be used to execute Plan B.

### 4. Transaction Calldata Dissection
Before signing or broadcasting, transaction calldata is decoded on-chain or via strict ABI decoders to verify that parameters (recipient, token, amount, deadline) match the authorized plan. `to === target` alone is insufficient.

### 5. Transaction Hash is Not Success
A transaction hash proves only that a transaction was submitted or propagated. Only a mined receipt with status code 1 on the canonical chain proves execution.

### 6. Missing Receipt Fails Closed
A missing receipt or RPC timeout leaves the state as `BROADCAST_UNCERTAIN` or `DESTINATION_STATUS_UNCERTAIN`. It never defaults or falls back to success.

### 7. Reverted Receipt Never Settles
A transaction receipt with status 0 or reverted execution immediately sets execution state to `FAILED` or `DESTINATION_FAILED`.

### 8. Unrelated Transaction Rejection
An unrelated successful transaction on the target chain cannot satisfy settlement. Receipts must contain `Transfer` events or native balance deltas specifically matching the user's recipient address, token contract, and minimum amount.

### 9. Provider Disagreement Fails Closed
If a bridge relayer API claims an order is `FILLED` but the on-chain receipt in the destination block is reverted or delivers to an incorrect recipient, the engine triggers `STATUS_CONFLICT` and halts all state progression.

### 10. Local Cache is Non-Authoritative
Cached or optimistic state is classified as Tier 6 diagnostic evidence. It can never trigger `SETTLED` or `CONFIRMED`.

### 11. Database State Cannot Fabricate Proof
Database records must reflect verifiable on-chain evidence. Attempting to update a settlement record directly to `verified = 1` without receipt and transfer evidence is prohibited. Verified records cannot be regressed by stale replays.

### 12. Cross-Chain Identity Binding
A transaction executed on Chain A cannot satisfy an execution step specified for Chain B. Chain IDs are strictly checked at every pipeline layer.

### 13. Token Contract Verification
Transfers must originate from or interact with the exact authorized canonical token address. Alternate tokens or spoofed symbols are rejected.

### 14. Recipient Strict Matching
Delivered funds must reach `expectedRecipient`. Redirection to intermediary or solver addresses without explicit subsequent transfer to the user fails destination verification.

### 15. Delivered Output $\ge$ Minimum Authorized Output
Settlement requires that the aggregated on-chain delivered amount is greater than or equal to `minimumAmountOutRaw`. Partial fills below the slippage floor are rejected.

### 16. Strict Approval Ceiling
ERC20 approvals are strictly capped at the exact required amount plus an authorized buffer (max 2x budget). Unlimited `type(uint256).max` approvals are prohibited.

### 17. Reorg Safety & Evidence Invalidation
If a reorganization is detected (current block behind receipt block, or block hash mismatch), all provisional settlement evidence is invalidated, and state transitions to `REORG_DETECTED` / `RECOVERY_REQUIRED`.

### 18. Finality Gating
Provisional settlement verification is decoupled from finality. `SETTLED` status requires that destination block depth meets or exceeds chain-specific finality thresholds.

### 19. Atomic Persistence
Database writes for execution steps, transactions, and settlement records are executed within transactional boundaries to prevent partial commits or orphan states.

### 20. Universal Fail-Closed Default
Any catch block, unhandled branch, or missing telemetry event defaults to an unverified, uncertain, or blocked state. No optimistic fallback or synthetic mock success is permitted in production code paths.
