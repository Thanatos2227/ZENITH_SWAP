# ZENITH SWAP — Treasury & Fee Controller Security Model

This document outlines the formal security invariants, threat mitigations, and access control boundaries for the ZENITH SWAP Treasury Vault and Fee Controller architecture.

---

## 1. Non-Custodial Revenue Principle
**Invariant**: The Treasury contract is strictly a protocol-revenue repository.
- It **never** receives, holds, or custodies user swap principal.
- It **never** issues arbitrary `transferFrom` calls against end-user addresses.
- User swap amounts flow directly from the user to the AMM pool pairs; only the computed protocol fee percentage is routed to `ZenithTreasury.depositERC20Fee` or `depositNativeFee`.

---

## 2. External Secret Management & Production Key Separation
**Invariant**: No production private key, mnemonic, seed phrase, or secret is stored or exposed within this repository.
- Production contract deployments require explicit governance multisig addresses passed at initialization time.
- All deployments use external hardware security modules (HSM), MPC custody, or multi-signature setups (Gnosis Safe).
- The repository `.gitignore` strictly rejects `.env`, `.env.*`, and credentials.

---

## 3. Two-Step Governance Handover
**Invariant**: All governance administrative transfers are protected by a two-step handshake.
- Single-step `transferOwnership` is prohibited.
- Flow:
  1. Current `governance` calls `transferGovernance(newGovernance)`. This sets `pendingGovernance = newGovernance` and emits `GovernanceTransferInitiated`.
  2. The `newGovernance` must explicitly call `acceptGovernance()` from the designated address.
- Mitigates catastrophic typos or zero-address governance loss.

---

## 4. Explicit Collector Authorization
**Invariant**: Only verified protocol routers may deposit protocol fees.
- `ZenithTreasury` enforces the `onlyAuthorizedCollector` modifier on both `depositERC20Fee` and `depositNativeFee`.
- Arbitrary actors cannot call deposit functions to manipulate internal accounting or front-run deposits.
- The `isFeeCollector` role is controlled solely by governance.

---

## 5. Hard Protocol Fee Ceilings
**Invariant**: Protocol fee parameters cannot be manipulated beyond mathematical bounds.
- `MAX_PROTOCOL_FEE_BPS = 30` (0.30%).
- `MAX_CROSS_CHAIN_FEE_BPS = 30` (0.30%).
- Even compromised governance cannot increase protocol fees above these hardcoded constants.

---

## 6. Governance-Only Withdrawals & Emergency Controls
**Invariant**: Treasury assets can only be withdrawn to governance-approved recipients.
- `withdraw(token, recipient, amount)` is protected by `onlyGovernance`, `whenNotPaused`, and reentrancy mutex locks.
- Zero amounts, zero addresses, and withdrawals exceeding active contract balance immediately revert.
- `setEmergencyPause(true)` halts all fee deposits and normal withdrawals instantly.
- `rescueToken(token, recipient, amount)` remains available to governance to recover mistakenly sent foreign tokens without bypassing pause protections.

---

## 7. Fail-Closed Deployment Model
**Invariant**: Unconfigured chain deployments fail closed rather than falling back to placeholder addresses.
- Missing contract addresses in `deployments/<chainId>.json` are set to `null`.
- The TypeScript SDK and routing providers throw `ConfigurationError` (`ZENITH_TREASURY_NOT_CONFIGURED`, `ZENITH_FEE_CONTROLLER_NOT_CONFIGURED`, etc.).
- The system never silently diverts fees to fallback chains or synthetic addresses.
