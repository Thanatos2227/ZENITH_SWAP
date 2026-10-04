# ZENITH — Testnet Source Transaction Verification

## Source Transaction Specifications

* **Target Network:** Ethereum Sepolia (`11155111`) / Polygon Amoy (`80002`)
* **Expected Calldata Selectors:** `depositV3` (`0xe48f32c3`) or `approve` (`0x095ea7b3`)
* **Pre-Broadcast Status:** `PREFLIGHT_PASSED`
* **On-Chain Evidence Requirement:** Mined block receipt with `status === 1`, gas used within safety limits, and non-reverted log events.
* **Current Operational Evidence:** In local and CI execution environments without injected funded testnet keys, source broadcast terminates gracefully at the `BLOCKED_NO_FUNDED_KEY` gate with zero fabricated hashes.
