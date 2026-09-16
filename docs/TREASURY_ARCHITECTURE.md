# ZENITH SWAP — Treasury & Fee Controller Architecture

## Executive Overview

ZENITH SWAP implements a sovereign, non-custodial, revenue-only protocol treasury vault architecture. The system decouples protocol fee configuration and authorized collector management (**ZenithFeeController**) from protocol fee custody and accounting (**ZenithTreasury**).

```
                         ZENITH SWAP
                              │
               ┌──────────────┼──────────────┐
               │              │              │
             ZENITH         ZENITH         ZENITH
               V1             V2             V3
               │              │              │
               └──────────────┬──────────────┘
                              │
                       Unified Router (ZenithRouter)
                              │
                       Fee Controller (ZenithFeeController)
                              │
                       Authorized Fee Deposits (depositERC20Fee / depositNativeFee)
                              │
                         Treasury Vault (ZenithTreasury)
                              │
                         Governance (Two-Step Handover)
                              │
                      Multisig / MPC (Gnosis Safe)
```

---

## 1. ZenithTreasury Contract Architecture

The **ZenithTreasury** contract (`contracts/evm/src/treasury/ZenithTreasury.sol`) serves as the sovereign revenue vault for the protocol.

### Invariants:
1. **Revenue-Only Custody**: The Treasury receives and stores *only* accrued protocol fee revenue from authorized collectors. It **never** custodies user swap principal or liquidity deposits.
2. **Authorized Ingestion**: Only addresses explicitly whitelisted in `authorizedCollector` mapping by governance can execute `depositERC20Fee` or `depositNativeFee`.
3. **Cumulative vs. Current Balance Accounting**:
   - `cumulativeFeesCollected[token]` tracks the lifetime raw protocol revenue received.
   - `getTreasuryBalance(token)` queries the active token/native balance currently held.
   - Withdrawals reduce active balance without reducing historical lifetime revenue metrics.
4. **Direct Native Transfers**: Direct transfers to `receive()` emit `DirectNativeReceived` but do **not** increment `cumulativeFeesCollected[address(0)]`, preventing third-party accounting corruption.
5. **Two-Step Governance**: Ownership transfers require `transferGovernance(newGov)` followed by `acceptGovernance()` by `newGov`.
6. **Emergency Circuit Breaker**: Governance can toggle `setEmergencyPause(true)` to immediately halt fee deposits and normal withdrawals during incidents.
7. **Emergency Rescue**: `rescueToken(token, recipient, amount)` allows governance to safely extract non-protocol tokens mistakenly transferred to the vault.

---

## 2. ZenithFeeController Architecture

The **ZenithFeeController** contract (`contracts/evm/src/treasury/ZenithFeeController.sol`) is the authoritative source for protocol fee parameters and pool configurations across all AMM tiers.

### Key Capabilities:
1. **Strict Protocol Fee Ceilings**:
   - `MAX_PROTOCOL_FEE_BPS = 30` (Max 0.30%).
   - `MAX_CROSS_CHAIN_FEE_BPS = 30` (Max 0.30%).
   - Any attempt by governance to set fee basis points above these ceilings will revert with `FeeExceedsMaxCeiling`.
2. **AMM Fee Tier Configuration**:
   - **V1**: Configurable `v1TotalFeeBps` (Default 30 bps = 0.30%).
   - **V2**: Multi-tier whitelist (`5`, `30`, `100` BPS initially enabled).
   - **V3**: Fee tier & tick spacing configuration:
     - `100` fee tier (0.01%) $\rightarrow$ Tick spacing `1`.
     - `500` fee tier (0.05%) $\rightarrow$ Tick spacing `10`.
     - `3000` fee tier (0.30%) $\rightarrow$ Tick spacing `60`.
     - `10000` fee tier (1.00%) $\rightarrow$ Tick spacing `200`.
3. **Treasury & Collector Registry**:
   - Maintains authoritative `treasury` address and `isFeeCollector` permissions.

---

## 3. Protocol Fee Flow Across AMM Tiers

### Zenith V1 (Constant Product AMM)
1. User submits swap via Unified Router or V1 Router.
2. Unified Router computes protocol fee share via `feeController.protocolFeeBps()`.
3. Protocol fee is transferred to `ZenithTreasury.depositERC20Fee()`.
4. Remaining swap amount executes against V1 Pair (`x * y = k`).
5. Net output tokens are delivered to user recipient.

### Zenith V2 (Multi-Fee Constant Product AMM)
1. Pool verifies `feeController.isV2FeeTierAllowed(feeTierBps)`.
2. Swap output is computed using exact integer math according to the pool's fee tier.
3. Protocol fee share is forwarded to `ZenithTreasury`.

### Zenith V3 (Concentrated Liquidity AMM)
1. Pool verifies fee tier and tick spacing against `ZenithFeeController`.
2. Swaps compute price movements and tick crossings via integer `SqrtPriceMath` and `TickBitmap`.
3. Swap fees are calculated strictly within the tick range; protocol fees and LP fee growths (`feeGrowthGlobal0X128`, `feeGrowthGlobal1X128`) are mathematically isolated to ensure LP revenue is never diverted to Treasury.

### Cross-Chain Swaps
1. User submits cross-chain swap intent via `ZenithCrossChainRouter`.
2. Source protocol fee is calculated via `feeController.calculateCrossChainFee(amountIn)`.
3. Protocol fee is deposited into Source `ZenithTreasury`.
4. Net deposit is forwarded to bridge relayer.
5. Quoting breakdown explicitly separates:
   - Source Network Gas
   - Source AMM Fee
   - Zenith Protocol Fee
   - Bridge Fee
   - Destination Gas
   - Destination AMM Fee
   - Destination Zenith Protocol Fee

---

## 4. Deployment and Operational Procedures

### Local Development (Anvil / Hardhat)
1. Run local node (`anvil` or local JSON-RPC).
2. Deploy `ZenithTreasury(deployerAddress)`.
3. Deploy `ZenithFeeController(deployerAddress, treasuryAddress)`.
4. Deploy V1, V2, V3 AMM factories and routers.
5. Deploy `ZenithRouter` and `ZenithCrossChainRouter`.
6. Authorize routers as fee collectors: `treasury.setFeeCollector(routerAddress, true)`.
7. Register local deployments in `deployments/31337.json` and via `registerZenithDeployment(31337, ...)`.

### Production Deployment (Mainnet / L2s)
1. Prepare governance multisig address (e.g. Gnosis Safe 3-of-5).
2. Deploy contracts with constructor parameter `_governance = governanceMultisig`.
3. Populate `deployments/<chainId>.json` with real on-chain addresses.
4. If a chain is not yet deployed, configuration remains `null` and client code **fails closed** (`ZENITH_TREASURY_NOT_CONFIGURED`).
5. Private keys and mnemonics remain external to the repository in secure HSM/MPC infrastructure.
