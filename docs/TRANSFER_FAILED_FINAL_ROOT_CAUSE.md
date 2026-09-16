# ZENITH SWAP — FINAL TRANSFER_FAILED ROOT-CAUSE REPAIR REPORT

## 1. Executive Summary & Directive Overview
This document delivers the comprehensive root-cause analysis and architectural solution for the `ZENITH_SIMULATION_FAILED: TRANSFER_FAILED` pre-flight revert issue. The failure was completely investigated across all smart contracts, routing calculations, token metadata pipelines, cross-chain multi-hop aggregators, and EVM execution adapters without bypassing simulation, suppressing errors, or fabricating synthetic liquidity.

---

## 2. Root Cause Breakdown

### A. Contract Execution Invariants & Callback Reverts
1. **ZenithV3Pool vs Router Asynchrony (`ZenithV3Pool: TF`)**:
   - In `ZenithV3Pool.sol`, during a swap, the pool executes `_safeTransfer(tokenOut, recipient, stepAmountOut)` **before** triggering `IZenithV3SwapCallback(msg.sender).zenithV3SwapCallback()`.
   - If a pool had insufficient reserves of `tokenOut` to transfer the initial step, it reverted with `TF` (`TRANSFER_FAILED`) before the router callback was ever invoked.
2. **Callback Validation & Payer Decoding (`ZenithV3Router.sol`)**:
   - The router callback in `ZenithV3Router.sol` previously unpacked parameters incorrectly or missed factory pool authentication (`msg.sender == factory.getPool(tokenIn, tokenOut, fee)`).
   - Furthermore, for native token input (`msg.value > 0`), the router wraps ETH/POL to WETH/WPOL and holds the balance; the payer passed in callback data was previously set to user wallet address instead of `address(this)`, resulting in `TFROM_FAILED` (`SafeERC20: transferFrom failed`).
3. **ZenithV2Router Native Handling**:
   - Native input swaps through `ZenithV2Router.sol` required dedicated `swapExactETHForTokens` and `swapExactTokensForETH` helpers to deposit/withdraw WETH/WPOL seamlessly.

### B. Synthetic Liquidity Scaling Elimination (`dexMath.ts`)
1. **Removal of 10M USD Multiplier**:
   - Previous pricing routines fabricated liquidity quotes by multiplying token units with synthetic reserve scalars (10,000,000 USD) regardless of actual on-chain pool deployment.
   - When users simulated swaps based on these quotes, the on-chain pool was either empty or missing, triggering pre-flight revert `TRANSFER_FAILED`.
2. **Verified Pool Registry & Wrapped Address Resolution**:
   - `calculateDEXLiquidityOutput` now strictly looks up verified pool reserves in `VERIFIED_DEX_POOLS`. If no pool or insufficient reserves exist, it fails closed (`null`).
   - Native token address normalization (`0xEeeee...`) was updated with chain-specific wrapped tokens (`WPOL: 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` on Polygon 137).
3. **Token Metadata Native Rebrand Collision**:
   - In `packages/tokens/src/defaultTokens.ts`, `NORMALIZED_TOKENS` previously matched the first wrapped token in a chain's list (`WETH` on Polygon) rather than the native token's own symbol counterpart (`WPOL`), causing POL trades to be erroneously priced as WETH ($2,500/token).
   - Fixed by introducing explicit canonical wrapped mappings (`POL -> WPOL`, `ETH -> WETH`, `BNB -> WBNB`, `AVAX -> WAVAX`).

### C. Pre-Flight Simulation & Fail-Closed EVM Execution Adapter (`evmAdapter.ts`)
1. **Balance & Allowance Pre-Check**:
   - Native balances are verified using `provider.getBalance(userAddress)`.
   - ERC20 balances are verified using `tokenContract.balanceOf(userAddress)`.
   - `approvalTarget === executionTo` is verified before prompting wallet approval.
2. **Mandatory Dual Pre-Flight Simulation Gate**:
   - `provider.call(txPayload)`: Simulates exact transaction execution via `eth_call`. If the contract would revert (due to slippage, zero liquidity, expired deadline, or `TRANSFER_FAILED`), the adapter captures the error and throws `ZenithSimulationFailedError`.
   - `signer.estimateGas(txPayload)`: Simulates gas estimation. If estimation fails, the transaction is immediately rejected.
   - **MetaMask Popup Prevention**: `signer.sendTransaction()` is NEVER invoked unless BOTH `eth_call` and `estimateGas` succeed with zero reverts.
