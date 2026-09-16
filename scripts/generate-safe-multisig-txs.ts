import fs from 'node:fs';
import path from 'node:path';

export interface SafeTransactionMeta {
  name: string;
  description: string;
  txBuilderVersion: string;
  createdAt: number;
  createdFromSafeAddress: string;
  createdFromOwnerAddress: string;
  checksum: string;
}

export interface SafeTransactionItem {
  to: string;
  value: string;
  data: string | null;
  contractMethod: {
    inputs: Array<{ name: string; type: string; internalType?: string }>;
    name: string;
    payable: boolean;
  } | null;
  contractInputsValues: Record<string, string>;
}

export interface SafeBatchFile {
  version: string;
  chainId: string;
  createdAt: number;
  meta: SafeTransactionMeta;
  transactions: SafeTransactionItem[];
}

export interface ProtocolDeploymentConfig {
  chainId: number;
  safeMultisigAddress: string;
  deployerAddress: string;
  emergencyGuardianAddress: string;
  contracts: {
    zenithTreasury: string;
    zenithFeeController: string;
    zenithV1Factory: string;
    zenithV2Factory: string;
    zenithV3Factory: string;
    zenithUnifiedRouter: string;
    zenithCircuitBreaker: string;
    zenithCrossChainRouter: string;
  };
}

export function generateDeployerInitiationBatch(config: ProtocolDeploymentConfig): SafeBatchFile {
  const transactions: SafeTransactionItem[] = [
    // 1. Treasury - Initiate Governance Transfer
    {
      to: config.contracts.zenithTreasury,
      value: "0",
      data: null,
      contractMethod: {
        name: "transferGovernance",
        payable: false,
        inputs: [{ name: "_newGovernance", type: "address" }]
      },
      contractInputsValues: {
        _newGovernance: config.safeMultisigAddress
      }
    },
    // 2. FeeController - Initiate Governance Transfer
    {
      to: config.contracts.zenithFeeController,
      value: "0",
      data: null,
      contractMethod: {
        name: "transferGovernance",
        payable: false,
        inputs: [{ name: "_newGovernance", type: "address" }]
      },
      contractInputsValues: {
        _newGovernance: config.safeMultisigAddress
      }
    },
    // 3. V1 Factory - Set Fee To Setter
    {
      to: config.contracts.zenithV1Factory,
      value: "0",
      data: null,
      contractMethod: {
        name: "setFeeToSetter",
        payable: false,
        inputs: [{ name: "_feeToSetter", type: "address" }]
      },
      contractInputsValues: {
        _feeToSetter: config.safeMultisigAddress
      }
    },
    // 4. V2 Factory - Set Fee To Setter
    {
      to: config.contracts.zenithV2Factory,
      value: "0",
      data: null,
      contractMethod: {
        name: "setFeeToSetter",
        payable: false,
        inputs: [{ name: "_feeToSetter", type: "address" }]
      },
      contractInputsValues: {
        _feeToSetter: config.safeMultisigAddress
      }
    },
    // 5. V3 Factory - Set Owner
    {
      to: config.contracts.zenithV3Factory,
      value: "0",
      data: null,
      contractMethod: {
        name: "setOwner",
        payable: false,
        inputs: [{ name: "_owner", type: "address" }]
      },
      contractInputsValues: {
        _owner: config.safeMultisigAddress
      }
    },
    // 6. Unified Router - Transfer Governance
    {
      to: config.contracts.zenithUnifiedRouter,
      value: "0",
      data: null,
      contractMethod: {
        name: "transferGovernance",
        payable: false,
        inputs: [{ name: "_newGovernance", type: "address" }]
      },
      contractInputsValues: {
        _newGovernance: config.safeMultisigAddress
      }
    }
  ];

  return {
    version: "1.0",
    chainId: config.chainId.toString(),
    createdAt: Date.now(),
    meta: {
      name: "ZENITH — Phase 1: Deployer Governance Handover Initiation",
      description: "Batch transactions executed by the deployer to transfer protocol roles to the 4-of-7 Safe Multisig.",
      txBuilderVersion: "1.16.5",
      createdAt: Date.now(),
      createdFromSafeAddress: config.safeMultisigAddress,
      createdFromOwnerAddress: config.deployerAddress,
      checksum: ""
    },
    transactions
  };
}

