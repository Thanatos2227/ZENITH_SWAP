# ZENITH Protocol — Authoritative Build & Runtime Matrix

This document defines and audits the environment consistency across Local Development, CI Verification, and Production Targets.

## 1. Environment & Toolchain Matrix

| Component | Local Workspace | CI Pipeline (GitHub Actions) | Production Target (Docker / VM) | Compatibility / Match Status |
| :--- | :--- | :--- | :--- | :--- |
| **Operating System** | Windows 11 (x64) | Ubuntu 22.04 LTS (x64) | Alpine / Debian Slim (Linux x64) | **COMPATIBLE** (cross-platform Node scripts, forward-slash/path normalizers) |
| **Node.js Engine** | v24.14.0 (satisfies `>=22.13.0`) | v22.13.0 | v22.13.0+ LTS | **VERIFIED** (DatabaseSync available natively) |
| **Package Manager** | npm 11.9.0 | npm 10.8.2 | npm 10.8.2+ | **VERIFIED** (Deterministic package-lock.json v3) |
| **TypeScript** | ^5.4.5 | ^5.4.5 | ^5.4.5 | **EXACT MATCH** |
| **Persistence Engine**| `node:sqlite` DatabaseSync (SQLite 3.51.2) | `node:sqlite` DatabaseSync | `node:sqlite` DatabaseSync | **EXACT MATCH** (Fail-closed on unsupported runtimes) |
| **Solidity Compiler** | ^0.8.24 (Via Foundry/Hardhat) | ^0.8.24 via Foundry nightly | ^0.8.24 | **EXACT MATCH** |
| **Foundry Toolchain** | Not installed locally (EVM tests simulated via TSX/viem/ethers) | Foundry Nightly (`forge test -vvv`, `forge build`) | Not applicable to container runtime | **CLASSIFIED** (Local Foundry optional, CI Foundry mandatory) |
| **Crypto Subsystem** | WebCrypto / `node:crypto` | WebCrypto / `node:crypto` | WebCrypto / `node:crypto` | **EXACT MATCH** |
| **Network RPC Client**| `MultiProviderRpcClient` | `MultiProviderRpcClient` | `MultiProviderRpcClient` | **EXACT MATCH** |

---

## 2. Execution & Build Pipeline Reproducibility

### Local Commands
```bash
npm run validate:runtime
npm run validate:networks
npm run audit:anti-mock
npm run audit:security
npm run type-check
npm run lint
npm test
npm run build
```

### CI Pipeline Commands (`.github/workflows/ci.yml`)
```bash
npm ci
npm run validate:runtime
npm run validate:networks
npm run audit:anti-mock
npm run audit:security
npm run type-check
npm run lint
npm test
cd contracts/evm && forge build --sizes && forge test -vvv
npm run build
```

---

## 3. Environment Variable & Secret Isolation

| Variable Scope | Environment | Injection Mechanism | Hardening Status |
| :--- | :--- | :--- | :--- |
| `ZENITH_LOCAL_PRIVATE_KEY` | Local Development / Anvil | `.env.local` / Anvil Defaults | Non-production deterministic keys |
| `TESTNET_PRIVATE_KEY` | Testnet Validation | `.env` / Process Environment | Strictly rejected if directed at Mainnet RPCs |
| `ZENITH_MAINNET_PRIVATE_KEY`| Production Mainnet | AWS KMS / GCP KMS / HSM | Disabled during pre-commissioning phase |
| `RPC_URL_*` | All Environments | Scoped Provider Registry | Multi-provider quorum with `eth_chainId` validation |

---

## 4. Invariant Enforcement Summary

1. **No Silent Polyfills:** If `node:sqlite` or `DatabaseSync` is absent, the runtime validator and state repository abort immediately with code 1.
2. **Deterministic BigInt Precision:** Floating-point `Number` arithmetic is strictly forbidden for token accounting and cross-chain execution.
3. **No Synthetic Mocking:** Unit tests, integration tests, and CI tests execute against real mathematical models, cryptographic primitives, and authoritative schema validators.
