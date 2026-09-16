# ZENITH SWAP Treasury Specification

## 1. Overview & Non-Custodial Invariant

`ZenithTreasury.sol` is the authoritative protocol revenue vault for ZENITH SWAP.

### Invariant:
- The Treasury strictly receives and manages **protocol fee revenue**.
- The Treasury **never** custodies user swap principal or LP funds.
- Unauthorized accounts cannot withdraw funds or deposit arbitrary assets without going through authorized collectors.

---

## 2. Governance Architecture

- **Two-Step Governance Handover:**
  - `transferGovernance(address newGovernance)`: Nominates a pending governance address.
  - `acceptGovernance()`: Must be called by the pending governance account to finalize the transfer.
  - Prevents irrevocable loss of contract ownership through typo or zero address assignments.

- **Collector Authorization:**
  - `setAuthorizedCollector(address collector, bool authorized)`: Restricts deposit access to verified protocol routers (`ZenithRouter`, `ZenithCrossChainRouter`).

- **Secure Withdrawals:**
  - `withdrawERC20(address token, address to, uint256 amount)`
  - `withdrawNative(address payable to, uint256 amount)`
  - Only callable by active governance.

- **Emergency Controls:**
  - `setPaused(bool paused)`: Immediate circuit-breaker capability for emergency response.

---

## 3. Deployment Configuration

| Chain | Treasury Address | Fee Controller | Governance Status |
|---|---|---|---|
| Localhost (31337) | Deployed via Foundry | Deployed via Foundry | Local Test Account |
| Ethereum (1) | Chain-Specific Safe Multisig | Chain-Specific FeeController | Multisig Controlled |
| Polygon (137) | Chain-Specific Safe Multisig | Chain-Specific FeeController | Multisig Controlled |
| Base (8453) | Chain-Specific Safe Multisig | Chain-Specific FeeController | Multisig Controlled |
