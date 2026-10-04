# ZENITH — Production Commissioning Gate Specification

## Purpose

This document establishes the formal criteria required before any ZENITH execution pipeline route or bridge can transition to production mainnet operation.

---

## 1. Classification of Validation Environments

Every claim of verification in ZENITH must strictly adhere to the following taxonomy:

| Level | Description | Status in CI/Local |
|---|---|---|
| **UNIT TESTED** | Deterministic unit tests covering isolated functions, parsers, and decoders | Verified locally and in CI |
| **INTEGRATION TESTED** | Multi-component pipelines with local in-memory/SQLite persistence and RPC mocks | Verified locally and in CI |
| **LOCAL E2E** | Local test harness executing full pipeline flows | Verified locally |
| **TESTNET VERIFIED** | Live execution on testnets (Sepolia, Amoy, Arbitrum Sepolia) with on-chain receipts | Dependent on testnet faucet availability |
| **MAINNET VERIFIED** | Production execution on mainnet with verifiable on-chain transaction hashes | Requires production deployment |

---

## 2. Mandatory Production Commissioning Criteria

A route is **READY** for production commissioning only when:

1. **Deterministic Test Suite:** 100% of unit, integration, and security tests pass.
2. **Anti-Mock Audit:** Zero production paths use mock providers, synthetic receipts, or hardcoded success.
3. **Smart Contract Verification:** Foundry tests pass in CI container, confirming exact parity between off-chain plan sealing and on-chain router logic.
4. **RPC Multi-Provider Health:** Multi-provider RPC clients are configured with automatic failover, timeout ceilings (max 8s), and latency monitoring.
5. **Circuit Breaker Integration:** `ZenithCircuitBreaker` contracts deployed and active on all target chains.
6. **Telemetry & Observability:** Real-time metrics and event emitters configured for all 17 pipeline stages.

---

## 3. Current Commissioning Status

* **EXECUTION_AUTHORIZATION_INTEGRITY:** `VERIFIED`
* **INTENT_IMMUTABILITY:** `VERIFIED`
* **PLAN_INTEGRITY:** `VERIFIED`
* **AUTHORIZATION_BINDING:** `VERIFIED`
* **TRANSACTION_SEMANTICS:** `VERIFIED`
* **SOURCE_EXECUTION_EVIDENCE:** `VERIFIED`
* **BRIDGE_INTENT_BINDING:** `VERIFIED`
* **DESTINATION_EVIDENCE:** `VERIFIED`
* **FINALITY:** `VERIFIED`
* **SETTLEMENT:** `VERIFIED`
* **REORG_HANDLING:** `VERIFIED`
* **PERSISTENCE_INTEGRITY:** `VERIFIED`
* **SMART_CONTRACT_ALIGNMENT:** `VERIFIED`
* **CI:** `VERIFIED`
* **FOUNDRY:** `LOCAL_FOUNDRY_UNAVAILABLE` (CI-container validated)
* **LIVE_MAINNET_STATUS:** `UNCOMMISSIONED`
* **PRODUCTION_COMMISSIONING:** `CONDITIONAL` (Awaiting live canary mainnet deployment after testnet staging)
