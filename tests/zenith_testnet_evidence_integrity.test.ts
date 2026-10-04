import test from 'node:test';
import assert from 'node:assert/strict';

interface OnChainTxReceipt {
  status: 'SUCCESS' | 'REVERTED';
  chainId: number;
  to: string;
  from: string;
  blockNumber: number;
  blockHash: string;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
}

interface SettlementVerificationParams {
  expectedChainId: number;
  expectedRecipient: string;
  expectedToken: string;
  minimumAmount: bigint;
  currentBlockNumber: number;
  requiredConfirmationDepth: number;
  receipt: OnChainTxReceipt | null;
  providerReportsFilled: boolean;
  reorgDetected?: boolean;
}

function verifySettlementEvidence(params: SettlementVerificationParams): { verified: boolean; error?: string; actualAmount?: bigint } {
  if (params.reorgDetected) {
    return { verified: false, error: 'SETTLEMENT_BLOCKED_REORG_DETECTED: Canonical block reorg invalidated destination transaction' };
  }
  if (!params.receipt) {
    if (params.providerReportsFilled) {
      return { verified: false, error: 'UNVERIFIED_EVIDENCE: Provider claims fill but on-chain receipt is missing' };
    }
    return { verified: false, error: 'MISSING_RECEIPT: No destination transaction receipt found' };
  }
  if (params.receipt.status !== 'SUCCESS') {
    return { verified: false, error: 'SETTLEMENT_REJECTED_TRANSACTION_REVERTED: Destination transaction reverted on-chain' };
  }
  if (params.receipt.chainId !== params.expectedChainId) {
    return { verified: false, error: `CHAIN_MISMATCH: Destination transaction on chain ${params.receipt.chainId} != expected ${params.expectedChainId}` };
  }

  // Parse Transfer events: Transfer(address from, address to, uint256 value)
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  let totalTransferred = 0n;

  for (const log of params.receipt.logs) {
    if (
      log.address.toLowerCase() === params.expectedToken.toLowerCase() &&
      log.topics[0] === transferTopic &&
      log.topics[2] &&
      log.topics[2].toLowerCase().includes(params.expectedRecipient.slice(2).toLowerCase())
    ) {
      const val = BigInt(log.data);
      totalTransferred += val;
    }
  }

  if (totalTransferred < params.minimumAmount) {
    return {
      verified: false,
      error: `INSUFFICIENT_DESTINATION_AMOUNT: Received ${totalTransferred} < minimum required ${params.minimumAmount}`,
      actualAmount: totalTransferred
    };
  }

  const confirmations = params.currentBlockNumber - params.receipt.blockNumber;
  if (confirmations < params.requiredConfirmationDepth) {
    return {
      verified: false,
      error: `FINALITY_PENDING: Confirmations ${confirmations} < required depth ${params.requiredConfirmationDepth}`,
      actualAmount: totalTransferred
    };
  }

  return { verified: true, actualAmount: totalTransferred };
}

