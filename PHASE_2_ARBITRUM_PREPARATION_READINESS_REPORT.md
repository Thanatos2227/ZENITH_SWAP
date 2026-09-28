# ZENITH — PHASE 2: ARBITRUM UNISWAP V3 PREPARATION READINESS & FUNDING GATE REPORT

**Network:** Arbitrum One (Chain ID: `42161`)  
**Target DEX:** Uniswap V3 (`arbitrum:uniswap-v3` / SwapRouter02 `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`)  
**Target Pair:** WETH -> USDC  
**Authorized Operator Wallet:** `0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88`  
**Execution Mode:** `READ_ONLY` / `PREFLIGHT_ONLY`  
**Live On-Chain Mode:** `FALSE` (STRICTLY DISABLED)  
**Certification Status:** **PREPARATION_READINESS_COMPLETE / FUNDING_REQUIRED**  

---

## 1. Executive Summary

In accordance with Phase 2 Task 46 instructions, an authoritative read-only preparation readiness analysis was conducted on Arbitrum One (`42161`) to determine the exact requirements for preparing the authorized wallet for the Uniswap V3 `WETH -> USDC` canary.

- **Current Operator State:** Native ETH = `0.0 ETH`, WETH = `0.0 WETH`, USDC = `0.542968 USDC`, WETH Allowance = `0.0 WETH`.
- **Canary Scale & Economic Viability:** `0.000100 WETH` (~`$0.27 USD`) is verified as economically meaningful and executable, producing `0.268996 USDC` (+100% positive margin over precision floor). Recommendation: **RETAIN 0.000100 WETH**.
- **Preparation Payloads Constructed:**
  1. **Native ETH -> WETH Deposit:** Target `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`, Calldata `0xd0e30db0` (`deposit()`), Value `0.0001 ETH`.
  2. **Exact Bounded WETH Router Approval:** Target `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`, Spender `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`, Amount `0.0001 WETH` (`100000000000000` wei, **Zero Unlimited Approval**).
- **Funding Gate Determination:** Total minimum ETH required = **`0.0008188 ETH`** (Principal `0.0001 ETH` + L2 Gas `0.0000188 ETH` + L1 Calldata buffer `0.0002 ETH` + Safety Reserve `0.0005 ETH`). Recommended operator funding: **`0.0010 - 0.0015 ETH`** (~`$2.70 - $4.00 USD`).
- **Polygon Golden Canary:** Intact at `0x66d379b1806fff0c291cbf31143dfdf3bd5a8ddce66ff578f9d7e6aac16130dd`.

---

## 2. On-Chain State & Requirements Breakdown

| Parameter | Current On-Chain State | Required for Canary | Status |
| :--- | :--- | :--- | :---: |
| **Native ETH** | `0.000000 ETH` (`0` wei) | `0.000819 ETH` (`818,800,000,000,000` wei) | **FUNDING REQUIRED** |
| **WETH** | `0.000000 WETH` (`0` wei) | `0.000100 WETH` (`100,000,000,000,000` wei) | **WRAP REQUIRED** |
| **USDC** | `0.542968 USDC` (`542,968` raw) | `0.000000 USDC` (Output token) | **PRESENT** |
| **WETH Router Allowance**| `0.000000 WETH` (`0` wei) | `0.000100 WETH` (`100,000,000,000,000` wei) | **APPROVAL REQUIRED** |
| **Signer Nonce** | `0` | `0` | **VERIFIED** |

---

## 3. Preparation Transaction Payloads (Preflight Sealed)

### Transaction A: Native ETH -> WETH Wrap
- **Target Contract:** `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` (Canonical Arbitrum WETH)
- **Method:** `deposit()`
- **Calldata:** `0xd0e30db0`
- **Value:** `0.000100 ETH` (`100000000000000` wei)
- **Sender:** `0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88`
- **Semantic Hash:** `0x10b1bd9ecb37da3c720a2c74b526f80b7d4d861b1d7de7f71d96ec8681c7e609`
- **Estimated Gas:** `30,000` gas
- **Preflight `eth_call`:** `FAIL_CLOSED` (Account currently has 0 ETH native balance)

### Transaction B: Exact Bounded WETH Router Approval
- **Target Contract:** `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` (Canonical Arbitrum WETH)
- **Spender:** `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` (Uniswap V3 SwapRouter02)
- **Method:** `approve(address,uint256)`
- **Calldata:** `0x095ea7b300000000000000000000000068b3465833fb72a70ecdf485e0e4c7bd8665fc4500000000000000000000000000000000000000000000000000005af3107a4000`
- **Approved Amount:** Exactly `0.000100 WETH` (**Zero Unlimited Approval Policy**)
- **Value:** `0 ETH`
- **Sender:** `0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88`
- **Semantic Hash:** `0x958005ba48ef6a227b68690f5b6c1c0fb27bd639ba47a90581e2ddfef8a458c6`
- **Estimated Gas:** `54,772` gas
- **Preflight `eth_call`:** `SUCCESS`

---

## 4. Gas & Funding Budget

| Item | Calculation / Basis | Amount (ETH) |
| :--- | :--- | :--- |
| **1. WETH Principal** | Exact swap input amount | `0.000100 ETH` |
| **2. L2 Execution Gas** | 235,000 total gas @ 0.04 Gwei (2x safety) | `0.000019 ETH` |
| **3. L1 Calldata Posting Buffer** | 3 transactions on Arbitrum One | `0.000200 ETH` |
| **4. Minimum Gas Reserve** | Zenith mandatory execution safety buffer | `0.000500 ETH` |
| **Total Minimum Required** | Sum of items 1-4 | **`0.000819 ETH`** |
| **Recommended Funding** | Recommended manual deposit | **`0.0010 - 0.0015 ETH`** (~$2.70 - $4.00) |

---

## 5. Security Invariants & Fail-Closed Enforcement

1. **Zero Secret Exposure:** Zero private keys accessed or printed.
2. **Zero Auto-Funding / Transfers:** Engine strictly prohibits automated bridging or cross-chain balance assumptions.
3. **No Unlimited Approval:** Approval payload is strictly bounded to the exact 0.0001 WETH swap input.
4. **Safety Lock Active:** `LIVE_ONCHAIN = FALSE`, `SIGNING_OPERATIONS = 0`, `MAINNET_BROADCASTS = 0`.
