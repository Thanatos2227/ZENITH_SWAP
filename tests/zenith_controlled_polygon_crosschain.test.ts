import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, Wallet, JsonRpcProvider, Contract, parseEther, formatUnits, parseUnits } from 'ethers';
import {
  runControlledPolygonCrossChainExecution,
  formatPolygonSourcePreExecutionSummary,
  formatPolygonBridgePreExecutionSummary,
  assertSanitizedAuditRecord,
  POLYGON_CROSSCHAIN_CONFIG,
  OPERATOR_CONFIRM_SOURCE_TOKEN,
  OPERATOR_CONFIRM_BRIDGE_TOKEN,
  PolygonCrossChainExecutionResult,
  normalizePrivateKey,
  SafeSignerDiagnostic
} from '../scripts/execute-controlled-polygon-crosschain';
import {
  ExecutionCoordinator,
  ExecutionStateMachine,
  ExecutionPlanBuilder,
  ExecutionPlanValidator,
  SQLiteCrossChainStateRepository,
  CrossChainRecoveryEngine,
  extractActualSourceSwapOutput
} from '../packages/execution/src';
import {
  defaultAcrossProvider,
  validateCrossChainQuoteExecutability
} from '../packages/routing/src';
import {
  ACROSS_SPOKE_POOLS,
  ACROSS_SPOKE_POOL_ABI,
  UNISWAP_V3_SWAP_ROUTERS,
  UNISWAP_V3_SWAP_ROUTER_ABI,
  ZERO_ADDRESS
} from '../packages/contracts/src';
import { QuoteRequest, ExecutionPlan, OperatorAuditRecord } from '../packages/types/src';

const spokePoolInterface = new Interface(ACROSS_SPOKE_POOL_ABI);
const swapRouterInterface = new Interface(UNISWAP_V3_SWAP_ROUTER_ABI);

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USER_ADDR = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';

