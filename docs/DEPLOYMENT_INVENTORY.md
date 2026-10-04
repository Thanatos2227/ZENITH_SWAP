# ZENITH — Smart Contract Deployment Inventory

## Overview

This document records the deployment status, contract addresses, chain IDs, proxy architectures, and verification records across all ZENITH environments.

---

## 1. Network Deployment Matrix

| Network | Chain ID | Environment | Router Status | Treasury Status | Circuit Breaker | Deployment Stage |
|---|---|---|---|---|---|---|
| **Ethereum Mainnet** | 1 | Production | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNCOMMISSIONED` |
| **Polygon Mainnet** | 137 | Production | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNCOMMISSIONED` |
| **Arbitrum One** | 42161 | Production | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNCOMMISSIONED` |
| **Base Mainnet** | 8453 | Production | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNCOMMISSIONED` |
| **Optimism Mainnet** | 10 | Production | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNCOMMISSIONED` |
| **BNB Chain** | 56 | Production | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNCOMMISSIONED` |
| **Avalanche C-Chain** | 43114 | Production | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNDEPLOYED` (`null`) | `UNCOMMISSIONED` |
| **Ethereum Sepolia** | 11155111 | Testnet | `PRE_DEPLOYMENT_CONFIGURED` | `PRE_DEPLOYMENT_CONFIGURED` | `PRE_DEPLOYMENT_CONFIGURED` | `TESTNET_STAGING` |
| **Arbitrum Sepolia** | 421614 | Testnet | `PRE_DEPLOYMENT_CONFIGURED` | `PRE_DEPLOYMENT_CONFIGURED` | `PRE_DEPLOYMENT_CONFIGURED` | `TESTNET_STAGING` |
| **Polygon Amoy** | 80002 | Testnet | `PRE_DEPLOYMENT_CONFIGURED` | `PRE_DEPLOYMENT_CONFIGURED` | `PRE_DEPLOYMENT_CONFIGURED` | `TESTNET_STAGING` |
| **Anvil Local Devnet** | 31337 | Local CI/Test | `0xa0Ee7A142d267C1f36714E4a8F75612F20a79720` | `0x0123456789012345678901234567890123456789` | Active | `LOCAL_TESTING_ONLY` |

---

## 2. Smart Contract Source & Compiler Specifications

* **Primary Router:** `contracts/evm/src/ZenithCrossChainRouter.sol`
* **Circuit Breaker:** `contracts/evm/src/ZenithCircuitBreaker.sol`
* **Treasury:** `contracts/evm/src/treasury/ZenithTreasury.sol`
* **Fee Controller:** `contracts/evm/src/treasury/ZenithFeeController.sol`
* **Compiler Version:** Solidity `0.8.28`
* **EVM Version Target:** `cancun` / `paris`
* **Optimization:** Runs: `200`, `viaIR: false`

---

## 3. External Protocol Canonical Integration Endpoints (Mainnet References)

For external DEX and Bridge integrations (which exist on mainnet and are integrated via standard routers):

* **Polygon QuickSwap V3 Router:** `0xf5b509bB0909a69B1c207E495f687a596C168E12`
* **Polygon Uniswap V3 SwapRouter02:** `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`
* **Polygon Across SpokePool:** `0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096`
* **Arbitrum Uniswap V3 SwapRouter02:** `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`
* **Arbitrum Across SpokePool:** `0xe35e9842fceaCA96370B73546658ce59670A880D`
