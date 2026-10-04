# ZENITH — Testnet Settlement Verification

## Settlement Invariants

* **Verification Criterion:** A settlement record is persisted as `verified = true` ONLY when `verifyDestinationSettlement()` returns `DESTINATION_SETTLED` with required finality depth.
* **Database State Authority:** Persistence records evidence rather than creating it.
* **Regression Protection:** Verified records cannot be overwritten by stale unverified payloads.
