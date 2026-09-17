# ZENITH SWAP — Repair Status

_Last verified: 2026-09-18_

## Current engineering state

ZENITH is being repaired as a sovereign execution stack. Production quoting is fail-closed when authoritative Zenith deployment/pool state is unavailable; fabricated liquidity, fabricated production gas limits, and fake deployed contract addresses must not be used to make tests or swaps appear successful.

## Verified gates

- TypeScript type-check: passing on the latest recorded CI run.
- Anti-mock / zero-address production audit: passing on the latest recorded CI run.
- V3 concentrated-liquidity tick-math fuzz suite: passing on the latest recorded CI run.
- Sovereign routing invariant tests: passing on the latest recorded CI run.
- `V3TooLittleReceived()` selector coverage: passing for selector identity/ABI coverage.

## Active blockers

The latest recorded CI run still fails the full protocol test command. The dominant failure is that several legacy integration/repair tests expect synthetic pool state or placeholder deployments even though production Zenith providers now require live deployment and pool state. Some long-running tests also depend on unavailable RPC/deployment state.

The next repair target is deterministic local Foundry/Anvil integration: deploy real Zenith V1/V2/V3 contracts in the test environment, create real test tokens and pools, add real liquidity, read the resulting on-chain state, quote from that state, build calldata from the same quote, run `eth_call`/`estimateGas`, and only then exercise execution assertions.

## Deployment safety

`contracts/evm/script/Deploy.s.sol` now requires an explicit `GOVERNANCE_MULTISIG`. It no longer embeds a personal wallet as the default governance address. Real deployed contract addresses must be obtained from actual deployment output and verified bytecode before entering the deployment registry.

## Acceptance target

A repair is not considered complete until the same live/local pool state produces consistent quote → minimum-output → calldata → pre-flight simulation → gas estimate → transaction execution results, including native POL/WPOL and ERC-20 paths. Cross-chain execution must similarly use real destination settlement state. No test should be made green by increasing slippage, setting `minOut` to zero, inserting synthetic liquidity, inventing contract addresses, suppressing errors, or skipping the failing integration path.
