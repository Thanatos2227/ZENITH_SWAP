# ZENITH SWAP Security Architecture & Invariants

## 1. Security Invariants

1. **Non-Custodial Protocol Revenue Custody:**
   `ZenithTreasury.sol` strictly accepts protocol fee deposits and never has authority to transfer arbitrary user tokens.

2. **Reentrancy Protection:**
   All state-mutating external entry points in `ZenithTreasury`, `ZenithRouter`, `ZenithCrossChainRouter`, `ZenithV1Pair`, `ZenithV2Pool`, and `ZenithV3Pool` employ mutex guards.

3. **Two-Step Governance:**
   Governance transfer requires active acceptance by the designated pending address to prevent irreversible loss of control.

4. **Fee Ceilings:**
   Protocol fees cannot exceed 30 BPS (0.30%) as enforced by hard constraints in `ZenithFeeController`.

5. **Exact Integer Arithmetic:**
   Zero floating-point operations in Solidity and TypeScript financial paths prevent rounding exploit vectors.

6. **Pre-Flight Simulation:**
   Transactions undergo `eth_call` simulation prior to user signature requests.