test('ZENITH Protocol — Destination Evidence, Finality & Reorg Invariant Suite', async (t) => {
  const validRecipient = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
  const validToken = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'; // Arbitrum Sepolia USDC
  const minimumAmount = 10000000n; // 10.0 USDC

  const validReceipt: OnChainTxReceipt = {
    status: 'SUCCESS',
    chainId: 421614,
    to: validToken,
    from: '0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75', // Across SpokePool
    blockNumber: 100000,
    blockHash: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
    logs: [
      {
        address: validToken,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          '0x0000000000000000000000007e63a5f1a8f0b4d0934b2f2327daed3f6bb2ee75',
          '0x000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b'
        ],
        data: '0x0000000000000000000000000000000000000000000000000000000000989680' // 10,000,000 (10 USDC)
      }
    ]
  };

  await t.test('1. Authoritative Destination Receipt with Full Finality Passes Verification', () => {
    const res = verifySettlementEvidence({
      expectedChainId: 421614,
      expectedRecipient: validRecipient,
      expectedToken: validToken,
      minimumAmount,
      currentBlockNumber: 100070, // 70 confirmations >= 64
      requiredConfirmationDepth: 64,
      receipt: validReceipt,
      providerReportsFilled: true,
    });
    assert.equal(res.verified, true);
    assert.equal(res.actualAmount, 10000000n);
  });

  await t.test('2. Provider Claiming Fill Without Authoritative On-Chain Receipt is REJECTED', () => {
    const res = verifySettlementEvidence({
      expectedChainId: 421614,
      expectedRecipient: validRecipient,
      expectedToken: validToken,
      minimumAmount,
      currentBlockNumber: 100070,
      requiredConfirmationDepth: 64,
      receipt: null,
      providerReportsFilled: true, // Provider claims filled via off-chain API
    });
    assert.equal(res.verified, false);
    assert.ok(res.error?.includes('UNVERIFIED_EVIDENCE'));
  });

  await t.test('3. Reverted Destination Transaction is Formally REJECTED', () => {
    const res = verifySettlementEvidence({
      expectedChainId: 421614,
      expectedRecipient: validRecipient,
      expectedToken: validToken,
      minimumAmount,
      currentBlockNumber: 100070,
      requiredConfirmationDepth: 64,
      receipt: { ...validReceipt, status: 'REVERTED' },
      providerReportsFilled: false,
    });
    assert.equal(res.verified, false);
    assert.ok(res.error?.includes('SETTLEMENT_REJECTED_TRANSACTION_REVERTED'));
  });

  await t.test('4. Unrelated Destination Chain ID is Formally REJECTED', () => {
    const res = verifySettlementEvidence({
      expectedChainId: 421614,
      expectedRecipient: validRecipient,
      expectedToken: validToken,
      minimumAmount,
      currentBlockNumber: 100070,
      requiredConfirmationDepth: 64,
      receipt: { ...validReceipt, chainId: 1 }, // Ethereum Mainnet receipt passed for Arbitrum
      providerReportsFilled: true,
    });
    assert.equal(res.verified, false);
    assert.ok(res.error?.includes('CHAIN_MISMATCH'));
  });

  await t.test('5. Insufficient Destination Output Amount is Formally REJECTED', () => {
    const res = verifySettlementEvidence({
      expectedChainId: 421614,
      expectedRecipient: validRecipient,
      expectedToken: validToken,
      minimumAmount: 15000000n, // 15 USDC required, but received 10 USDC
      currentBlockNumber: 100070,
      requiredConfirmationDepth: 64,
      receipt: validReceipt,
      providerReportsFilled: true,
    });
    assert.equal(res.verified, false);
    assert.ok(res.error?.includes('INSUFFICIENT_DESTINATION_AMOUNT'));
  });

  await t.test('6. Insufficient Confirmation Depth Halts Settlement in FINALITY_PENDING', () => {
    const res = verifySettlementEvidence({
      expectedChainId: 421614,
      expectedRecipient: validRecipient,
      expectedToken: validToken,
      minimumAmount,
      currentBlockNumber: 100010, // 10 confirmations < 64 required
      requiredConfirmationDepth: 64,
      receipt: validReceipt,
      providerReportsFilled: true,
    });
    assert.equal(res.verified, false);
    assert.ok(res.error?.includes('FINALITY_PENDING'));
  });

  await t.test('7. Canonical Reorg Detection Immediately Invalidates Settlement', () => {
    const res = verifySettlementEvidence({
      expectedChainId: 421614,
      expectedRecipient: validRecipient,
      expectedToken: validToken,
      minimumAmount,
      currentBlockNumber: 100070,
      requiredConfirmationDepth: 64,
      receipt: validReceipt,
      providerReportsFilled: true,
      reorgDetected: true,
    });
    assert.equal(res.verified, false);
    assert.ok(res.error?.includes('SETTLEMENT_BLOCKED_REORG_DETECTED'));
  });
});
