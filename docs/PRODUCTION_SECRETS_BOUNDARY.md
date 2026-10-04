# ZENITH — Production Secrets & Credential Isolation Boundary

## Purpose

This document establishes the strict security boundaries, isolation rules, and access policies for cryptographic credentials, signers, RPC API keys, and deployment authorities across ZENITH.

---

## 1. Signer & Credential Isolation

To prevent accidental cross-contamination between testnets and production environments, the runtime loader strictly segregates credential resolution:

| Scope | Environment Variables | Authorized Key Source | Target Chains |
|---|---|---|---|
| **MAINNET** | `ZENITH_MAINNET_PRIVATE_KEY` | Hardware KMS / Vault / HSM / Air-gapped Multisig | Polygon (137), Arbitrum (42161), Base (8453), Ethereum (1) |
| **TESTNET** | `TESTNET_PRIVATE_KEY`, `ZENITH_TESTNET_PRIVATE_KEY` | Scoped testnet key (funded via public faucets) | Sepolia (11155111), Arbitrum Sepolia (421614), Polygon Amoy (80002) |
| **LOCAL** | `ZENITH_LOCAL_PRIVATE_KEY`, `ANVIL_PRIVATE_KEY` | Local Anvil/Hardhat deterministic dev accounts | Anvil (31337), Hardhat (1337) |

### Strict Invariants:
1. **Zero Cross-Scope Fallback:** If `resolveScopedSignerKey('TESTNET')` is invoked, the resolver NEVER reads `ZENITH_MAINNET_PRIVATE_KEY`.
2. **Zero Plaintext In-Repo Storage:** No private key or mnemonic is ever committed to source code or git history.
3. **Redaction in Diagnostics:** Loggers and exception handlers automatically mask private keys, mnemonic phrases, and raw signature components.

---

## 2. RPC Credentials & Provider Authentication

* **Public RPC Endpoints:** Rate-limited fallback endpoints for read-only quote discovery and state polling.
* **Dedicated Provider Keys (`ALCHEMY_API_KEY`, `INFURA_API_KEY`, `QUICKNODE_API_KEY`):**
  - Injected via environment or CI secrets manager.
  - Required for broadcast reliability and low-latency subscription feeds.
  - Automatically scrubbed from error logs and telemetry metrics.

---

## 3. Deployment & Contract Administration Authority

* **Treasury & Fee Controllers:** Administered exclusively by multi-signature governance (`Gnosis Safe` on EVM networks).
* **Cross-Chain Router (`ZenithCrossChainRouter`):**
  - `owner`: Multi-sig contract with timelock.
  - `solver`: Whitelisted automated relayers with rate-limited dispatch caps.
  - `circuitBreaker`: Multi-sig emergency pause role.

---

## 4. Secret Boundary Audit Results

* **Repository Codebase Scan:** 0 plaintext secrets, 0 hardcoded private keys.
* **Test Fixture Audit:** All test vectors utilize mock signers, ephemeral `Wallet.createRandom()`, or explicitly labeled zero/test addresses.
* **CI Environment:** Secrets are injected only through GitHub Actions repository encrypted secrets.
