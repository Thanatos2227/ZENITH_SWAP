# ZENITH SWAP Testing & Verification Guide

## 1. Test Suite Topology

ZENITH SWAP maintains comprehensive verification layers spanning smart contracts, TypeScript routing math, SDK integration, and anti-mock static analysis.

### Executing Tests:

```bash
# Run complete test suite (190+ test assertions)
npm test

# Run TypeScript compilation check across all 9 workspaces
npm run type-check

# Run anti-mock audit
npm run audit:anti-mock

# Build production bundle
npm run build
```

## 2. Test Disciplines

1. **V1 AMM Math & Invariants:** Validates $x \cdot y = k$, 30 BPS LP fee calculations, mint/burn ratios.
2. **V2 Multi-Tier Pools:** Validates 5 BPS, 30 BPS, 100 BPS fee tier isolation and protocol treasury split.
3. **V3 Concentrated Liquidity:** Validates $Q64.96$ square root price math, tick crossing loops, and tick bitmap step logic.
4. **Treasury & Fee Controller:** Validates non-custodial fee deposits, 2-step governance, and collector permissions.
5. **Universal Router:** Validates routing, exact calldata encoding, slippage bounds, and deadline validation.
6. **Cross-Chain Intent Engine:** Validates 12-state deterministic lifecycle and timeout refund mechanisms.
