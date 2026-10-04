# ZENITH — Testnet Finality Verification

## Finality Policies & Gating

* **Arbitrum Sepolia Finality Requirement:** $\ge 12$ confirmation blocks.
* **Polygon Amoy Finality Requirement:** $\ge 20$ confirmation blocks.
* **Ethereum Sepolia Finality Requirement:** $\ge 64$ blocks (Epoch finalized).
* **Decoupled Progression:** Receipts mined with confirmations $<$ threshold remain in `FINALITY_PENDING` and are blocked from transitioning to `SETTLED`.
* **Reorg Invalidation:** If `currentBlockNumber < receiptBlockNumber` or block hash changes, state transitions to `REORG_DETECTED` and halts all progression.
