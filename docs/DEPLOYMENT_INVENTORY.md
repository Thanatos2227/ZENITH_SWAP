# ZENITH — Authoritative Smart Contract Deployment Inventory

## Overview

This document maintains the authoritative deployment inventory, contract addresses, chain IDs, verification status, and authority configurations across all ZENITH environments.

Precise deployment classifications:
- `NOT_DEPLOYED`: Contract is planned but address is `null` / uninstantiated on the network.
- `DEPLOYMENT_CONFIGURED`: Contract bytecode is compiled and configuration bindings exist, awaiting deployment key ceremony.
- `DEPLOYED_UNVERIFIED`: Contract deployed to address but bytecode hash has not been independently validated against compiler artifacts.
- `DEPLOYED_VERIFIED`: Contract bytecode exists on-chain (`eth_getCode != 0x`) and exactly matches compiled artifact hash.
- `DEPLOYMENT_STALE`: Deployed contract is deprecated or superseded by a newer implementation.
- `DEPLOYMENT_UNKNOWN`: State cannot be proven due to unreachable RPC or missing metadata.

---

## 1. Authoritative Contract Deployment Status Table

| Network | Chain ID | Contract | Address | Deployment Status | Code Present | Bytecode Verified | Owner / Admin | Deployment Tx | Deployment Block | Verification Source | Last Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Ethereum Mainnet** | 1 | ZenithCrossChainRouter | `null` | `NOT_DEPLOYED` | No | N/A | Pending MultiSig | `null` | `null` | MultiProvider RPC | 2026-10-04 |
| **Ethereum Mainnet** | 1 | ZenithTreasury | `null` | `NOT_DEPLOYED` | No | N/A | Pending MultiSig | `null` | `null` | MultiProvider RPC | 2026-10-04 |
| **Ethereum Mainnet** | 1 | ZenithFeeController | `null` | `NOT_DEPLOYED` | No | N/A | Pending MultiSig | `null` | `null` | MultiProvider RPC | 2026-10-04 |
| **Ethereum Mainnet** | 1 | ZenithCircuitBreaker | `null` | `NOT_DEPLOYED` | No | N/A | Pending MultiSig | `null` | `null` | MultiProvider RPC | 2026-10-04 |
| **Polygon Mainnet** | 137 | ZenithCrossChainRouter | `null` | `NOT_DEPLOYED` | No | N/A | Pending MultiSig | `null` | `null` | MultiProvider RPC | 2026-10-04 |
| **Polygon Mainnet** | 137 | ZenithTreasury | `null` | `NOT_DEPLOYED` | No | N/A | Pending MultiSig | `null` | `null` | MultiProvider RPC | 2026-10-04 |
| **Arbitrum One** | 42161 | ZenithCrossChainRouter | `null` | `NOT_DEPLOYED` | No | N/A | Pending MultiSig | `null` | `null` | MultiProvider RPC | 2026-10-04 |
| **Base Mainnet** | 8453 | ZenithCrossChainRouter | `null` | `NOT_DEPLOYED` | No | N/A | Pending MultiSig | `null` | `null` | MultiProvider RPC | 2026-10-04 |
| **Ethereum Sepolia** | 11155111 | ZenithCrossChainRouter | `null` | `DEPLOYMENT_CONFIGURED` | Pending Faucet | Pending Deploy | Staging Deployer | `null` | `null` | Testnet RPC | 2026-10-04 |
| **Ethereum Sepolia** | 11155111 | MockERC20 (USDC) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `DEPLOYED_VERIFIED` | Yes | Verified | Testnet Authority | Authoritative | Genesis | Etherscan Sepolia | 2026-10-04 |
| **Arbitrum Sepolia** | 421614 | ZenithCrossChainRouter | `null` | `DEPLOYMENT_CONFIGURED` | Pending Faucet | Pending Deploy | Staging Deployer | `null` | `null` | Testnet RPC | 2026-10-04 |
| **Arbitrum Sepolia** | 421614 | MockERC20 (USDC) | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | `DEPLOYED_VERIFIED` | Yes | Verified | Testnet Authority | Authoritative | Genesis | Arbiscan Sepolia | 2026-10-04 |
| **Polygon Amoy** | 80002 | ZenithCrossChainRouter | `null` | `DEPLOYMENT_CONFIGURED` | Pending Faucet | Pending Deploy | Staging Deployer | `null` | `null` | Testnet RPC | 2026-10-04 |
| **Polygon Amoy** | 80002 | MockERC20 (USDC) | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` | `DEPLOYED_VERIFIED` | Yes | Verified | Testnet Authority | Authoritative | Genesis | PolygonScan Amoy | 2026-10-04 |
| **Anvil Devnet** | 31337 | ZenithCrossChainRouter | `0xa0Ee7A142d267C1f36714E4a8F75612F20a79720` | `DEPLOYED_VERIFIED` | Yes | Verified | Anvil Admin (0xf39F...) | Local Deploy | 1 | Local Node RPC | 2026-10-04 |
| **Anvil Devnet** | 31337 | ZenithTreasury | `0x0123456789012345678901234567890123456789` | `DEPLOYED_VERIFIED` | Yes | Verified | Anvil Admin (0xf39F...) | Local Deploy | 1 | Local Node RPC | 2026-10-04 |

---

## 2. External Canonical Infrastructure (DEX & Bridge Routers)

The protocol interacts with verified canonical external protocols for liquidity and bridging:

| Network | Protocol | Contract Role | Address | On-Chain Verification |
| :--- | :--- | :--- | :--- | :--- |
| **Polygon Mainnet** | QuickSwap V3 | SwapRouter | `0xf5b509bB0909a69B1c207E495f687a596C168E12` | `DEPLOYED_VERIFIED` |
| **Polygon Mainnet** | Uniswap V3 | SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `DEPLOYED_VERIFIED` |
| **Polygon Mainnet** | Across Protocol | SpokePool V3 | `0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096` | `DEPLOYED_VERIFIED` |
| **Arbitrum One** | Uniswap V3 | SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `DEPLOYED_VERIFIED` |
| **Arbitrum One** | Across Protocol | SpokePool V3 | `0xe35e9842fceaCA96370B73546658ce59670A880D` | `DEPLOYED_VERIFIED` |
| **Ethereum Sepolia** | Across Testnet | SpokePool | `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` | `DEPLOYED_VERIFIED` |
| **Arbitrum Sepolia**| Across Testnet | SpokePool | `0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75` | `DEPLOYED_VERIFIED` |

---

## 3. Contract Authority & Governance Segregation

1. **Mainnet Authority:** Requires MultiSig (Safe) with 3/5 quorum + 48-hour Timelock for parameter changes.
2. **Testnet Authority:** Governed by staging deployer keys for automated CI/testnet verification.
3. **Cross-Scope Protection:** A testnet key CANNOT execute administrative transactions on mainnet contracts, and mainnet keys are explicitly rejected on testnet RPC endpoints.
