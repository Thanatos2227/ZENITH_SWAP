# ZENITH SWAP Known Limitations & Verification Status

## 1. Multi-Chain Live Bridge Environment

- **Current Status:** `NOT VERIFIED (Live Multi-Chain Settlement)` / `VERIFIED (Adapter State-Machine & Fault Injection)`
- **Detail:** In local development and single-node test environments, external multi-chain bridge relayers (Across, Stargate, deBridge) cannot establish genuine cross-chain consensus between two live production chains without external bridge relayer infrastructure.
- **Protocol Policy:** Cross-chain bridge adapters fail closed with `CROSS_CHAIN_QUOTE_UNAVAILABLE` or `ZENITH_BRIDGE_UNSUPPORTED` when live bridge relayers are unreachable. Bridge completion is never mocked or fabricated.

## 2. Unconfigured Production Networks

- **Policy:** Any chain not explicitly present in `deployments/<chainId>.json` fails closed with `ZENITH_UNSUPPORTED_CHAIN`.
- Address substitution from alternative networks is strictly forbidden.
