# ZENITH — Transaction Semantic Binding Specification

## Overview

Transaction Semantic Binding ensures that every raw transaction payload constructed, signed, and broadcast by the ZENITH execution engine corresponds strictly to an authorized ExecutionPlan.

---

## 1. Scope of Validation

Before any transaction is signed or dispatched to the network, `validateTransactionPlanEquivalence()` verifies:

1. **Target Contract (`to`):** Must match `plan.executionTarget` or `step.targetAddress`.
2. **Chain ID (`chainId`):** Must match the step's expected network.
3. **Native Value (`value`):** Must be `'0'` for ERC20 swaps/deposits, or equal `plan.expectedAmountInRaw` for native operations.
4. **Calldata Function Selectors:**
   - Across SpokePool: `depositV3` (`0xe48f32c3`)
   - Uniswap V3: `exactInputSingle` (`0x04e45aaf`) or `multicall` (`0x5ae401dc`)
   - ERC20: `approve` (`0x095ea7b3`)
5. **Decoded Calldata Invariants:**
   - `recipient`: Decoded recipient parameter must equal `plan.recipient` or `intent.recipientAddress`.
   - `inputToken` & `outputToken`: Must match token addresses in the plan.
   - `amountIn`: Must match `plan.expectedAmountInRaw`.
   - `minAmountOut`: Must be $\ge$ `plan.minimumAmountOutRaw`.
   - `destinationChainId`: In bridge calls, must match destination chain ID.

---

## 2. ERC20 Allowance and Approval Policy

ZENITH enforces strict approval policies (`validateApprovalSemantics`):

* **No Infinite Approvals:** `type(uint256).max` or `2^256 - 1` triggers `ApprovalPolicyViolationError`.
* **Bounded Multiplier:** Approval amount must not exceed `2 * requiredAmountRaw`.
* **Spender Allowlist:** The `spender` must be present in `ALLOWLISTED_APPROVAL_TARGETS` or match `plan.approvalTarget`.
* **Token Matching:** The approved token address must match `plan.tokenIn.address`.

---

## 3. Replacement & Nonce Semantics

* Transactions with identical nonces are evaluated independently; a replacement transaction must satisfy identical semantic bindings.
* Speed-up / cancel operations must maintain plan correlation and prevent semantic drift.
