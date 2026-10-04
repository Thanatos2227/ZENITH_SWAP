# ZENITH — Testnet Multi-Source Reconciliation Matrix

## Evidence Reconciliation Table

| Field | Expected Source | Authoritative Source | Reconciliation Rule | Failure Mode |
|---|---|---|---|---|
| **Intent ID** | User Intent | Plan Seal & SQLite Intent | Exact String Match | `INTENT_MISMATCH` |
| **Plan Hash** | Sealed Plan | `computeExecutionPlanHash()` | Exact SHA-256 Match | `PLAN_INTEGRITY_VIOLATION` |
| **Source Chain ID** | Intent / Route | `eth_chainId` RPC Response | Exact Numeric Equality | `BROADCAST_BLOCKED` |
| **Destination Chain ID** | Intent / Route | Destination Tx Receipt / RPC | Exact Numeric Equality | `STATUS_CONFLICT` |
| **Token In** | Intent | Decoded Tx Calldata | Exact Checksummed Address | `SEMANTIC_DIVERGENCE` |
| **Token Out** | Intent | Destination `Transfer` Event Log | Exact Checksummed Address | `STATUS_CONFLICT` |
| **Recipient** | User Intent | Destination `Transfer` / Tx Target | Exact Checksummed Address | `STATUS_CONFLICT` |
| **Delivered Amount** | $\ge$ `minimumAmountOutRaw` | Summed Event Values / Delta | Raw BigInt Comparison | `STATUS_CONFLICT` |
| **Receipt Status** | Mined Block | Node RPC `eth_getTransactionReceipt` | `status === 1` | `DESTINATION_FAILED` |
| **Finality Depth** | Network Policy | Current Block - Receipt Block | Depth $\ge$ Safe Threshold | `FINALITY_PENDING` |
