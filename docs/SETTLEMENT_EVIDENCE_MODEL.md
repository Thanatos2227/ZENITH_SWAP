# ZENITH Authoritative Transaction Evidence & Settlement Finality Model

This document establishes the authoritative evidence hierarchy, verification rules, state transitions, and finality contracts governing all same-chain and cross-chain execution within ZENITH.

---

## 1. Evidence Authority Hierarchy

Authoritative state reconciliation enforces a strict hierarchy where lower-tier sources can never override or substitute higher-tier cryptographic and on-chain proofs:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ TIER 1: ON-CHAIN RECEIPT (Status = 1 / SUCCESS, Block Hash, Logs)       │ (PRIMARY)
├─────────────────────────────────────────────────────────────────────────┤
│ TIER 2: ON-CHAIN TRANSACTION LOOKUP (From, To, Value, Calldata, Nonce)  │ (SECONDARY)
├─────────────────────────────────────────────────────────────────────────┤
│ TIER 3: ERC20 TRANSFER EVENT LOGS (Token Contract, Recipient, Value)    │ (PRIMARY)
├─────────────────────────────────────────────────────────────────────────┤
│ TIER 4: RECIPIENT BALANCE DELTA (Provenanced: Pre-Balance + Post-Bal)   │ (SECONDARY)
├─────────────────────────────────────────────────────────────────────────┤
│ TIER 5: BRIDGE PROVIDER API (Across, Stargate, deBridge Fill Status)    │ (DIAGNOSTIC)
├─────────────────────────────────────────────────────────────────────────┤
│ TIER 6: LOCAL CACHE & DATABASE FLAGS (In-Memory State, SQLite Rows)     │ (NON-AUTHORITATIVE)
└─────────────────────────────────────────────────────────────────────────┘
```

### Invariant Rules:
1. **Receipt Requirement**: No transaction can reach `CONFIRMED` without an on-chain receipt having `status == 1`.
2. **Revert Supremacy**: If an on-chain receipt reports `status == 0` (revert), the settlement status is `DESTINATION_FAILED` or `STATUS_CONFLICT`, even if a bridge provider API claims `filled`.
3. **No Unprovenanced Balance Delta**: Balance delta (`currentBalance - preBalance >= minAmount`) is only valid when a trusted `preBridgeBalanceRaw` is explicitly recorded prior to bridge execution. Without pre-balance provenance, balance checks alone remain `UNAVAILABLE`.
4. **Diagnostic Isolation**: Provider API status (`TIER_5`) and Local Cache (`TIER_6`) can never independently promote an intent to `DESTINATION_SETTLED` or `SETTLED`.

---

## 2. Transaction Lifecycle State Machine

```text
       [ CREATED ]
            │
            ▼
      [ PREFLIGHTING ] ──► [ PREFLIGHT_FAILED ]
            │
            ▼
   [ PREFLIGHT_PASSED ]
            │
            ▼
  [ READY_TO_BROADCAST ] ──► [ BROADCAST_FAILED ]
            │
            ▼
     [ BROADCASTING ]
      /           \
     ▼             ▼
[ BROADCAST_CONFIRMED ]   [ BROADCAST_UNCERTAIN ]
     │                         │
     ▼ (Receipt mined)         ▼ (Reconciliation)
[ CONFIRMING ] ──────────► [ RECOVERY_REQUIRED ] / [ REVERTED ] / [ BROADCAST_CONFIRMED ]
     │
     ▼ (Finality depth met)
[ CONFIRMED ] (Terminal)
```

### Invariant:
- `BROADCAST_UNCERTAIN` cannot transition directly to `CONFIRMED`. It must transition to `BROADCAST_CONFIRMED` upon discovering a valid mined receipt, or to `RECOVERY_REQUIRED` / `REVERTED` / `BROADCAST_FAILED`.

---

## 3. Cross-Chain Settlement State Machine

```text
       [ CREATED ]
            │
            ▼
        [ SIGNED ]
            │
            ▼
       [ SUBMITTED ]
            │
            ▼
       [ ACCEPTED ]
            │
            ▼
       [ FULFILLING ]
            │
            ▼
   [ DESTINATION_FILLED ]
            │
            ▼ (On-Chain Verification)
       [ VERIFIED ] ──► (Confirmations pending: FINALITY_PENDING)
            │
            ▼ (Required Finality Depth Met)
       [ SETTLING ]
            │
            ▼
       [ SETTLED ] (Terminal)
```

---

## 4. Failure Mode Matrix & Fail-Closed Invariants

| Scenario | Primary Evidence | Result | Invariant Enforced |
|---|---|---|---|
| No receipt found | `TIER_1_ONCHAIN_RECEIPT` (Not Found) | `DESTINATION_STATUS_UNCERTAIN` | No unmined settlement |
| Provider reports filled, no receipt | `TIER_5_PROVIDER_API` | `DESTINATION_STATUS_UNCERTAIN` | Provider API cannot certify finality |
| Provider reports filled, receipt reverted | `TIER_1_ONCHAIN_RECEIPT` (Reverted) | `STATUS_CONFLICT` | On-chain failure overrides provider claim |
| Receipt success, wrong recipient | `TIER_3_ERC20_TRANSFER_EVENT` | `STATUS_CONFLICT` | Recipient binding strictly enforced |
| Receipt success, wrong token | `TIER_3_ERC20_TRANSFER_EVENT` | `STATUS_CONFLICT` | Token contract identity verified |
| Receipt success, delivered < minimum | `TIER_3_ERC20_TRANSFER_EVENT` | `STATUS_CONFLICT` | Minimum output guarantee enforced |
| Receipt success, confirmations < required | `TIER_1_ONCHAIN_RECEIPT` | `DESTINATION_STATUS_UNCERTAIN` | Finality depth required |
| Receipt success, confirmations >= required | `TIER_1_ONCHAIN_RECEIPT` / `TIER_3` | `DESTINATION_SETTLED` | Certified on-chain settlement |
| Block reorg detected | `TIER_1_ONCHAIN_RECEIPT` (Mismatch) | `REORG_DETECTED` | Block hash invalidation triggers recovery |
| Local cache says settled, no receipt | `TIER_6_LOCAL_CACHE` | `DESTINATION_STATUS_UNCERTAIN` | Local state cannot fabricate finality |
| Balance increased, missing pre-balance | `TIER_4_RECIPIENT_BALANCE_DELTA` | `DESTINATION_STATUS_UNCERTAIN` | Provenance required for balance delta |
| Database flag `verified: true` without tx | Persistence Layer | `REJECT` | DB cannot bypass execution verifier |

---

## 5. Persistence Atomicity & Evidence Immutability

1. **Evidence Metadata Persistence**: Every settlement row in SQLite stores `destination_tx_hash`, `destination_chain_id`, `token_address`, `recipient`, `expected_amount_raw`, `actual_amount_raw`, `verified`, and `verified_at`.
2. **Immutability of Verified Settlements**: An existing `verified = 1` settlement record cannot be overwritten or downgraded by subsequent unverified or partial event replays.
3. **Database Write Protection**: Calling `recordSettlement()` with `verified: true` requires non-empty `destination_tx_hash`, valid `destination_chain_id`, and `recipient`.