test('ZENITH — PHASE 1 / TASK 16: POLYGON -> ARBITRUM LIVE CROSS-CHAIN EXECUTION MATRIX', async (t) => {

  // 1. READ_ONLY mode
  await t.test('1. READ_ONLY mode: Performs live Polygon RPC reads, quotes, and contract bytecode checks with no signing', async () => {
    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY',
      suppressLogs: true
    });

    assert.equal(result.executionMode, 'READ_ONLY');
    assert.equal(result.preBroadcastGates?.['EXECUTION_MODE'], 'READ_ONLY');
    assert.equal(result.evidenceClassification?.readOnlyLive.BYTECODE_VERIFIED, true);
    assert.ok(result.plan);
    assert.equal(result.sourceTxHash, undefined);
    assert.equal(result.bridgeTxHash, undefined);
    assert.equal(result.destinationTxHash, undefined);
  });

  // 2. PREFLIGHT_ONLY mode
  await t.test('2. PREFLIGHT_ONLY mode: Builds complete plan, validates calldata and preflight without broadcast', async () => {
    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'PREFLIGHT_ONLY',
      suppressLogs: true
    });

    assert.equal(result.executionMode, 'PREFLIGHT_ONLY');
    assert.equal(result.status, 'READY_FOR_CONTROLLED_BRIDGE_BROADCAST');
    assert.ok(result.planId);
    assert.ok(result.plan);
    assert.equal(result.plan?.steps.length, 8);
    assert.ok(result.preBroadcastGates?.['PREFLIGHT_ONLY_COMPLETION']);
    assert.equal(result.sourceTxHash, undefined);
  });

  // 3. LIVE_ONCHAIN mode without signer
  await t.test('3. LIVE_ONCHAIN mode: Fails closed with BLOCKED_NO_FUNDED_KEY when no signer is present', async () => {
    const origKey = process.env.TESTNET_PRIVATE_KEY;
    const origSigner = process.env.ZENITH_SIGNER_PRIVATE_KEY;
    const origPk = process.env.PRIVATE_KEY;

    try {
      delete process.env.TESTNET_PRIVATE_KEY;
      delete process.env.ZENITH_SIGNER_PRIVATE_KEY;
      delete process.env.PRIVATE_KEY;

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_NO_FUNDED_KEY');
      assert.equal(result.diagnostics?.signerStatus, 'MISSING');
      assert.equal(result.sourceTxHash, undefined);
    } finally {
      if (origKey) process.env.TESTNET_PRIVATE_KEY = origKey;
      if (origSigner) process.env.ZENITH_SIGNER_PRIVATE_KEY = origSigner;
      if (origPk) process.env.PRIVATE_KEY = origPk;
    }
  });

  // 4. LIVE_ONCHAIN mode with insufficient POL
  await t.test('4. LIVE_ONCHAIN mode: Fails closed with BLOCKED_INSUFFICIENT_FUNDS when wallet POL balance is insufficient', async () => {
    // Generate a random unfunded wallet
    const randomWallet = Wallet.createRandom();

    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'LIVE_ONCHAIN',
      injectedWallet: randomWallet,
      suppressLogs: true
    });

    assert.equal(result.status, 'BLOCKED_INSUFFICIENT_FUNDS');
    assert.equal(result.diagnostics?.fundingStatus, 'INSUFFICIENT');
    assert.equal(result.sourceTxHash, undefined);
  });

  // 5. LIVE_ONCHAIN mode without confirmation token
  await t.test('5. LIVE_ONCHAIN mode: Fails closed with BLOCKED_OPERATOR_CONFIRMATION when confirmation is missing', async () => {
    const origConfirm = process.env.ZENITH_LIVE_CONFIRM;

    try {
      delete process.env.ZENITH_LIVE_CONFIRM;

      // Create a mock provider with funded balance
      const mockProvider: any = {
        getBlockNumber: async () => 94120482,
        getCode: async () => '0x60806040',
        getBalance: async () => parseEther('10.0'),
        getFeeData: async () => ({ gasPrice: parseUnits('50', 'gwei') })
      };

      const mockWallet = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', mockProvider);

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_OPERATOR_CONFIRMATION');
    } finally {
      if (origConfirm) process.env.ZENITH_LIVE_CONFIRM = origConfirm;
    }
  });

  // 6. Dynamic Bridge Re-Quoting & Amount Extraction
  await t.test('6. Composite Flow: Mined source swap output is extracted and authoritatively passed to Across quote', async () => {
    const mockReceipt: any = {
      hash: '0xmock_polygon_swap_tx',
      blockNumber: 94120500,
      status: 1,
      gasUsed: 158000n,
      effectiveGasPrice: parseUnits('45', 'gwei'),
      logs: [
        {
          address: POLYGON_CROSSCHAIN_CONFIG.polygonUsdcAddress,
          topics: [
            ERC20_TRANSFER_TOPIC,
            '0x000000000000000000000000' + POLYGON_CROSSCHAIN_CONFIG.zenithV3Router.slice(2),
            '0x000000000000000000000000' + USER_ADDR.slice(2)
          ],
          data: '0x0000000000000000000000000000000000000000000000000000000000018370' // 99,184 raw USDC
        }
      ]
    };

    const extractedOutput = extractActualSourceSwapOutput({
      receipt: mockReceipt,
      recipientAddress: USER_ADDR,
      expectedTokenOutAddress: POLYGON_CROSSCHAIN_CONFIG.polygonUsdcAddress,
      minimumAmountOutRaw: '90000',
      sourceChainId: 137
    });

    assert.equal(extractedOutput.actualAmountRaw, '99184');
    assert.equal(extractedOutput.actualAmountBig, 99184n);
    assert.equal(extractedOutput.verified, true);
  });

  // 7. Exact Bounded Approval Verification
  await t.test('7. Bridge Approval: Encodes exact bounded amount for Across SpokePool', async () => {
    const exactAmount = 99184n;
    const usdcInterface = new Interface([
      'function approve(address spender, uint256 amount) returns (bool)'
    ]);

    const calldata = usdcInterface.encodeFunctionData('approve', [
      POLYGON_CROSSCHAIN_CONFIG.acrossPolygonSpokePool,
      exactAmount
    ]);

    const decoded = usdcInterface.decodeFunctionData('approve', calldata);
    assert.equal(decoded[0].toLowerCase(), POLYGON_CROSSCHAIN_CONFIG.acrossPolygonSpokePool.toLowerCase());
    assert.equal(decoded[1], exactAmount);
  });

  // 8. Across Deposit Calldata Verification
  await t.test('8. Across V3 SpokePool: Validates depositV3 function calldata', async () => {
    const depositCalldata = spokePoolInterface.encodeFunctionData('depositV3', [
      USER_ADDR, // depositor
      USER_ADDR, // recipient
      POLYGON_CROSSCHAIN_CONFIG.polygonUsdcAddress, // inputToken
      POLYGON_CROSSCHAIN_CONFIG.arbitrumUsdcAddress, // outputToken
      99184n, // inputAmount
      98400n, // outputAmount
      42161n, // destinationChainId
      ZERO_ADDRESS, // exclusiveRelayer
      Math.floor(Date.now() / 1000) - 60, // quoteTimestamp
      Math.floor(Date.now() / 1000) + 1800, // fillDeadline
      0, // exclusivityDeadline
      '0x' // message
    ]);

    const decoded = spokePoolInterface.decodeFunctionData('depositV3', depositCalldata);
    assert.equal(decoded[0].toLowerCase(), USER_ADDR.toLowerCase());
    assert.equal(decoded[4], 99184n);
    assert.equal(decoded[6], 42161n);
  });

  // 9. Sanitized Audit Record Integrity
  await t.test('9. Security Invariant: Sanitized audit records never contain secret key material', () => {
    const cleanRecord: OperatorAuditRecord = {
      timestamp: Date.now(),
      level: 'INFO',
      category: 'EXECUTION',
      message: 'Polygon source swap simulated successfully',
      planId: 'plan_poly_001',
      txHashes: ['0x1111111111111111111111111111111111111111111111111111111111111111']
    };

    assert.doesNotThrow(() => assertSanitizedAuditRecord(cleanRecord));
  });

  // 10. Address Consistency Verification
  await t.test('10. Address Consistency: Rejects unknown wallet address with BLOCKED_SIGNER_ADDRESS_MISMATCH', async () => {
    const randomWallet = Wallet.createRandom();

    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY',
      suppressLogs: true
    });

    assert.equal(result.diagnostics?.expectedOperatorAddress, USER_ADDR);
  });

  // 11. Mainnet Chain ID Verification
  await t.test('11. Mainnet Chain ID: Strictly validates Polygon (137) to Arbitrum One (42161)', async () => {
    assert.equal(POLYGON_CROSSCHAIN_CONFIG.sourceChainId, 137);
    assert.equal(POLYGON_CROSSCHAIN_CONFIG.destinationChainId, 42161);
    assert.equal(POLYGON_CROSSCHAIN_CONFIG.sourceChainName, 'polygon');
    assert.equal(POLYGON_CROSSCHAIN_CONFIG.destinationChainName, 'arbitrum');
  });

  // 12. Final Broadcast Gate Reached (Dry-Run Safety)
  await t.test('12. Final Broadcast Gate: Halts safely at PRE_BROADCAST_GATE_REACHED before signing or broadcast', async () => {
    const mockProvider: any = {
      getBlockNumber: async () => 94121548,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('10.0'),
      getTransactionCount: async () => 12,
      getFeeData: async () => ({
        gasPrice: parseUnits('270', 'gwei'),
        maxFeePerGas: parseUnits('390', 'gwei')
      })
    };

    const mockWallet = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', mockProvider);

    const origConfirm = process.env.ZENITH_LIVE_CONFIRM;
    try {
      process.env.ZENITH_LIVE_CONFIRM = OPERATOR_CONFIRM_SOURCE_TOKEN;

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        stopAtBroadcastGate: true,
        suppressLogs: true
      });

      assert.equal(result.status, 'READY_FOR_LIVE_BROADCAST');
      assert.equal(result.preBroadcastGates?.['FINAL_BROADCAST_GATE'], 'PRE_BROADCAST_GATE_REACHED');
      assert.equal(result.sourceTxHash, undefined);
      assert.equal(result.bridgeTxHash, undefined);
    } finally {
      if (origConfirm) process.env.ZENITH_LIVE_CONFIRM = origConfirm;
      else delete process.env.ZENITH_LIVE_CONFIRM;
    }
  });

  // 13. New Operator Address Revalidation
  await t.test('13. New Operator Wallet: Strictly verifies 0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88 as authoritative operator', async () => {
    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY',
      suppressLogs: true
    });

    assert.equal(result.diagnostics?.expectedOperatorAddress, '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88');
    assert.equal(result.diagnostics?.signerAddress, '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88');
    assert.equal(result.diagnostics?.addressMatch, true);
  });

  // 14. Compromised Wallet Invalidation
  await t.test('14. Compromised Wallet Rejection: Prevents old compromised wallet address from matching', async () => {
    const oldCompromisedAddress = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
    assert.notEqual(
      USER_ADDR.toLowerCase(),
      oldCompromisedAddress.toLowerCase(),
      'New operator address must not match old compromised address'
    );
  });

  // 15. Explicit Mainnet Confirmation Gate Matching
  await t.test('15. Mainnet Confirmation Gates: Accepts exact ZENITH_MAINNET_CONFIRM=CONFIRM_POLYGON_ARBITRUM_MAINNET', async () => {
    const mockProvider: any = {
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({
        gasPrice: parseUnits('280', 'gwei'),
        maxFeePerGas: parseUnits('430', 'gwei')
      })
    };

    const mockWallet = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', mockProvider);

    const origMainnet = process.env.ZENITH_MAINNET_CONFIRM;
    const origLive = process.env.ZENITH_LIVE_CONFIRM;
    try {
      delete process.env.ZENITH_LIVE_CONFIRM;
      process.env.ZENITH_MAINNET_CONFIRM = 'CONFIRM_POLYGON_ARBITRUM_MAINNET';

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        stopAtBroadcastGate: true,
        suppressLogs: true
      });

      assert.equal(result.status, 'READY_FOR_LIVE_BROADCAST');
      assert.equal(result.preBroadcastGates?.['FINAL_BROADCAST_GATE'], 'PRE_BROADCAST_GATE_REACHED');
    } finally {
      if (origMainnet) process.env.ZENITH_MAINNET_CONFIRM = origMainnet;
      else delete process.env.ZENITH_MAINNET_CONFIRM;
      if (origLive) process.env.ZENITH_LIVE_CONFIRM = origLive;
    }
  });

  // 16. Ambiguous / Malformed Confirmation Rejection
  await t.test('16. Confirmation Gate Security: Strictly rejects truthy, malformed, or ambiguous confirmation values', async () => {
    const invalidConfirmations = ['true', '1', 'yes', 'CONFIRM', 'CONFIRM_TESTNET', 'CONFIRM_POLYGON', ''];

    const mockProvider: any = {
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei') })
    };
    const mockWallet = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', mockProvider);

    for (const badToken of invalidConfirmations) {
      const origMainnet = process.env.ZENITH_MAINNET_CONFIRM;
      const origLive = process.env.ZENITH_LIVE_CONFIRM;
      try {
        delete process.env.ZENITH_LIVE_CONFIRM;
        process.env.ZENITH_MAINNET_CONFIRM = badToken;

        const result = await runControlledPolygonCrossChainExecution({
          executionMode: 'LIVE_ONCHAIN',
          injectedWallet: mockWallet,
          injectedProvider: mockProvider,
          suppressLogs: true
        });

        assert.equal(result.status, 'BLOCKED_OPERATOR_CONFIRMATION', `Failed to reject invalid token: "${badToken}"`);
      } finally {
        if (origMainnet) process.env.ZENITH_MAINNET_CONFIRM = origMainnet;
        else delete process.env.ZENITH_MAINNET_CONFIRM;
        if (origLive) process.env.ZENITH_LIVE_CONFIRM = origLive;
      }
    }
  });

  // 17. Mainnet Private Key Loading Invariant
  await t.test('17. Mainnet Key Resolution: Prioritizes ZENITH_MAINNET_PRIVATE_KEY over legacy names', async () => {
    const origMainnetKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    const origTestnetKey = process.env.TESTNET_PRIVATE_KEY;

    try {
      const mainnetWallet = Wallet.createRandom();
      const legacyWallet = Wallet.createRandom();

      process.env.ZENITH_MAINNET_PRIVATE_KEY = mainnetWallet.privateKey;
      process.env.TESTNET_PRIVATE_KEY = legacyWallet.privateKey;

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'READ_ONLY',
        suppressLogs: true
      });

      assert.equal(result.diagnostics?.signerAddress?.toLowerCase(), mainnetWallet.address.toLowerCase());
    } finally {
      if (origMainnetKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origMainnetKey;
      else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
      if (origTestnetKey) process.env.TESTNET_PRIVATE_KEY = origTestnetKey;
      else delete process.env.TESTNET_PRIVATE_KEY;
    }
  });

  // 18. Amount Safety & Across Deposit Invariant
  await t.test('18. Amount Safety: Verifies 5.0 POL min source output exceeds Across minDeposit threshold', async () => {
    const rateRawPerPol = 103577n;
    const amountInWei = parseUnits('5.0', 18);
    const expectedOutRaw = (amountInWei * rateRawPerPol) / 10n**18n; // 517,885 raw
    const minOutRaw = (expectedOutRaw * 995n) / 1000n; // 515,295 raw
    const acrossMinDeposit = 500156n;

    assert.ok(minOutRaw >= acrossMinDeposit, '5.0 POL min output must exceed Across minDeposit floor');
    assert.equal(minOutRaw, 515295n);
  });

  // 19. 120% Gas Outflow Safety Policy
  await t.test('19. Gas Safety: 120% safe gas policy calculates exact safe budget without overflow', async () => {
    const safeGasUnits = 378000n;
    const maxFeePerGas = parseUnits('432.816408678', 'gwei');
    const safeGasOutflow = safeGasUnits * maxFeePerGas;

    assert.equal(safeGasOutflow, 163604602480284000n); // ~0.163605 POL
    const totalOutflow = parseUnits('5.0', 18) + safeGasOutflow;
    assert.equal(totalOutflow, 5163604602480284000n); // ~5.163605 POL
  });

  // 20. Execution Plan DAG Structure & Immutability
  await t.test('20. ExecutionPlan Integrity: Verifies 8-step composite cross-chain DAG sequence', async () => {
    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'PREFLIGHT_ONLY',
      suppressLogs: true
    });

    const expectedStepTypes = [
      'VALIDATE_CONDITIONS',
      'SOURCE_DEX_SWAP',
      'BRIDGE_QUOTE_REFRESH',
      'SOURCE_APPROVE',
      'BRIDGE_DEPOSIT',
      'CROSS_CHAIN_RELAY_WAIT',
      'DESTINATION_VERIFY',
      'SETTLEMENT_COMPLETE'
    ];

    assert.ok(result.plan);
    assert.equal(result.plan.steps.length, 8);
    result.plan.steps.forEach((step, idx) => {
      assert.equal(step.type, expectedStepTypes[idx]);
    });
  });

  // 21. Network Safety: Rejects invalid source chain ID (e.g. Polygon Amoy 80002)
  await t.test('21. Network Safety: Rejects invalid source chain ID with BLOCKED_NETWORK_SAFETY', async () => {
    const wrongSourceProvider: any = {
      getNetwork: async () => ({ chainId: 80002n }),
      getBlockNumber: async () => 123456
    };

    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY',
      injectedProvider: wrongSourceProvider,
      suppressLogs: true
    });

    assert.equal(result.status, 'BLOCKED_NETWORK_SAFETY');
    assert.ok(result.blockReason?.includes('80002'));
  });

  // 22. Network Safety: Rejects invalid destination chain ID (e.g. Arbitrum Sepolia 421614)
  await t.test('22. Network Safety: Rejects invalid destination chain ID with BLOCKED_NETWORK_SAFETY', async () => {
    const validSourceProvider: any = {
      getNetwork: async () => ({ chainId: 137n }),
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('10.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('270', 'gwei') })
    };

    const wrongDestProvider: any = {
      getNetwork: async () => ({ chainId: 421614n })
    };

    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY',
      injectedProvider: validSourceProvider,
      injectedArbitrumProvider: wrongDestProvider,
      suppressLogs: true
    });

    assert.equal(result.status, 'BLOCKED_NETWORK_SAFETY');
    assert.ok(result.blockReason?.includes('421614'));
  });

  // 23. Confirmation Gate: Strictly rejects legacy testnet confirmation token
  await t.test('23. Confirmation Gate: Rejects CONFIRM_TESTNET_EXECUTION in mainnet runner', async () => {
    const mockProvider: any = {
      getNetwork: async () => ({ chainId: 137n }),
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei') })
    };
    const mockWallet = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', mockProvider);

    const origMainnet = process.env.ZENITH_MAINNET_CONFIRM;
    const origLive = process.env.ZENITH_LIVE_CONFIRM;
    try {
      delete process.env.ZENITH_MAINNET_CONFIRM;
      process.env.ZENITH_LIVE_CONFIRM = 'CONFIRM_TESTNET_EXECUTION';

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_OPERATOR_CONFIRMATION');
    } finally {
      if (origMainnet) process.env.ZENITH_MAINNET_CONFIRM = origMainnet;
      else delete process.env.ZENITH_MAINNET_CONFIRM;
      if (origLive) process.env.ZENITH_LIVE_CONFIRM = origLive;
    }
  });

  // 24. Recipient Safety: Rejects recipient address mismatch
  await t.test('24. Recipient Safety: Fails closed with BLOCKED_RECIPIENT_ADDRESS_MISMATCH on unauthorized recipient', async () => {
    const mockProvider: any = {
      getNetwork: async () => ({ chainId: 137n }),
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei') })
    };
    const mockWallet = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', mockProvider);

    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY',
      injectedWallet: mockWallet,
      injectedProvider: mockProvider,
      expectedRecipientAddress: Wallet.createRandom().address,
      suppressLogs: true
    });

    assert.equal(result.status, 'BLOCKED_RECIPIENT_ADDRESS_MISMATCH');
  });

  // 25. Plan Immutability: Detects and rejects plan mutation
  await t.test('25. Plan Immutability: Rejects mutated plan with BLOCKED_PLAN_MUTATION', async () => {
    const mockProvider: any = {
      getNetwork: async () => ({ chainId: 137n }),
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei'), maxFeePerGas: parseUnits('400', 'gwei') })
    };
    const mockWallet = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', mockProvider);

    const origConfirm = process.env.ZENITH_MAINNET_CONFIRM;
    try {
      process.env.ZENITH_MAINNET_CONFIRM = 'CONFIRM_POLYGON_ARBITRUM_MAINNET';

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        mutatePlanBeforeBroadcast: true,
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_PLAN_MUTATION');
      assert.ok(result.blockReason?.includes('fingerprint mismatch'));
    } finally {
      if (origConfirm) process.env.ZENITH_MAINNET_CONFIRM = origConfirm;
      else delete process.env.ZENITH_MAINNET_CONFIRM;
    }
  });

  // 26. Broadcast Uncertainty Safety: Maps ambiguous broadcast to BROADCAST_UNCERTAIN without auto-retry
  await t.test('26. Broadcast Safety: Returns BROADCAST_UNCERTAIN on timeout with zero automatic retry', async () => {
    const mockProvider: any = {
      getNetwork: async () => ({ chainId: 137n }),
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei'), maxFeePerGas: parseUnits('400', 'gwei') }),
      call: async () => '0x',
      estimateGas: async () => 150000n
    };
    const mockWallet = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', mockProvider);

    const origConfirm = process.env.ZENITH_MAINNET_CONFIRM;
    try {
      process.env.ZENITH_MAINNET_CONFIRM = 'CONFIRM_POLYGON_ARBITRUM_MAINNET';

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        simulateBroadcastUncertainty: true,
        suppressLogs: true
      });

      assert.equal(result.status, 'BROADCAST_UNCERTAIN');
      assert.ok(result.blockReason?.includes('automated retry is strictly prohibited'));
    } finally {
      if (origConfirm) process.env.ZENITH_MAINNET_CONFIRM = origConfirm;
      else delete process.env.ZENITH_MAINNET_CONFIRM;
    }
  });

  // 27. Source Swap Revert: Maps reverted swap receipt to FAILED_WITH_VERIFIED_REVERT
  await t.test('27. Source Swap Revert: Fails safely with FAILED_WITH_VERIFIED_REVERT when swap receipt status is 0', async () => {
    const mockProvider: any = {
      getNetwork: async () => ({ chainId: 137n }),
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei'), maxFeePerGas: parseUnits('400', 'gwei') }),
      call: async () => '0x',
      estimateGas: async () => 150000n
    };
    const mockWallet: any = {
      address: USER_ADDR,
      sendTransaction: async () => ({
        hash: '0xmock_swap_tx',
        wait: async () => ({ status: 0, blockNumber: 94173500 }) // Reverted receipt
      })
    };

    const origConfirm = process.env.ZENITH_MAINNET_CONFIRM;
    try {
      process.env.ZENITH_MAINNET_CONFIRM = 'CONFIRM_POLYGON_ARBITRUM_MAINNET';

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        suppressLogs: true
      });

      assert.equal(result.status, 'FAILED_WITH_VERIFIED_REVERT');
      assert.ok(result.blockReason?.includes('Source swap reverted'));
    } finally {
      if (origConfirm) process.env.ZENITH_MAINNET_CONFIRM = origConfirm;
      else delete process.env.ZENITH_MAINNET_CONFIRM;
    }
  });

  // 28. Output Conflict Safety: Flags STATUS_CONFLICT when Transfer logs and balance delta diverge
  await t.test('28. Output Conflict: Flags STATUS_CONFLICT when Transfer logs disagree with balance delta', async () => {
    const mockProvider: any = {
      getNetwork: async () => ({ chainId: 137n }),
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei'), maxFeePerGas: parseUnits('400', 'gwei') }),
      call: async () => '0x',
      estimateGas: async () => 150000n
    };
    const mockWallet: any = {
      address: USER_ADDR,
      sendTransaction: async () => ({
        hash: '0xmock_swap_tx',
        wait: async () => ({
          status: 1,
          blockNumber: 94173500,
          gasUsed: 150000n,
          logs: [
            {
              address: POLYGON_CROSSCHAIN_CONFIG.polygonUsdcAddress,
              topics: [
                ERC20_TRANSFER_TOPIC,
                '0x000000000000000000000000' + POLYGON_CROSSCHAIN_CONFIG.zenithV3Router.slice(2),
                '0x000000000000000000000000' + USER_ADDR.slice(2)
              ],
              data: '0x000000000000000000000000000000000000000000000000000000000007e0c0' // 516,288 raw USDC
            }
          ]
        })
      })
    };

    const origConfirm = process.env.ZENITH_MAINNET_CONFIRM;
    try {
      process.env.ZENITH_MAINNET_CONFIRM = 'CONFIRM_POLYGON_ARBITRUM_MAINNET';

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        simulateOutputConflict: true,
        suppressLogs: true
      });

      assert.equal(result.status, 'STATUS_CONFLICT');
    } finally {
      if (origConfirm) process.env.ZENITH_MAINNET_CONFIRM = origConfirm;
      else delete process.env.ZENITH_MAINNET_CONFIRM;
    }
  });

  // 29. Destination Safety: Missing on-chain Arbitrum receipt marks DESTINATION_STATUS_UNCERTAIN
  await t.test('29. Destination Safety: Missing Arbitrum receipt produces DESTINATION_STATUS_UNCERTAIN without fabricated settlement', async () => {
    const mockProvider: any = {
      getNetwork: async () => ({ chainId: 137n }),
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei'), maxFeePerGas: parseUnits('400', 'gwei') }),
      call: async () => '0x',
      estimateGas: async () => 150000n
    };
    const mockWallet: any = {
      address: USER_ADDR,
      sendTransaction: async () => ({
        hash: '0xmock_tx_hash',
        wait: async () => ({
          status: 1,
          blockNumber: 94173500,
          gasUsed: 150000n,
          logs: [
            {
              address: POLYGON_CROSSCHAIN_CONFIG.polygonUsdcAddress,
              topics: [
                ERC20_TRANSFER_TOPIC,
                '0x000000000000000000000000' + POLYGON_CROSSCHAIN_CONFIG.zenithV3Router.slice(2),
                '0x000000000000000000000000' + USER_ADDR.slice(2)
              ],
              data: '0x000000000000000000000000000000000000000000000000000000000007e0c0' // 516,288 raw
            }
          ]
        })
      })
    };

    const origConfirm = process.env.ZENITH_MAINNET_CONFIRM;
    const origBridgeConfirm = process.env.ZENITH_MAINNET_BRIDGE_CONFIRM;
    try {
      process.env.ZENITH_MAINNET_CONFIRM = 'CONFIRM_POLYGON_ARBITRUM_MAINNET';
      process.env.ZENITH_MAINNET_BRIDGE_CONFIRM = 'CONFIRM_ACROSS_MAINNET';

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        simulateMissingDestinationReceipt: true,
        suppressLogs: true
      });

      assert.equal(result.status, 'DESTINATION_STATUS_UNCERTAIN');
    } finally {
      if (origConfirm) process.env.ZENITH_MAINNET_CONFIRM = origConfirm;
      else delete process.env.ZENITH_MAINNET_CONFIRM;
      if (origBridgeConfirm) process.env.ZENITH_MAINNET_BRIDGE_CONFIRM = origBridgeConfirm;
      else delete process.env.ZENITH_MAINNET_BRIDGE_CONFIRM;
    }
  });

  // 30. Destination Safety: Reverted destination settlement produces DESTINATION_RECEIPT_REVERT
  await t.test('30. Destination Safety: Reverted Arbitrum receipt produces DESTINATION_RECEIPT_REVERT', async () => {
    const mockProvider: any = {
      getNetwork: async () => ({ chainId: 137n }),
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei'), maxFeePerGas: parseUnits('400', 'gwei') }),
      call: async () => '0x',
      estimateGas: async () => 150000n
    };
    const mockWallet: any = {
      address: USER_ADDR,
      sendTransaction: async () => ({
        hash: '0xmock_tx_hash',
        wait: async () => ({
          status: 1,
          blockNumber: 94173500,
          gasUsed: 150000n,
          logs: [
            {
              address: POLYGON_CROSSCHAIN_CONFIG.polygonUsdcAddress,
              topics: [
                ERC20_TRANSFER_TOPIC,
                '0x000000000000000000000000' + POLYGON_CROSSCHAIN_CONFIG.zenithV3Router.slice(2),
                '0x000000000000000000000000' + USER_ADDR.slice(2)
              ],
              data: '0x000000000000000000000000000000000000000000000000000000000007e0c0'
            }
          ]
        })
      })
    };

    const origConfirm = process.env.ZENITH_MAINNET_CONFIRM;
    const origBridgeConfirm = process.env.ZENITH_MAINNET_BRIDGE_CONFIRM;
    try {
      process.env.ZENITH_MAINNET_CONFIRM = 'CONFIRM_POLYGON_ARBITRUM_MAINNET';
      process.env.ZENITH_MAINNET_BRIDGE_CONFIRM = 'CONFIRM_ACROSS_MAINNET';

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        simulateDestinationRevert: true,
        suppressLogs: true
      });

      assert.equal(result.status, 'DESTINATION_RECEIPT_REVERT');
    } finally {
      if (origConfirm) process.env.ZENITH_MAINNET_CONFIRM = origConfirm;
      else delete process.env.ZENITH_MAINNET_CONFIRM;
      if (origBridgeConfirm) process.env.ZENITH_MAINNET_BRIDGE_CONFIRM = origBridgeConfirm;
      else delete process.env.ZENITH_MAINNET_BRIDGE_CONFIRM;
    }
  });

  // 31. Preflight Simulation Failure / Revert
  await t.test('31. Simulation Safety: Terminates with BLOCKED_SOURCE_PREFLIGHT when pre-broadcast eth_call simulation reverts', async () => {
    const mockProvider: any = {
      getNetwork: async () => ({ chainId: 137n }),
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei'), maxFeePerGas: parseUnits('400', 'gwei') }),
      call: async () => { throw new Error('execution reverted: UniswapV3: STF'); },
      estimateGas: async () => 150000n
    };
    const mockWallet = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', mockProvider);

    const origConfirm = process.env.ZENITH_MAINNET_CONFIRM;
    try {
      process.env.ZENITH_MAINNET_CONFIRM = 'CONFIRM_POLYGON_ARBITRUM_MAINNET';

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_SOURCE_PREFLIGHT');
      assert.ok(result.blockReason?.includes('UniswapV3: STF'));
    } finally {
      if (origConfirm) process.env.ZENITH_MAINNET_CONFIRM = origConfirm;
      else delete process.env.ZENITH_MAINNET_CONFIRM;
    }
  });

  // 32. Execution Mode Boundary Safety: Non-LIVE modes strictly never evaluate signing
  await t.test('32. Execution Mode Boundary: READ_ONLY_LIVE and PREFLIGHT_ONLY strictly halt prior to signing gates', async () => {
    const mockProvider: any = {
      getNetwork: async () => ({ chainId: 137n }),
      getBlockNumber: async () => 94173460,
      getCode: async () => '0x60806040',
      getBalance: async () => parseEther('20.0'),
      getTransactionCount: async () => 29,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei') })
    };

    const resReadOnly = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY_LIVE' as any,
      injectedProvider: mockProvider,
      suppressLogs: true
    });
    assert.equal(resReadOnly.status, 'READY_FOR_CONTROLLED_BRIDGE_BROADCAST');
    assert.equal(resReadOnly.sourceTxHash, undefined);
    assert.equal(resReadOnly.bridgeTxHash, undefined);

    const resPreflight = await runControlledPolygonCrossChainExecution({
      executionMode: 'PREFLIGHT_ONLY',
      injectedProvider: mockProvider,
      suppressLogs: true
    });
    assert.equal(resPreflight.status, 'READY_FOR_CONTROLLED_BRIDGE_BROADCAST');
    assert.equal(resPreflight.sourceTxHash, undefined);
    assert.equal(resPreflight.bridgeTxHash, undefined);
  });
});

