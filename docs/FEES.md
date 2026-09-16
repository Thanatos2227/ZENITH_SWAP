# ZENITH SWAP Fee Controller & Fee Architecture

## 1. Overview

`ZenithFeeController.sol` manages all protocol fee bounds and tier validations across the ZENITH SWAP ecosystem.

## 2. Integer Fixed-Point Arithmetic

All fee calculations throughout Solidity smart contracts, TypeScript SDK, and routing engines strictly use **integer basis points (BPS)** with a fixed denominator of `10,000`.

$$\text{Protocol Fee} = \frac{\text{AmountIn} \times \text{ProtocolFeeBps}}{10,000}$$

$$\text{Swap Amount} = \text{AmountIn} - \text{ProtocolFee}$$

Floating-point numbers (`Number()`, `Math.pow`, `parseFloat`) are strictly prohibited for financial amounts.

---

## 3. AMM Tier Specifications

| Protocol Tier | Fee (BPS) | Percent | Usage |
|---|---|---|---|
| **V1 AMM** | 30 BPS | 0.30% | Standard Constant-Product Pairs |
| **V2 AMM (Tier 1)** | 5 BPS | 0.05% | Stablecoin / Ultra-Low Volatility Pairs |
| **V2 AMM (Tier 2)** | 30 BPS | 0.30% | Standard Volatility Pairs |
| **V2 AMM (Tier 3)** | 100 BPS | 1.00% | High Volatility / Exotic Pairs |
| **V3 Concentrated (Tier 1)** | 500 (5 BPS) | 0.05% | Tick Spacing: 10 |
| **V3 Concentrated (Tier 2)** | 3000 (30 BPS) | 0.30% | Tick Spacing: 60 |
| **V3 Concentrated (Tier 3)** | 10000 (100 BPS) | 1.00% | Tick Spacing: 200 |

---

## 4. Governance Parameter Constraints

- **Maximum Protocol Fee:** 30 BPS (0.30%). Hardcoded immutable ceiling in `ZenithFeeController`.
- **Default Protocol Fee:** 5 BPS (0.05%).
- **Cross-Chain Protocol Fee:** 10 BPS (0.10%).
