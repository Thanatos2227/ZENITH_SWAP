# ZENITH — Production Commissioning Checklist

## 1. Code & Architecture Audits
- [x] End-to-end execution authorization model verified (17 stages)
- [x] Canonical execution plan serialization and cryptographic seal verified
- [x] Security authorization bound to exact plan commitment
- [x] Transaction calldata semantic decoding and parameter binding verified
- [x] Zero-address bypass and anti-mock audit passed (0 violations)
- [x] Comprehensive security & vulnerability audit passed (0 violations)

## 2. Cryptographic & Secret Isolation Boundaries
- [x] `resolveScopedSignerKey()` strictly isolates MAINNET, TESTNET, and LOCAL credentials
- [x] Zero plaintext private keys or mnemonics in source code or git history
- [x] Diagnostics, exception handlers, and loggers scrub private keys and raw signatures
- [x] Multi-signature governance and timelock parameters defined for contract ownership

## 3. Network & Infrastructure Verification
- [x] Canonical network registry validated via `npm run validate:networks`
- [x] Multi-provider RPC architecture configured with fallback and timeout ceilings (max 8s)
- [x] Chain-ID verified via `eth_chainId` before transaction signing or broadcast
- [x] Confirmation depth and reorg safety policies configured for all target networks

## 4. Smart Contract Deployments
- [x] Off-chain TypeScript execution engine aligned with Solidity contracts (`ZenithCrossChainRouter.sol`)
- [x] Local Foundry simulation and unit test suites passing in CI container
- [ ] Live mainnet deployment of sovereign `ZenithCrossChainRouter` (`UNCOMMISSIONED`)
- [ ] Mainnet deployment of `ZenithTreasury`, `ZenithFeeController`, and `ZenithCircuitBreaker` (`UNCOMMISSIONED`)

## 5. Token Registry & Economic Invariants
- [x] Token addresses strictly validated against canonical verified token lists
- [x] Bounded ERC20 approvals enforced (max 2x budget; zero `type(uint256).max`)
- [x] Slippage tolerances strictly capped (max 1000 bps)
- [x] Monetary and balance delta computations strictly use `BigInt` (zero floating point conversions)

## 6. Settlement & Persistence Reliability
- [x] On-chain evidence hierarchy enforced (Tier 1 Receipt > Tier 3 Event > Tier 4 Provenance Delta)
- [x] Block depth / finality gating decoupled from initial confirmation
- [x] Reorg detection invalidates provisional settlement evidence (`REORG_DETECTED`)
- [x] Relational persistence in SQLite enforces foreign key integrity and prevents verified regression

## 7. Controlled Execution Readiness & Testnet Evidence
- [x] Controlled Polygon Canary preflight and simulation verification passing
- [x] Fail-closed gating on missing testnet/mainnet signer keys verified
- [ ] Public testnet funded live transaction executed (`BLOCKED_NO_FUNDED_KEY` / `TESTNET_STAGING`)
- [ ] Live mainnet transaction verification (`UNCOMMISSIONED`)

---

## Commissioning Verdict

* **Code & Authorization Integrity:** `READY`
* **Local & CI Verification:** `READY`
* **Network & RPC Registry:** `READY`
* **Live Mainnet Deployment:** `UNCOMMISSIONED`
* **Overall Production Commissioning Gate:** `CONDITIONAL` (Pending sovereign contract deployment & multi-sig setup on mainnet)
