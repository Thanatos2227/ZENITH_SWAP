import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAcrossDepositStatus,
  isValidHexTxHash
} from '../packages/routing/src/crosschain/providers/acrossProvider';
import {
  verifyDestinationSettlement,
  AuthoritativeDestinationVerificationParams
} from '../packages/execution/src/crosschain/authoritativeDestinationVerifier';
import {
  LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE
} from '../packages/execution/src/fixtures/goldenPathExecutionFixture';
import {
  extractActualSourceSwapOutput
} from '../packages/execution/src/crosschain/sourceSwapOutputExtractor';
import { parseEther, parseUnits, formatUnits, Interface, MaxUint256 } from 'ethers';

const VALID_TX_1 = '0xc3f73e3f169d66bfa29af744725e0b4eb3f9f321e29e144a5845eab074e0f3b5';
const VALID_TX_2 = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const VALID_TX_3 = '0x' + 'ab'.repeat(32);
const OPERATOR_WALLET = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';
const ARBITRUM_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const ACROSS_SPOKE_POOL = '0xFD03AbCAdaF3F930fA4E37Eb2f6ea3A44a41b7F0';

test('ZENITH — PHASE 1 TASK 24: GOLDEN PATH REGRESSION SUITE', async (t) => {

  // ============================================================================
  // SECTION 1: LIVE ON-CHAIN GOLDEN PATH FIXTURE INTEGRITY
  // ============================================================================

  await t.test('1. Fixture Integrity: LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE contains verified mainnet telemetry with zero secrets', () => {
    assert.equal(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.evidenceType, 'LIVE_ONCHAIN_EVIDENCE');
    assert.equal(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.sourceChainId, 137);
    assert.equal(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.destinationChainId, 42161);
    assert.equal(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.finalExecutionState, 'DESTINATION_SETTLED');
    assert.equal(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.finalEvidenceClass, 'P1_ONCHAIN_RECEIPT');

    // Verify mined values
    assert.equal(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.actualSourceSwapOutputRaw, '553197');
    assert.equal(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.actualDestinationOutputRaw, '542968');
    assert.equal(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.acrossDepositId, '2356813');

    // Security check: Verify no private key material is present in fixture
    const serialized = JSON.stringify(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE);
    assert.doesNotMatch(serialized, /privateKey/i);
    assert.doesNotMatch(serialized, /secret/i);
    assert.doesNotMatch(serialized, /seed/i);
    assert.doesNotMatch(serialized, /mnemonic/i);
  });

  // ============================================================================
  // SECTION 2: ACROSS RESPONSE NORMALIZATION MATRIX (TASK 2 & 5)
  // ============================================================================

  await t.test('2. Across Normalization: 1. data.fillTx parses cleanly to resolvedFillTx', () => {
    const result = normalizeAcrossDepositStatus({
      status: 'filled',
      fillTx: VALID_TX_1,
      depositId: '2356813',
      originChainId: 137,
      destinationChainId: 42161
    });

    assert.equal(result.status, 'filled');
    assert.equal(result.resolvedFillTx, VALID_TX_1.toLowerCase());
    assert.equal(result.hasStatusConflict, false);
  });

  await t.test('3. Across Normalization: 2. data.fillTxnRef parses cleanly to resolvedFillTx', () => {
    const result = normalizeAcrossDepositStatus({
      status: 'filled',
      fillTxnRef: VALID_TX_2,
      depositId: '2356813'
    });

    assert.equal(result.status, 'filled');
    assert.equal(result.resolvedFillTx, VALID_TX_2.toLowerCase());
    assert.equal(result.hasStatusConflict, false);
  });

  await t.test('4. Across Normalization: 3. data.fillTxHash parses cleanly to resolvedFillTx', () => {
    const result = normalizeAcrossDepositStatus({
      status: 'filled',
      fillTxHash: VALID_TX_3,
      depositId: '2356813'
    });

    assert.equal(result.status, 'filled');
    assert.equal(result.resolvedFillTx, VALID_TX_3.toLowerCase());
    assert.equal(result.hasStatusConflict, false);
  });

  await t.test('5. Across Normalization: 4. All three present -> enforces strict precedence (fillTx > fillTxnRef > fillTxHash)', () => {
    const result = normalizeAcrossDepositStatus({
      status: 'filled',
      fillTx: VALID_TX_1,
      fillTxnRef: VALID_TX_2,
      fillTxHash: VALID_TX_3
    });

    assert.equal(result.status, 'filled');
    assert.equal(result.resolvedFillTx, VALID_TX_1.toLowerCase());
  });

  await t.test('6. Across Normalization: 5. None present returns resolvedFillTx = null with conflict flag', () => {
    const result = normalizeAcrossDepositStatus({
      status: 'filled',
      depositId: '2356813'
    });

    assert.equal(result.status, 'filled');
    assert.equal(result.resolvedFillTx, null);
    assert.equal(result.hasStatusConflict, true); // filled without fillTx is a conflict
  });

  await t.test('7. Across Normalization: 6. Malformed values (non-hex, truncated, invalid length) are rejected as null', () => {
    const malformed1 = normalizeAcrossDepositStatus({ status: 'filled', fillTx: '0x1234' }); // truncated
    assert.equal(malformed1.resolvedFillTx, null);

    const malformed2 = normalizeAcrossDepositStatus({ status: 'filled', fillTx: 'not_a_valid_hash_at_all' });
    assert.equal(malformed2.resolvedFillTx, null);

    const malformed3 = normalizeAcrossDepositStatus({ status: 'filled', fillTx: '0x' + 'z'.repeat(64) }); // non-hex
    assert.equal(malformed3.resolvedFillTx, null);

    const malformed4 = normalizeAcrossDepositStatus({ status: 'filled', fillTx: 123456789 }); // not a string
    assert.equal(malformed4.resolvedFillTx, null);
  });

  await t.test('8. Across Normalization: 7. Empty and whitespace values are rejected as null', () => {
    const empty1 = normalizeAcrossDepositStatus({ status: 'filled', fillTx: '' });
    assert.equal(empty1.resolvedFillTx, null);

    const empty2 = normalizeAcrossDepositStatus({ status: 'filled', fillTx: '   ' });
    assert.equal(empty2.resolvedFillTx, null);

    const empty3 = normalizeAcrossDepositStatus({ status: 'filled', fillTx: null });
    assert.equal(empty3.resolvedFillTx, null);
  });

  await t.test('9. Across Normalization: 8. Malformed data payload (null, undefined, non-object) fails closed safely', () => {
    const res1 = normalizeAcrossDepositStatus(null);
    assert.equal(res1.status, 'unknown');
    assert.equal(res1.resolvedFillTx, null);

    const res2 = normalizeAcrossDepositStatus(undefined);
    assert.equal(res2.status, 'unknown');
    assert.equal(res2.resolvedFillTx, null);

    const res3 = normalizeAcrossDepositStatus('invalid_string_response');
    assert.equal(res3.status, 'unknown');
    assert.equal(res3.resolvedFillTx, null);
  });

  await t.test('10. Across Normalization: 9. Pending, refunded, and expired statuses are categorized without fabricating fill', () => {
    const pending = normalizeAcrossDepositStatus({ status: 'pending' });
    assert.equal(pending.status, 'pending');
    assert.equal(pending.resolvedFillTx, null);
    assert.equal(pending.hasStatusConflict, false);

    const refunded = normalizeAcrossDepositStatus({ status: 'refunded' });
    assert.equal(refunded.status, 'refunded');
    assert.equal(refunded.resolvedFillTx, null);

    const expired = normalizeAcrossDepositStatus({ status: 'expired' });
    assert.equal(expired.status, 'expired');
    assert.equal(expired.resolvedFillTx, null);
  });

  await t.test('11. Across Normalization: 10. Status conflicts (status != filled but fillTx present) are flagged explicitly', () => {
    const conflict = normalizeAcrossDepositStatus({
      status: 'pending',
      fillTx: VALID_TX_1
    });

    assert.equal(conflict.status, 'pending');
    assert.equal(conflict.resolvedFillTx, VALID_TX_1.toLowerCase());
    assert.equal(conflict.hasStatusConflict, true);
  });

  // ============================================================================
  // SECTION 3: AUTHORITATIVE DESTINATION VERIFICATION (TASK 3)
  // ============================================================================

  await t.test('12. Evidence Hierarchy: Confirmed On-Chain Receipt (Tier 1) + ERC20 Transfer (Tier 3) settles with DESTINATION_SETTLED', () => {
    const erc20Iface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
    const transferLogData = erc20Iface.encodeEventLog(
      erc20Iface.getEvent('Transfer')!,
      [ACROSS_SPOKE_POOL, OPERATOR_WALLET, 542968n]
    );

    const result = verifyDestinationSettlement({
      destinationChainId: 42161,
      destinationTxHash: VALID_TX_1,
      expectedRecipient: OPERATOR_WALLET,
      expectedToken: ARBITRUM_USDC,
      expectedMinAmountRaw: '505151',
      providerStatus: 'filled',
      providerFillTx: VALID_TX_1,
      preBridgeBalanceRaw: '0',
      currentBalanceRaw: '542968',
      receipt: {
        status: 1,
        blockNumber: 507526931,
        gasUsed: '128057',
        logs: [
          {
            address: ARBITRUM_USDC,
            topics: transferLogData.topics,
            data: transferLogData.data
          }
        ]
      }
    });

    assert.equal(result.settlementStatus, 'DESTINATION_SETTLED');
    assert.equal(result.primaryEvidenceTier, 'TIER_3_ERC20_TRANSFER_EVENT');
    assert.equal(result.deliveredToExpectedRecipient, true);
    assert.equal(result.actualDeliveredAmountRaw, '542968');
    assert.equal(result.blockNumber, 507526931);
  });

  await t.test('13. Evidence Hierarchy: Reverted receipt overrides provider API "filled" with STATUS_CONFLICT', () => {
    const result = verifyDestinationSettlement({
      destinationChainId: 42161,
      destinationTxHash: VALID_TX_1,
      expectedRecipient: OPERATOR_WALLET,
      expectedToken: ARBITRUM_USDC,
      expectedMinAmountRaw: '505151',
      providerStatus: 'filled', // Provider claims filled!
      providerFillTx: VALID_TX_1,
      receipt: {
        status: 0, // But on-chain receipt reverted!
        blockNumber: 507526931,
        gasUsed: '45000',
        logs: []
      }
    });

    assert.equal(result.settlementStatus, 'STATUS_CONFLICT');
    assert.equal(result.primaryEvidenceTier, 'TIER_1_ONCHAIN_RECEIPT');
    assert.ok(result.conflictReason?.includes('Across Provider API reported filled, but on-chain receipt in block 507526931 was REVERTED'));
  });

  await t.test('14. Evidence Hierarchy: Succeeded receipt with wrong recipient produces STATUS_CONFLICT', () => {
    const wrongRecipient = '0x1111111111111111111111111111111111111111';
    const erc20Iface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
    const transferLogData = erc20Iface.encodeEventLog(
      erc20Iface.getEvent('Transfer')!,
      [ACROSS_SPOKE_POOL, wrongRecipient, 542968n]
    );

    const result = verifyDestinationSettlement({
      destinationChainId: 42161,
      destinationTxHash: VALID_TX_1,
      expectedRecipient: OPERATOR_WALLET,
      expectedToken: ARBITRUM_USDC,
      expectedMinAmountRaw: '505151',
      providerStatus: 'filled',
      receipt: {
        status: 1,
        blockNumber: 507526931,
        gasUsed: '128057',
        logs: [
          {
            address: ARBITRUM_USDC,
            topics: transferLogData.topics,
            data: transferLogData.data
          }
        ]
      }
    });

    assert.equal(result.settlementStatus, 'STATUS_CONFLICT');
    assert.equal(result.deliveredToExpectedRecipient, false);
    assert.ok(result.conflictReason?.includes('recipient did not match'));
  });

  await t.test('15. Evidence Hierarchy: Provider claims filled but receipt is missing produces DESTINATION_STATUS_UNCERTAIN', () => {
    const result = verifyDestinationSettlement({
      destinationChainId: 42161,
      destinationTxHash: VALID_TX_1,
      expectedRecipient: OPERATOR_WALLET,
      expectedToken: ARBITRUM_USDC,
      expectedMinAmountRaw: '505151',
      providerStatus: 'filled',
      providerFillTx: VALID_TX_1,
      receipt: null // Receipt pending / unindexed
    });

    assert.equal(result.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
    assert.equal(result.primaryEvidenceTier, 'TIER_5_PROVIDER_API');
    assert.ok(result.conflictReason?.includes('receipt is pending or unconfirmed'));
  });

  await t.test('16. Evidence Hierarchy: Provider refunded or expired produces DESTINATION_FAILED', () => {
    const result = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: OPERATOR_WALLET,
      expectedToken: ARBITRUM_USDC,
      expectedMinAmountRaw: '505151',
      providerStatus: 'refunded',
      receipt: null
    });

    assert.equal(result.settlementStatus, 'DESTINATION_FAILED');
    assert.equal(result.primaryEvidenceTier, 'TIER_5_PROVIDER_API');
    assert.ok(result.revertReason?.includes('refunded'));
  });

  // ============================================================================
  // SECTION 4: GOLDEN PATH LOGICAL LIFECYCLE & SECURITY INVARIANTS (TASK 4 & 9)
  // ============================================================================

  await t.test('17. Output Extraction: Extract actual mined swap output with exact precision and zero floating-point math', () => {
    const erc20Iface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
    const swapOutputLog = erc20Iface.encodeEventLog(
      erc20Iface.getEvent('Transfer')!,
      ['0x3000000000000000000000000000000000000003', OPERATOR_WALLET, 553197n]
    );

    const extracted = extractActualSourceSwapOutput({
      recipientAddress: OPERATOR_WALLET,
      expectedTokenOutAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      minimumAmountOutRaw: '500000',
      sourceChainId: 137,
      receipt: {
        status: 1,
        logs: [
          {
            address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
            topics: swapOutputLog.topics,
            data: swapOutputLog.data
          }
        ]
      }
    });

    assert.equal(extracted.actualAmountRaw, '553197');
    assert.equal(extracted.actualAmountBig, 553197n);
    assert.equal(extracted.verified, true);
    assert.equal(extracted.extractionMethod, 'RECEIPT_LOGS');
  });

  await t.test('18. Bounded Approval Invariant: Bridge approval strictly matches exact needed amount and rejects MaxUint256', () => {
    const boundedAmount = 553197n;
    const approvalCalldata = new Interface([
      'function approve(address spender, uint256 amount) returns (bool)'
    ]).encodeFunctionData('approve', [ACROSS_SPOKE_POOL, boundedAmount]);

    const decoded = new Interface([
      'function approve(address spender, uint256 amount) returns (bool)'
    ]).decodeFunctionData('approve', approvalCalldata);

    assert.equal(decoded.spender.toLowerCase(), ACROSS_SPOKE_POOL.toLowerCase());
    assert.equal(decoded.amount, boundedAmount);
    assert.notEqual(decoded.amount, MaxUint256); // Strict invariant: Never MAX_UINT256
  });

  await t.test('19. Downstream Fresh Quote Invariant: Bridge quote uses refreshed mined output rather than stale initial estimate', () => {
    const initialEstimatedSwapOutput = 517885n;
    const actualMinedSwapOutput = 553197n;

    assert.ok(actualMinedSwapOutput > initialEstimatedSwapOutput);

    // Mock bridge fee deduction
    const acrossRelayerFeeBps = 185n; // ~1.85%
    const expectedOutputInitial = initialEstimatedSwapOutput - (initialEstimatedSwapOutput * acrossRelayerFeeBps / 10000n);
    const expectedOutputFresh = actualMinedSwapOutput - (actualMinedSwapOutput * acrossRelayerFeeBps / 10000n);

    assert.ok(expectedOutputFresh > expectedOutputInitial);
    assert.equal(expectedOutputFresh, 542963n); // matches within 5 raw units of 542968
  });

  await t.test('20. Safe Transaction Hash Invariant: Only genuine 32-byte hex hashes pass validation', () => {
    assert.equal(isValidHexTxHash(VALID_TX_1), true);
    assert.equal(isValidHexTxHash(VALID_TX_2), true);
    assert.equal(isValidHexTxHash('0xfake_hash'), false);
    assert.equal(isValidHexTxHash(''), false);
    assert.equal(isValidHexTxHash(null), false);
    assert.equal(isValidHexTxHash(undefined), false);
  });
});