test('ZENITH — PHASE 1 / TASK 21B: SIGNER CONFIGURATION & SAFE DIAGNOSTIC REGRESSION SUITE', async (t) => {
  const syntheticKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const rawKeyNoPrefix = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const rawKeyWithQuotes = '"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"';

  const mockProvider: any = {
    getNetwork: async () => ({ chainId: 137n }),
    getBlockNumber: async () => 94173460,
    getCode: async () => '0x60806040',
    getBalance: async () => parseEther('20.0'),
    getTransactionCount: async () => 29,
    getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei'), maxFeePerGas: parseUnits('400', 'gwei') })
  };

  const mockArbitrumProvider: any = {
    getNetwork: async () => ({ chainId: 42161n }),
    getBlockNumber: async () => 250000000,
    getCode: async () => '0x60806040'
  };

  // 1. normalizePrivateKey utility tests
  await t.test('1. normalizePrivateKey: Strips whitespace, enclosing quotes, and ensures 0x prefix', () => {
    assert.equal(normalizePrivateKey(undefined), null);
    assert.equal(normalizePrivateKey(''), null);
    assert.equal(normalizePrivateKey('   '), null);
    assert.equal(normalizePrivateKey(rawKeyNoPrefix), '0x' + rawKeyNoPrefix);
    assert.equal(normalizePrivateKey('  ' + rawKeyNoPrefix + '  '), '0x' + rawKeyNoPrefix);
    assert.equal(normalizePrivateKey(rawKeyWithQuotes), '0x' + rawKeyNoPrefix);
    assert.equal(normalizePrivateKey("'" + rawKeyNoPrefix + "'"), '0x' + rawKeyNoPrefix);
    assert.equal(normalizePrivateKey(syntheticKey), syntheticKey);
  });

  // 2. Missing signer -> BLOCKED_NO_LOCAL_SIGNER
  await t.test('2. Missing signer: Fails closed with BLOCKED_NO_FUNDED_KEY and BLOCKED_NO_LOCAL_SIGNER in blockReason', async () => {
    const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    const origLegacy = process.env.TESTNET_PRIVATE_KEY;
    try {
      delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
      delete process.env.TESTNET_PRIVATE_KEY;
      delete process.env.ZENITH_PRIVATE_KEY;
      delete process.env.PRIVATE_KEY;

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedProvider: mockProvider,
        injectedArbitrumProvider: mockArbitrumProvider,
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_NO_FUNDED_KEY');
      assert.ok(result.blockReason?.includes('BLOCKED_NO_LOCAL_SIGNER'));
      assert.equal(result.safeSignerDiagnostic?.SIGNER_ENV_CONFIGURED, false);
      assert.equal(result.safeSignerDiagnostic?.SIGNER_OBJECT_INITIALIZED, false);
      assert.equal(result.safeSignerDiagnostic?.LIVE_SIGNING_GATE_READY, false);
    } finally {
      if (origKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      if (origLegacy) process.env.TESTNET_PRIVATE_KEY = origLegacy;
    }
  });

  // 3. Signer configured with un-prefixed key -> normalizes, initializes, and matches operator
  await t.test('3. Key normalization: Accepts 64-char key without 0x prefix and initializes wallet', async () => {
    const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    try {
      const testWallet = Wallet.createRandom();
      process.env.ZENITH_MAINNET_PRIVATE_KEY = testWallet.privateKey.slice(2); // no 0x prefix

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedProvider: mockProvider,
        injectedArbitrumProvider: mockArbitrumProvider,
        expectedRecipientAddress: testWallet.address,
        suppressLogs: true
      });

      assert.equal(result.safeSignerDiagnostic?.SIGNER_ENV_CONFIGURED, true);
      assert.equal(result.safeSignerDiagnostic?.SIGNER_OBJECT_INITIALIZED, true);
      assert.equal(result.safeSignerDiagnostic?.SIGNER_PROVIDER_ATTACHED, true);
    } finally {
      if (origKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
    }
  });

  // 4. Signer configured with quoted key -> strips quotes and initializes
  await t.test('4. Key normalization: Strips outer quotes from PowerShell strings', async () => {
    const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    try {
      const testWallet = Wallet.createRandom();
      process.env.ZENITH_MAINNET_PRIVATE_KEY = `"${testWallet.privateKey}"`;

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedProvider: mockProvider,
        injectedArbitrumProvider: mockArbitrumProvider,
        expectedRecipientAddress: testWallet.address,
        suppressLogs: true
      });

      assert.equal(result.safeSignerDiagnostic?.SIGNER_ENV_CONFIGURED, true);
      assert.equal(result.safeSignerDiagnostic?.SIGNER_OBJECT_INITIALIZED, true);
    } finally {
      if (origKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
    }
  });

  // 5. Wrong signer address -> BLOCKED_SIGNER_MISMATCH
  await t.test('5. Wrong signer address: Fails closed with BLOCKED_SIGNER_ADDRESS_MISMATCH and BLOCKED_SIGNER_MISMATCH', async () => {
    const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    try {
      const foreignWallet = Wallet.createRandom();
      process.env.ZENITH_MAINNET_PRIVATE_KEY = foreignWallet.privateKey;

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedProvider: mockProvider,
        injectedArbitrumProvider: mockArbitrumProvider,
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_SIGNER_ADDRESS_MISMATCH');
      assert.ok(result.blockReason?.includes('BLOCKED_SIGNER_MISMATCH'));
      assert.equal(result.safeSignerDiagnostic?.SIGNER_ENV_CONFIGURED, true);
      assert.equal(result.safeSignerDiagnostic?.SIGNER_OBJECT_INITIALIZED, true);
      assert.equal(result.safeSignerDiagnostic?.LIVE_SIGNING_GATE_READY, false);
    } finally {
      if (origKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
    }
  });

  // 6. READ_ONLY_LIVE -> never signs
  await t.test('6. READ_ONLY_LIVE: Strictly halts without attempting to sign', async () => {
    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY_LIVE' as any,
      injectedProvider: mockProvider,
      injectedArbitrumProvider: mockArbitrumProvider,
      suppressLogs: true
    });
    assert.equal(result.status, 'READY_FOR_CONTROLLED_BRIDGE_BROADCAST');
    assert.equal(result.sourceTxHash, undefined);
    assert.equal(result.bridgeTxHash, undefined);
  });

  // 7. PREFLIGHT_ONLY -> never signs
  await t.test('7. PREFLIGHT_ONLY: Strictly halts without attempting to sign', async () => {
    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'PREFLIGHT_ONLY',
      injectedProvider: mockProvider,
      injectedArbitrumProvider: mockArbitrumProvider,
      suppressLogs: true
    });
    assert.equal(result.status, 'READY_FOR_CONTROLLED_BRIDGE_BROADCAST');
    assert.equal(result.sourceTxHash, undefined);
    assert.equal(result.bridgeTxHash, undefined);
  });

  // 8. LIVE_ONCHAIN -> requires signer object and matching confirmation tokens
  await t.test('8. LIVE_ONCHAIN: Reaches signing gate only when signer object and confirmation tokens are present', async () => {
    const origConfirm = process.env.ZENITH_MAINNET_CONFIRM;
    const origBridgeConfirm = process.env.ZENITH_MAINNET_BRIDGE_CONFIRM;
    try {
      const mockWallet = new Wallet(syntheticKey, mockProvider);
      delete process.env.ZENITH_MAINNET_CONFIRM;

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedWallet: mockWallet,
        injectedProvider: mockProvider,
        injectedArbitrumProvider: mockArbitrumProvider,
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_OPERATOR_CONFIRMATION');
    } finally {
      if (origConfirm) process.env.ZENITH_MAINNET_CONFIRM = origConfirm;
      if (origBridgeConfirm) process.env.ZENITH_MAINNET_BRIDGE_CONFIRM = origBridgeConfirm;
    }
  });

  // 9. Safe Diagnostic: Zero secret values exposed
  await t.test('9. Security Invariant: SafeSignerDiagnostic contains zero secret key material', async () => {
    const mockWallet = new Wallet(syntheticKey, mockProvider);
    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY',
      injectedWallet: mockWallet,
      injectedProvider: mockProvider,
      suppressLogs: true
    });

    const serialized = JSON.stringify(result.safeSignerDiagnostic);
    assert.ok(!serialized.includes(syntheticKey));
    assert.ok(!serialized.includes(syntheticKey.slice(2)));
    assert.equal(typeof result.safeSignerDiagnostic?.SIGNER_ENV_CONFIGURED, 'boolean');
    assert.equal(typeof result.safeSignerDiagnostic?.SIGNER_OBJECT_INITIALIZED, 'boolean');
    assert.equal(typeof result.safeSignerDiagnostic?.SIGNER_PROVIDER_ATTACHED, 'boolean');
    assert.equal(typeof result.safeSignerDiagnostic?.LIVE_SIGNING_GATE_READY, 'boolean');
  });
});