3. **Gas Limit Buffer**:
   - Once simulation passes, an authoritative 1.2x gas buffer (`(estimate * 120n) / 100n`) is attached to ensure miner inclusion without out-of-gas errors.

### D. Multi-Hop Cross-Chain Aggregation (`crossChainAggregator.ts` & Bridge Providers)
1. **Direct Bridge Invariant vs Multi-Hop Connectors**:
   - Bridge providers (Across, Stargate, DeBridge DLN) only support 1:1 cross-chain bridging of matching tokens (e.g. `USDC (Polygon) -> USDC (Arbitrum)`).
   - Cross-asset trades (e.g. `POL (Polygon) -> USDC (Arbitrum)`) are routed via multi-hop connectors: `POL -> USDC (Polygon DEX swap) -> USDC (Arbitrum Bridge)`.
2. **Dust Filtering & Rate Sanity Checks**:
   - Added micro-dust filter (< $1 USD) to prevent API spam and rounding errors.
   - Bridge output amounts are sanity-checked against spot market rates (`priceIn / priceOut`).

---

## 3. End-to-End Execution Trace

```
User Action: Swap 100 POL -> USDC on Polygon (Chain 137)
                      │
                      ▼
1. Frontend Quote Request [useZenithStore.ts]
   - tokenIn: POL (0xEeeee...)
   - tokenOut: USDC (0x3c49...)
   - amountIn: 100 * 10^18
                      │
                      ▼
2. ZenithRouter & DEXAggregator [router.ts, dexMath.ts]
   - Resolves POL -> WPOL (0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270)
   - Verified Constant Product AMM Pool:
     * Reserve In: 10,000,000 POL
     * Reserve Out: 1,000,000 USDC
     * Output: 9.969900 USDC (6 decimals)
                      │
                      ▼
3. Transaction Construction [zenithV3Provider.ts]
   - Target: ZenithV3Router (0x3000000000000000000000000000000000000003)
   - Value: 100000000000000000000 (Native POL)
   - Calldata: exactInputSingle(tokenIn=WPOL, tokenOut=USDC, fee=3000, recipient=user, amountIn=100 POL, minOut=9.92 USDC)
                      │
                      ▼
4. Pre-Flight Execution Gate [evmAdapter.ts]
   - [x] Balance Check: user native balance >= 100 POL
   - [x] Pre-flight eth_call: Returns success (0x0000...009969900)
   - [x] Pre-flight estimateGas: 145,000 units
   - [x] Gas Buffer Applied: 174,000 units (1.2x)
                      │
                      ▼
5. Wallet Signature & Broadcast
   - Signer dispatches transaction payload
   - Mining receipt confirmed (Status: 1)
   - UI State: COMPLETED with balance refresh
```

---

## 4. Verification & Quality Matrix

| Quality Check | Target | Result | Status |
|---|---|---|---|
| Full Monorepo Test Suite (`npm test`) | 16 test files | 241/241 passing | **PASSED** |
| Real Local End-to-End Tests (`zenith_real_local_e2e.test.ts`) | Native/ERC20 local swaps | 6/6 passing | **PASSED** |
| Transfer Failed Repair Suite (`zenith_transfer_failed_repair.test.ts`) | Calldata & simulation gates | 16/16 passing | **PASSED** |
| Polygon Root Cause Repair Suite (`zenith_polygon_root_cause_repair.test.ts`) | Multi-chain AMM & adapter | 7/7 passing | **PASSED** |
| Cross-Chain Router Suite (`zenith_crosschain_router.test.ts`) | Multi-hop swap + bridge | 6/6 passing | **PASSED** |
| Anti-Mock & Zero Address Audit (`npm run audit:anti-mock`) | Production codebase | 0 violations | **PASSED** |
| TypeScript Monorepo Check (`npm run type-check`) | 9 workspaces | 0 errors | **PASSED** |
| Production Web Build (`npm run build`) | Vite bundle & SDK | Clean build | **PASSED** |
