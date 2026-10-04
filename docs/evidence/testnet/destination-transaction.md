# ZENITH — Testnet Destination Transaction Verification

## Destination Verification Requirements

* **Target Network:** Arbitrum Sepolia (`421614`)
* **Verification Logic:** `verifyDestinationSettlement()`
* **Evidence Hierarchy:**
  - **Tier 1:** On-Chain Receipt (`status === 1`)
  - **Tier 3:** Aggregated ERC20 `Transfer(from, to, value)` event logs matching `recipient` and `token`
  - **Tier 4:** Recipient balance delta requiring verified `preBridgeBalanceRaw` baseline
* **Discrepancy Invariants:** Mismatched token address, recipient address, or amount $< \text{minimumAmountOutRaw}$ triggers `STATUS_CONFLICT`.