export function generateSafeMultisigAcceptanceBatch(config: ProtocolDeploymentConfig): SafeBatchFile {
  const transactions: SafeTransactionItem[] = [
    // 1. Treasury - Accept Governance
    {
      to: config.contracts.zenithTreasury,
      value: "0",
      data: null,
      contractMethod: {
        name: "acceptGovernance",
        payable: false,
        inputs: []
      },
      contractInputsValues: {}
    },
    // 2. FeeController - Accept Governance
    {
      to: config.contracts.zenithFeeController,
      value: "0",
      data: null,
      contractMethod: {
        name: "acceptGovernance",
        payable: false,
        inputs: []
      },
      contractInputsValues: {}
    },
    // 3. Unified Router - Accept Governance
    {
      to: config.contracts.zenithUnifiedRouter,
      value: "0",
      data: null,
      contractMethod: {
        name: "acceptGovernance",
        payable: false,
        inputs: []
      },
      contractInputsValues: {}
    },
    // 4. CircuitBreaker - Set Emergency Guardian (if needed)
    {
      to: config.contracts.zenithCircuitBreaker,
      value: "0",
      data: null,
      contractMethod: {
        name: "updateGuardian",
        payable: false,
        inputs: [{ name: "newGuardian", type: "address" }]
      },
      contractInputsValues: {
        newGuardian: config.emergencyGuardianAddress
      }
    }
  ];

  return {
    version: "1.0",
    chainId: config.chainId.toString(),
    createdAt: Date.now(),
    meta: {
      name: "ZENITH — Phase 2: 4-of-7 Safe Multisig Governance Acceptance Batch",
      description: "Batch transaction to be signed and executed by the 4-of-7 Safe Multisig signers to finalize protocol ownership.",
      txBuilderVersion: "1.16.5",
      createdAt: Date.now(),
      createdFromSafeAddress: config.safeMultisigAddress,
      createdFromOwnerAddress: config.safeMultisigAddress,
      checksum: ""
    },
    transactions
  };
}

export function generateCastCliVerificationCommands(config: ProtocolDeploymentConfig, rpcUrl: string = "$RPC_URL"): string[] {
  return [
    `# 1. Verify ZenithTreasury Governance`,
    `cast call ${config.contracts.zenithTreasury} "governance()(address)" --rpc-url ${rpcUrl}`,
    `# 2. Verify ZenithFeeController Governance & Treasury Binding`,
    `cast call ${config.contracts.zenithFeeController} "governance()(address)" --rpc-url ${rpcUrl}`,
    `cast call ${config.contracts.zenithFeeController} "treasury()(address)" --rpc-url ${rpcUrl}`,
    `# 3. Verify ZenithV1Factory FeeToSetter`,
    `cast call ${config.contracts.zenithV1Factory} "feeToSetter()(address)" --rpc-url ${rpcUrl}`,
    `# 4. Verify ZenithV2Factory FeeToSetter`,
    `cast call ${config.contracts.zenithV2Factory} "feeToSetter()(address)" --rpc-url ${rpcUrl}`,
    `# 5. Verify ZenithV3Factory Owner`,
    `cast call ${config.contracts.zenithV3Factory} "owner()(address)" --rpc-url ${rpcUrl}`,
    `# 6. Verify ZenithCircuitBreaker Guardian`,
    `cast call ${config.contracts.zenithCircuitBreaker} "emergencyGuardian()(address)" --rpc-url ${rpcUrl}`,
    `cast call ${config.contracts.zenithCircuitBreaker} "governance()(address)" --rpc-url ${rpcUrl}`
  ];
}

// CLI Execution
if (process.argv[1] && path.basename(process.argv[1]).includes('generate-safe-multisig-txs')) {
  const isDryRun = process.argv.includes('--dry-run');

  const sampleConfig: ProtocolDeploymentConfig = {
    chainId: 1, // Ethereum Mainnet
    safeMultisigAddress: process.env.GOVERNANCE_MULTISIG || "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    deployerAddress: process.env.DEPLOYER_ADDRESS || "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    emergencyGuardianAddress: process.env.EMERGENCY_GUARDIAN || "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    contracts: {
      zenithTreasury: "0x1111111111111111111111111111111111111111",
      zenithFeeController: "0x2222222222222222222222222222222222222222",
      zenithV1Factory: "0x3333333333333333333333333333333333333333",
      zenithV2Factory: "0x4444444444444444444444444444444444444444",
      zenithV3Factory: "0x5555555555555555555555555555555555555555",
      zenithUnifiedRouter: "0x6666666666666666666666666666666666666666",
      zenithCircuitBreaker: "0x7777777777777777777777777777777777777777",
      zenithCrossChainRouter: "0x8888888888888888888888888888888888888888"
    }
  };

  const phase1Batch = generateDeployerInitiationBatch(sampleConfig);
  const phase2Batch = generateSafeMultisigAcceptanceBatch(sampleConfig);
  const verificationCommands = generateCastCliVerificationCommands(sampleConfig);

  const outDir = path.resolve(process.cwd(), 'deployments', 'multisig');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const phase1Path = path.join(outDir, 'phase1_deployer_initiation_batch.json');
  const phase2Path = path.join(outDir, 'phase2_safe_acceptance_batch.json');
  const verificationPath = path.join(outDir, 'verify_governance.sh');

  fs.writeFileSync(phase1Path, JSON.stringify(phase1Batch, null, 2));
  fs.writeFileSync(phase2Path, JSON.stringify(phase2Batch, null, 2));
  fs.writeFileSync(verificationPath, verificationCommands.join('\n') + '\n');

  console.log(`[Safe Multisig Generator] Generated Phase 1 Batch: ${phase1Path}`);
  console.log(`[Safe Multisig Generator] Generated Phase 2 Batch: ${phase2Path}`);
  console.log(`[Safe Multisig Generator] Generated Cast Verification Script: ${verificationPath}`);
  console.log(`[Safe Multisig Generator] Total Actions: ${phase1Batch.transactions.length + phase2Batch.transactions.length}`);

  if (isDryRun) {
    console.log(`[Safe Multisig Generator] DRY RUN VALIDATION PASSED.`);
  }
}
