# ZENITH SWAP Protocol Architecture (v4.0)

**Product:** ZENITH SWAP  
**Tagline:** **ZENITH SWAP — Trade Beyond Limits.**  
**Status:** Universal Multi-Chain Sovereign Decentralized AMM & Trading Engine

---

## 1. System Overview

ZENITH SWAP is an independent, non-custodial decentralized exchange protocol and execution layer. The protocol is structured around a sovereign, canonical smart contract suite deployed on EVM chains, coupled with high-performance routing engines, SDKs, and user interfaces.

```
                                +-----------------------------------+
                                |         ZENITH SWAP Web UI        |
                                |     (React / TypeScript / Vite)   |
                                +-----------------+-----------------+
                                                  |
                                                  v
                                +-----------------------------------+
                                |          ZENITH Swap SDK          |
                                |      (@zenith/sdk / @zenith/sdk)  |
                                +-----------------+-----------------+
                                                  |
                                                  v
                                +-----------------------------------+
                                |      Universal Routing Engine     |
                                |         (@zenith/routing)         |
                                +-----------------+-----------------+
                                                  |
                                                  v
                   +------------------------------+------------------------------+
                   |                                                             |
                   v                                                             v
    +------------------------------+                              +------------------------------+
    |         ZenithRouter         |                              |    ZenithCrossChainRouter    |
    |   (Unified Same-Chain AMM)   |                              |   (Multi-Chain Settlement)   |
    +--------------+---------------+                              +--------------+---------------+
                   |                                                             |
         +---------+---------+                                                   |
         |         |         |                                                   |
         v         v         v                                                   v
     +-------+ +-------+ +-------+                                        +---------------+
     |  V1   | |  V2   | |  V3   |                                        | Bridge Engine |
     |  AMM  | |  AMM  | |  AMM  |                                        | (Across/DLN)  |
     +-------+ +-------+ +-------+                                        +---------------+
         |         |         |                                                   |
         +---------+---------+---------------------------------------------------+
                                      |
                                      v (Protocol Fees)
                       +------------------------------+
                       |        ZenithTreasury        | <--- ZenithFeeController
                       | (Non-Custodial Fee Vault)    |
                       +------------------------------+
```

---

## 2. Canonical Smart Contract Architecture

The canonical protocol on EVM blockchains consists exclusively of the following 14 components:

1. **ZenithTreasury (`ZenithTreasury.sol`)**
   - Autonomous protocol revenue custody vault.
   - Non-custodial: strictly stores protocol fees, never touches user swap principal.
   - 2-step governance transfer pattern (`transferGovernance` -> `acceptGovernance`).
   - Authorized fee collector registry and emergency pause controls.

2. **ZenithFeeController (`ZenithFeeController.sol`)**
   - Governance-controlled protocol fee configuration.
   - Integer BPS arithmetic (denominator: 10,000). Maximum fee capped at 30 BPS.
   - V2 / V3 pool fee tier validation and cross-chain protocol fee parameters.

3. **Zenith V1 AMM Suite (`contracts/evm/src/v1/`)**
   - `ZenithV1Factory.sol`: Constant-product pair deployer.
   - `ZenithV1Pair.sol`: $x \cdot y = k$ invariant pair with 30 BPS LP fee.
   - `ZenithV1Router.sol`: Multi-hop routing, slippage control, liquidity mint/burn.

4. **Zenith V2 AMM Suite (`contracts/evm/src/v2/`)**
   - `ZenithV2Factory.sol`: Multi-tier pool factory supporting 5 BPS, 30 BPS, and 100 BPS tiers.
   - `ZenithV2Pool.sol`: Pool contracts enforcing selected fee tiers and protocol fee splits.
   - `ZenithV2Router.sol`: Multi-tier route execution and token management.

5. **Zenith V3 Concentrated Liquidity Suite (`contracts/evm/src/v3/`)**
   - `ZenithV3Factory.sol`: Concentrated liquidity pool registry with tick spacing support (10, 60, 200).
   - `ZenithV3Pool.sol`: Tick bitmap, price tick stepping, exact integer fixed-point $Q64.96$ math.
   - `ZenithV3PositionManager.sol`: ERC-721 tokenized LP positions.
   - `ZenithV3Router.sol`: Single-hop and multi-hop concentrated liquidity swaps.

6. **Zenith Unified Router (`contracts/evm/src/router/ZenithRouter.sol`)**
   - Single point of entry for on-chain swaps across V1, V2, and V3.
   - Automatic deduction and direct deposit of protocol fees to `ZenithTreasury`.

7. **Zenith Cross-Chain Router (`ZenithCrossChainRouter.sol`)**
   - Multi-chain swap orchestrator supporting bridge adapters.
   - Strict 12-state deterministic lifecycle.
