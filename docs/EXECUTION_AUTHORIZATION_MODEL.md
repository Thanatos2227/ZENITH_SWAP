# ZENITH — Execution Authorization Model

## Executive Overview

The ZENITH Cross-Chain Execution Authorization Model defines the formal cryptographic, semantic, and on-chain verification pipeline connecting user intent to authoritative cross-chain settlement.

```text
USER INTENT
    ↓
ROUTE DISCOVERY
    ↓
ROUTE ARBITRATION
    ↓
EXECUTION PLAN
    ↓
PLAN INTEGRITY SEAL
    ↓
SECURITY AUTHORIZATION
    ↓
TRANSACTION SEMANTICS
    ↓
ECONOMIC SAFETY GATING
    ↓
SOURCE EXECUTION
    ↓
SOURCE OUTPUT EXTRACTION
    ↓
BRIDGE QUOTE REFRESH (Composite)
    ↓
BRIDGE EXECUTION & RELAY
    ↓
DESTINATION EXECUTION
    ↓
DESTINATION EVIDENCE VERIFICATION
    ↓
FINALITY CONFIRMATION
    ↓
AUTHORITATIVE SETTLEMENT PERSISTENCE
```

---

## 1. Evidence Hierarchy & Classification

| Tier | Name | Authority Classification | Mutation Permitted | Can Assert SETTLED |
|---|---|---|---|---|
| **Tier 1** | On-Chain Receipt | `AUTHORITATIVE` | No | Yes (with Transfer / Value) |
| **Tier 2** | On-Chain Tx Lookup | `AUTHORITATIVE` | No | Preflight / Correlation Only |
| **Tier 3** | ERC20 Transfer Event | `AUTHORITATIVE` | No | Yes (meets minimum & recipient) |
| **Tier 4** | Recipient Balance Delta | `VERIFIABLE` | No | Yes (requires pre-bridge baseline) |
| **Tier 5** | Provider API Progress | `DIAGNOSTIC` | No | No (remains UNCERTAIN without receipt) |
| **Tier 6** | Local Cache / Optimistic | `NON-AUTHORITATIVE` | No | Strictly Prohibited |

---

## 2. Stage-by-Stage Verification Contracts

### 2.1 User Intent (`STAGE_01_USER_INTENT`)
* **Input Parameters:** `intentId`, `userAddress`, `recipientAddress`, `sourceChainId`, `destinationChainId`, `tokenInAddress`, `tokenOutAddress`, `amountInRaw`, `slippageBps`.
* **Validation Invariant:** All addresses must be checksummed EVM/Solana addresses; amount must be positive raw integer. Once submitted, parameters are immutable.

### 2.2 Route Discovery & Arbitration (`STAGE_02` & `STAGE_03`)
* **Provider Scoring:** Routes evaluated deterministically by net destination output after gas and bridge fees.
* **Filter:** Stale quotes (>60s) or quotes failing capability checks are rejected.

### 2.3 Execution Plan Generation & Sealing (`STAGE_04` & `STAGE_05`)
* **Canonical Serialization:** Objects serialized with recursive deterministic key sorting (`canonicalStringify`).
* **Integrity Commitment (`computeExecutionPlanHash`):** Covers `intentId`, `sourceChainId`, `destinationChainId`, `tokenIn`, `tokenOut`, `expectedAmountInRaw`, `minimumAmountOutRaw`, `expectedAmountOutRaw`, `recipient`, `expiration`, `routeId`, `routeType`, `selectedDex`, `selectedProvider`, `solver`, `executionTarget`, `approvalTarget`, `calldata`, `totalFeeRaw`, `transactionValue`, `noncePolicy`, `authorizationScope`, and step-level arrays.
* **Immutability:** Any post-seal mutation breaks the hash and triggers `PlanIntegrityBreachError`.

### 2.4 Security Authorization (`STAGE_06`)
* **Boundary Validation:** Compares the sealed execution plan against user authorization context.
* **Enforcement:** Rejects mismatches in recipient, tokens, amounts, chains, and execution targets.

### 2.5 Transaction Semantics & Decoding (`STAGE_07`)
* **Calldata Dissection:** Decodes `depositV3`, Uniswap `exactInputSingle`, `multicall`, and ERC20 `approve`.
* **Parameter Binding:** Confirms decoded calldata targets expected recipient, token, and minimum amount out.

### 2.6 Economic Safety & Slippage Ceiling (`STAGE_08`)
* **Validation:** `expectedAmountOut >= minimumAmountOut > 0`. Slippage cannot exceed protocol ceiling (max 1000 bps).

### 2.7 Source Execution & Output Extraction (`STAGE_09` & `STAGE_10`)
* **Receipt Status:** Must have `status === 1`. Reverted receipts (`status === 0`) fail immediately.
* **Output Extraction:** For multi-step swaps, extracts actual delivered intermediate tokens from `Transfer` logs rather than assuming quoted amounts.

### 2.8 Bridge Refresh & Execution (`STAGE_11`, `STAGE_12`, `STAGE_13`)
* **Dynamic Refresh:** Refreshed bridge deposit amount must exactly match actual source swap output.
* **Slippage Check:** Refreshed bridge minimum output must satisfy original user-authorized minimum.

### 2.9 Destination Evidence & Finality (`STAGE_14`, `STAGE_15`, `STAGE_16`)
* **Transfer Matching:** Sums ERC20 `Transfer` events to `expectedRecipient` for `expectedToken`.
* **Reorg Guard:** Compares `currentBlockNumber` against receipt `blockNumber` and `expectedBlockHash`.
* **Finality Threshold:** Requires depth $\ge$ `reorgSafetyBlocks` before settlement transition.

### 2.10 Authoritative Settlement Persistence (`STAGE_17`)
* **Atomic DB Invariant:** Verified settlement rows are written only upon `DESTINATION_SETTLED`. Regression from verified to unverified is rejected by SQLite trigger / conflict rule.