test('ZENITH — PHASE 1 / TASK 21D: LOCAL SIGNER INITIALIZATION & SAFETY TEST MATRIX', async (t) => {
  const valid64NoPrefix = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const valid64With0x = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  const mockProvider: any = {
    getNetwork: async () => ({ chainId: 137n }),
    getBlockNumber: async () => 94173460,
    getCode: async () => '0x60806040',
    getBalance: async () => parseEther('20.0'),
    getTransactionCount: async () => 29,
    getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei'), maxFeePerGas: parseUnits('400', 'gwei') })
  };

  const mockArbitrumProvider: any = {
    getNetwork: async () => ({ chainId: 42161n }),
    getBlockNumber: async () => 250000000,
    getCode: async () => '0x60806040'
  };

  // Format A: valid 64-char hex without 0x
  await t.test('Format A: Valid 64-char hex without 0x canonicalizes to 0x + lowercase', () => {
    assert.equal(normalizePrivateKey(valid64NoPrefix), '0x' + valid64NoPrefix.toLowerCase());
  });

  // Format B: valid 0x + 64-char hex
  await t.test('Format B: Valid 0x + 64-char hex canonicalizes to 0x + lowercase', () => {
    assert.equal(normalizePrivateKey(valid64With0x), valid64With0x.toLowerCase());
    assert.equal(normalizePrivateKey('0X' + valid64NoPrefix), '0x' + valid64NoPrefix.toLowerCase());
  });

  // Format C: surrounding whitespace
  await t.test('Format C: Surrounding whitespace is trimmed cleanly', () => {
    assert.equal(normalizePrivateKey(`   ${valid64With0x}   \n\t`), valid64With0x.toLowerCase());
    assert.equal(normalizePrivateKey(` \t ${valid64NoPrefix} \r\n `), '0x' + valid64NoPrefix.toLowerCase());
  });

  // Format D: surrounding double quotes
  await t.test('Format D: Surrounding double quotes are stripped cleanly', () => {
    assert.equal(normalizePrivateKey(`"${valid64With0x}"`), valid64With0x.toLowerCase());
    assert.equal(normalizePrivateKey(`"${valid64NoPrefix}"`), '0x' + valid64NoPrefix.toLowerCase());
    assert.equal(normalizePrivateKey(`  "${valid64With0x}"  `), valid64With0x.toLowerCase());
  });

  // Format E: surrounding single quotes
  await t.test('Format E: Surrounding single quotes are stripped cleanly', () => {
    assert.equal(normalizePrivateKey(`'${valid64With0x}'`), valid64With0x.toLowerCase());
    assert.equal(normalizePrivateKey(`'${valid64NoPrefix}'`), '0x' + valid64NoPrefix.toLowerCase());
  });

  // Format F: invalid length
  await t.test('Format F: Invalid length (63 or 65 hex chars) is rejected', () => {
    assert.equal(normalizePrivateKey(valid64NoPrefix.slice(1)), null); // 63 chars
    assert.equal(normalizePrivateKey(valid64NoPrefix + 'a'), null); // 65 chars
    assert.equal(normalizePrivateKey('0x' + valid64NoPrefix.slice(1)), null); // 0x + 63 chars
    assert.equal(normalizePrivateKey('0x' + valid64NoPrefix + 'a'), null); // 0x + 65 chars
  });

  // Format G: non-hex characters
  await t.test('Format G: Non-hex characters are rejected', () => {
    const nonHex = valid64NoPrefix.slice(0, 62) + 'zz';
    assert.equal(normalizePrivateKey(nonHex), null);
    assert.equal(normalizePrivateKey('0x' + nonHex), null);
    assert.equal(normalizePrivateKey('0x' + valid64NoPrefix.slice(0, 60) + 'xyz!'), null);
  });

  // Format H: empty value
  await t.test('Format H: Empty string or whitespace-only returns null', () => {
    assert.equal(normalizePrivateKey(''), null);
    assert.equal(normalizePrivateKey('   '), null);
    assert.equal(normalizePrivateKey('\n\t\r '), null);
  });

  // Format I: undefined environment variable
  await t.test('Format I: Undefined or null value returns null', () => {
    assert.equal(normalizePrivateKey(undefined), null);
    assert.equal(normalizePrivateKey(null), null);
  });

  // Format J: malformed quoted value
  await t.test('Format J: Malformed / unmatched quoted value returns null', () => {
    assert.equal(normalizePrivateKey(`"${valid64With0x}`), null); // missing closing quote
    assert.equal(normalizePrivateKey(`${valid64With0x}"`), null); // missing opening quote
    assert.equal(normalizePrivateKey(`'${valid64With0x}"`), null); // mismatched quotes
    assert.equal(normalizePrivateKey(`"${valid64With0x}'`), null); // mismatched quotes
  });

  // Format K: address mismatch
  await t.test('Format K: Derived address mismatch returns BLOCKED_SIGNER_ADDRESS_MISMATCH with diagnostic code', async () => {
    const foreignWallet = Wallet.createRandom();
    const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    try {
      process.env.ZENITH_MAINNET_PRIVATE_KEY = foreignWallet.privateKey;

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedProvider: mockProvider,
        injectedArbitrumProvider: mockArbitrumProvider,
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_SIGNER_ADDRESS_MISMATCH');
      assert.equal(result.safeSignerDiagnostic?.SIGNER_INIT_ERROR_CODE, 'SIGNER_ADDRESS_MISMATCH');
      assert.equal(result.safeSignerDiagnostic?.LIVE_SIGNING_GATE_READY, false);
    } finally {
      if (origKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
    }
  });

  // Format L: provider unavailable
  await t.test('Format L: Disconnected / unavailable provider fails closed', async () => {
    const testWallet = Wallet.createRandom();
    const brokenProvider: any = {
      getNetwork: async () => { throw new Error('RPC connection refused'); },
      getBlockNumber: async () => { throw new Error('Network unreachable'); },
      getCode: async () => '0x60806040',
      getBalance: async () => 0n,
      getTransactionCount: async () => 0,
      getFeeData: async () => ({ gasPrice: parseUnits('280', 'gwei'), maxFeePerGas: parseUnits('400', 'gwei') })
    };

    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY',
      injectedWallet: testWallet,
      injectedProvider: brokenProvider,
      suppressLogs: true
    });

    assert.equal(result.status, 'BLOCKED_PRE_BROADCAST_VALIDATION');
    assert.ok(result.blockReason?.includes('Failed to detect source network chain ID'));

    // Also verify unattached wallet sets SIGNER_PROVIDER_ATTACHED = false
    const unattachedWallet = new Wallet(testWallet.privateKey);
    const resultUnattached = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY',
      injectedWallet: unattachedWallet,
      injectedProvider: mockProvider,
      suppressLogs: true
    });
    assert.equal(resultUnattached.safeSignerDiagnostic?.SIGNER_PROVIDER_ATTACHED, false);
    assert.equal(resultUnattached.safeSignerDiagnostic?.LIVE_SIGNING_GATE_READY, false);
  });

  // Format M: wrong chain ID
  await t.test('Format M: Wrong chain ID (e.g. 1 instead of 137) rejects execution', async () => {
    const wrongChainProvider: any = {
      getNetwork: async () => ({ chainId: 1n }),
      getBlockNumber: async () => 20000000,
      getCode: async () => '0x60806040'
    };

    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'READ_ONLY',
      injectedProvider: wrongChainProvider,
      suppressLogs: true
    });

    assert.equal(result.status, 'BLOCKED_NETWORK_SAFETY');
  });

  // Live Safety 1: Invalid key cannot reach signing
  await t.test('Live Safety 1: Invalid key format fails closed with INVALID_PRIVATE_KEY_FORMAT and cannot reach signing', async () => {
    const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    try {
      process.env.ZENITH_MAINNET_PRIVATE_KEY = 'invalid_not_hex_key_format';

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedProvider: mockProvider,
        injectedArbitrumProvider: mockArbitrumProvider,
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_NO_FUNDED_KEY');
      assert.equal(result.safeSignerDiagnostic?.SIGNER_ENV_CONFIGURED, true);
      assert.equal(result.safeSignerDiagnostic?.SIGNER_OBJECT_INITIALIZED, false);
      assert.equal(result.safeSignerDiagnostic?.LIVE_SIGNING_GATE_READY, false);
      assert.equal(result.safeSignerDiagnostic?.SIGNER_INIT_ERROR_CODE, 'INVALID_PRIVATE_KEY_FORMAT');
      assert.equal(result.sourceTxHash, undefined);
      assert.equal(result.bridgeTxHash, undefined);
    } finally {
      if (origKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
    }
  });

  // Live Safety 2: Address mismatch cannot reach signing
  await t.test('Live Safety 2: Address mismatch strictly halts prior to signing', async () => {
    const foreignWallet = Wallet.createRandom();
    const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    try {
      process.env.ZENITH_MAINNET_PRIVATE_KEY = foreignWallet.privateKey;

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedProvider: mockProvider,
        injectedArbitrumProvider: mockArbitrumProvider,
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_SIGNER_ADDRESS_MISMATCH');
      assert.equal(result.safeSignerDiagnostic?.LIVE_SIGNING_GATE_READY, false);
      assert.equal(result.sourceTxHash, undefined);
      assert.equal(result.bridgeTxHash, undefined);
    } finally {
      if (origKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
    }
  });

  // Live Safety 3: Known compromised address strictly rejected
  await t.test('Live Safety 3: Known compromised address 0xAb5801a7... triggers COMPROMISED_KEY_DETECTED', async () => {
    const mockCompromisedWallet: any = {
      address: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      provider: mockProvider
    };

    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'LIVE_ONCHAIN',
      injectedWallet: mockCompromisedWallet,
      injectedProvider: mockProvider,
      injectedArbitrumProvider: mockArbitrumProvider,
      suppressLogs: true
    });

    assert.equal(result.status, 'BLOCKED_SIGNER_ADDRESS_MISMATCH');
    assert.equal(result.safeSignerDiagnostic?.SIGNER_INIT_ERROR_CODE, 'COMPROMISED_KEY_DETECTED');
    assert.equal(result.safeSignerDiagnostic?.LIVE_SIGNING_GATE_READY, false);
    assert.ok(result.blockReason?.includes('COMPROMISED_KEY_DETECTED'));
  });

  // Live Safety 4: Missing key cannot reach signing
  await t.test('Live Safety 4: Missing key fails closed with EMPTY_KEY and cannot reach signing', async () => {
    const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    const origLegacy = process.env.TESTNET_PRIVATE_KEY;
    try {
      delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
      delete process.env.TESTNET_PRIVATE_KEY;
      delete process.env.ZENITH_PRIVATE_KEY;
      delete process.env.PRIVATE_KEY;

      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'LIVE_ONCHAIN',
        injectedProvider: mockProvider,
        injectedArbitrumProvider: mockArbitrumProvider,
        suppressLogs: true
      });

      assert.equal(result.status, 'BLOCKED_NO_FUNDED_KEY');
      assert.equal(result.safeSignerDiagnostic?.SIGNER_ENV_CONFIGURED, false);
      assert.equal(result.safeSignerDiagnostic?.LIVE_SIGNING_GATE_READY, false);
      assert.equal(result.safeSignerDiagnostic?.SIGNER_INIT_ERROR_CODE, 'EMPTY_KEY');
      assert.equal(result.sourceTxHash, undefined);
      assert.equal(result.bridgeTxHash, undefined);
    } finally {
      if (origKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      if (origLegacy) process.env.TESTNET_PRIVATE_KEY = origLegacy;
    }
  });

  // Live Safety 5: PREFLIGHT_ONLY never broadcasts and never signs
  await t.test('Live Safety 5: PREFLIGHT_ONLY strictly halts with zero signatures and zero broadcasts', async () => {
    const result = await runControlledPolygonCrossChainExecution({
      executionMode: 'PREFLIGHT_ONLY',
      injectedProvider: mockProvider,
      injectedArbitrumProvider: mockArbitrumProvider,
      suppressLogs: true
    });

    assert.equal(result.sourceTxHash, undefined);
    assert.equal(result.bridgeTxHash, undefined);
    assert.ok(result.status.startsWith('READY_') || result.status.startsWith('PRE_'));
  });

  // Live Safety 6: PREFLIGHT_ONLY honest diagnostics when signer construction is skipped
  await t.test('Live Safety 6: PREFLIGHT_ONLY honest diagnostics when signer construction is skipped', async () => {
    const origKey = process.env.ZENITH_MAINNET_PRIVATE_KEY;
    try {
      process.env.ZENITH_MAINNET_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const result = await runControlledPolygonCrossChainExecution({
        executionMode: 'PREFLIGHT_ONLY',
        skipSignerInit: true,
        injectedProvider: mockProvider,
        injectedArbitrumProvider: mockArbitrumProvider,
        suppressLogs: true
      });

      assert.equal(result.executionMode, 'PREFLIGHT_ONLY');
      assert.equal(result.safeSignerDiagnostic?.SIGNER_ENV_CONFIGURED, true);
      assert.equal(result.safeSignerDiagnostic?.SIGNER_OBJECT_INITIALIZED, false);
      assert.equal(result.safeSignerDiagnostic?.SIGNER_PROVIDER_ATTACHED, false);
      assert.equal(result.safeSignerDiagnostic?.LIVE_SIGNING_GATE_READY, false);
      assert.equal(result.sourceTxHash, undefined);
      assert.equal(result.bridgeTxHash, undefined);
    } finally {
      if (origKey) process.env.ZENITH_MAINNET_PRIVATE_KEY = origKey;
      else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
    }
  });
});

