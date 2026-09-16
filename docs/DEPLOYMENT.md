# ZENITH SWAP Deployment Guide & Registry Specification

## 1. Authoritative Chain Deployment Schema

Every supported chain stores its deployed contract addresses in `deployments/<chainId>.json`.

Each deployment file adheres to the following JSON structure:

```json
{
  "chainId": 1,
  "chainName": "Ethereum",
  "nativeToken": "0x0000000000000000000000000000000000000000",
  "wrappedNativeToken": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "contracts": {
    "treasury": "0x...",
    "feeController": "0x...",
    "v1Factory": "0x...",
    "v1Router": "0x...",
    "v2Factory": "0x...",
    "v2Router": "0x...",
    "v3Factory": "0x...",
    "v3Router": "0x...",
    "v3PositionManager": "0x...",
    "unifiedRouter": "0x...",
    "crossChainRouter": "0x..."
  }
}
```

## 2. Fail-Closed Deployment Policy

- If a chain ID is queried for which no deployment file exists, the SDK and routing engine throw `ZENITH_UNSUPPORTED_CHAIN`.
- If an address is queried that is unpopulated in the deployment configuration, the system throws `ZENITH_DEPLOYMENT_NOT_FOUND` or `ZENITH_TREASURY_NOT_CONFIGURED`.
- Cross-chain address substitution (e.g. using chain 137 address on chain 1) is strictly forbidden.

## 3. Foundry Deployment Execution

To deploy the full canonical suite to any EVM network:

```bash
cd contracts/evm
forge script script/Deploy.s.sol:DeployZenith --rpc-url <RPC_URL> --broadcast --verify
```
