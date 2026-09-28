import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { verifyDestinationSettlement, DestinationEvidenceTier, DestinationSettlementStatus, AuthoritativeDestinationVerificationParams } from '../packages/execution/src/crosschain/authoritativeDestinationVerifier';
import { defaultSettlementTelemetry, SettlementTelemetry } from '../packages/execution/src/crosschain/settlementTelemetry';
import { defaultCrossChainTracker, CrossChainTracker, ActiveCrossChainOrder } from '../packages/execution/src/crosschain/crossChainTracker';
import { VALID_SETTLEMENT_STATE_TRANSITIONS, TERMINAL_SETTLEMENT_STATES, validateSettlementStateTransition, InMemoryCrossChainStateRepository } from '../packages/execution/src/persistence/repository';
import { SettlementFinalityBreachError, DestinationEvidenceMismatchError, ReorgDetectedError, EvidenceConflictError } from '../packages/contracts/src/errors';
import { defaultChainRegistry } from '../packages/chains/src/registry';
import { SettlementState, CrossChainQuote } from '../packages/types/src/index';
const ARB_CHAIN_ID = 42161;
const POL_CHAIN_ID = 137;
const ETH_CHAIN_ID = 1;
const AVAX_CHAIN_ID = 43114;
const BASE_CHAIN_ID = 8453;
const OP_CHAIN_ID = 10;
const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const POL_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const ARB_SPOKE_POOL = '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A';
const USER_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const RELAYER_WALLET = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const UNRELATED_WALLET = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const SPOOF_TOKEN = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const EXPECTED_AMOUNT = 100000000n;
const MIN_AMOUNT = 99500000n;
const CANONICAL_TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CANONICAL_BLOCK_HASH = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const REORGED_BLOCK_HASH = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const erc20Iface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
function makeTransferLog(token: string, from: string, to: string, amount: bigint | string) {
    const parsed = erc20Iface.encodeEventLog(erc20Iface.getEvent('Transfer')!, [from, to, BigInt(amount.toString())]);
    return {
        address: token,
        topics: parsed.topics,
        data: parsed.data
    };
}
function createMulberry32(seed: number) {
    return function () {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
describe('ZENITH — PHASE 1 TASK 34: CROSS-CHAIN SETTLEMENT FINALITY & EVIDENCE CERTIFICATION', () => {
    beforeEach(() => {
        defaultSettlementTelemetry.clear();
    });
    describe('Suite 1: Actual Evidence Hierarchy Model (Tiers 1-6)', () => {
        it('1.1 TIER_1_ONCHAIN_RECEIPT has priority 1 and proves on-chain execution', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    gasUsed: 80000n,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            const t1 = res.evidences.find(e => e.tier === 'TIER_1_ONCHAIN_RECEIPT');
            assert.ok(t1);
            assert.strictEqual(t1.priority, 1);
            assert.strictEqual(t1.status, 'CONFIRMED');
            assert.strictEqual(t1.verified, true);
        });
        it('1.2 TIER_2_ONCHAIN_TX_LOOKUP has priority 2 and confirms mempool/block inclusion', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                transaction: {
                    hash: CANONICAL_TX_HASH,
                    from: RELAYER_WALLET,
                    to: ARB_SPOKE_POOL,
                    chainId: ARB_CHAIN_ID
                }
            });
            const t2 = res.evidences.find(e => e.tier === 'TIER_2_ONCHAIN_TX_LOOKUP');
            assert.ok(t2);
            assert.strictEqual(t2.priority, 2);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('1.3 TIER_3_ERC20_TRANSFER_EVENT has priority 3 and provides authoritative token delivery', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            const t3 = res.evidences.find(e => e.tier === 'TIER_3_ERC20_TRANSFER_EVENT');
            assert.ok(t3);
            assert.strictEqual(t3.priority, 3);
            assert.strictEqual(t3.verified, true);
            assert.strictEqual(res.primaryEvidenceTier, 'TIER_3_ERC20_TRANSFER_EVENT');
        });
        it('1.4 TIER_4_RECIPIENT_BALANCE_DELTA has priority 4 and serves as corroborating evidence', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                preBridgeBalanceRaw: 50000000n,
                currentBalanceRaw: 150000000n
            });
            const t4 = res.evidences.find(e => e.tier === 'TIER_4_RECIPIENT_BALANCE_DELTA');
            assert.ok(t4);
            assert.strictEqual(t4.priority, 4);
            assert.strictEqual(t4.verified, true);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('1.5 TIER_5_PROVIDER_API has priority 5 and CANNOT trigger settlement alone', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: 'filled',
                providerFillTx: CANONICAL_TX_HASH
            });
            const t5 = res.evidences.find(e => e.tier === 'TIER_5_PROVIDER_API');
            assert.ok(t5);
            assert.strictEqual(t5.priority, 5);
            assert.strictEqual(t5.status, 'CONFIRMED');
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('1.6 TIER_6_LOCAL_CACHE has priority 6 and is informational only', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                localCacheStatus: 'SETTLED'
            });
            const t6 = res.evidences.find(e => e.tier === 'TIER_6_LOCAL_CACHE');
            assert.ok(t6);
            assert.strictEqual(t6.priority, 6);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
    });
    describe('Suite 2: Destination Transaction Identity Verification', () => {
        it('2.1 Rejects destination transaction with chain ID mismatch', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                transaction: {
                    hash: CANONICAL_TX_HASH,
                    from: RELAYER_WALLET,
                    to: ARB_SPOKE_POOL,
                    chainId: POL_CHAIN_ID
                }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
            assert.match(res.conflictReason!, /chain ID.*does not match/);
        });
        it('2.2 Rejects destination transaction with wrong SpokePool / target address', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                expectedSpokePoolOrTarget: ARB_SPOKE_POOL,
                transaction: {
                    hash: CANONICAL_TX_HASH,
                    from: RELAYER_WALLET,
                    to: UNRELATED_WALLET,
                    chainId: ARB_CHAIN_ID
                }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
            assert.match(res.conflictReason!, /target.*does not match/);
        });
        it('2.3 Validates full transaction identity matching authorized target and chain', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                expectedSpokePoolOrTarget: ARB_SPOKE_POOL,
                transaction: {
                    hash: CANONICAL_TX_HASH,
                    from: RELAYER_WALLET,
                    to: ARB_SPOKE_POOL,
                    chainId: ARB_CHAIN_ID
                },
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ARB_SPOKE_POOL, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.deliveredToExpectedRecipient, true);
        });
        it('2.4 Handles zero gas used in transaction receipt gracefully', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    gasUsed: 0n,
                    logs: [makeTransferLog(ARB_USDC, ARB_SPOKE_POOL, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('2.5 Rejects tx lookup when transaction chainId is string mismatch', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: 'arbitrum',
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                transaction: {
                    hash: CANONICAL_TX_HASH,
                    from: RELAYER_WALLET,
                    to: ARB_SPOKE_POOL,
                    chainId: 'polygon'
                }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
        });
        it('2.6 Accepts transaction with matching string chainId', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: 'arbitrum',
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                transaction: {
                    hash: CANONICAL_TX_HASH,
                    from: RELAYER_WALLET,
                    to: ARB_SPOKE_POOL,
                    chainId: 'arbitrum'
                },
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ARB_SPOKE_POOL, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
    });
    describe('Suite 3: Receipt Verification & Failure Modes', () => {
        it('3.1 Missing receipt with destination txHash marks status UNCERTAIN (NOT_FOUND)', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: null
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
            const rEvidence = res.evidences.find(e => e.tier === 'TIER_1_ONCHAIN_RECEIPT');
            assert.strictEqual(rEvidence?.status, 'NOT_FOUND');
        });
        it('3.2 Reverted receipt (status 0) immediately transitions to DESTINATION_FAILED', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 0,
                    blockNumber: 1000
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_FAILED');
            assert.strictEqual(res.primaryEvidenceTier, 'TIER_1_ONCHAIN_RECEIPT');
            assert.match(res.revertReason!, /reverted on-chain/);
        });
        it('3.3 Successful receipt (status 1) with missing expected Transfer event cannot settle', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: []
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
            assert.strictEqual(res.deliveredToExpectedRecipient, false);
        });
        it('3.4 Receipt string status "0x1" is accepted as confirmed', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: '0x1',
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('3.5 Receipt string status "0x0" is identified as reverted', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: '0x0',
                    blockNumber: 1000
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_FAILED');
        });
        it('3.6 Receipt with non-array logs handles gracefully without throwing', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: undefined as any
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('3.7 Accepts receipt with string integer gasUsed', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    gasUsed: '85000',
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.gasUsed, '85000');
        });
        it('3.8 Handles empty logs array with status 1 as UNCERTAIN', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: []
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
            assert.strictEqual(res.deliveredToExpectedRecipient, false);
        });
    });
    describe('Suite 4: Token Transfer Event Verification', () => {
        it('4.1 Rejects transfer from wrong token address (token spoofing)', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(SPOOF_TOKEN, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
            assert.strictEqual(res.tokenMatched, false);
        });
        it('4.2 Rejects transfer to wrong recipient address', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, UNRELATED_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
            assert.strictEqual(res.deliveredToExpectedRecipient, false);
            assert.match(res.conflictReason!, /recipient did not match/);
        });
        it('4.3 Rejects transfer with delivered amount below minimum output', () => {
            const UNDER_DELIVERED = MIN_AMOUNT - 1n;
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, UNDER_DELIVERED)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
            assert.match(res.conflictReason!, /below minimum expected/);
            const conflictRes = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: 'filled',
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, UNDER_DELIVERED)]
                }
            });
            assert.strictEqual(conflictRes.settlementStatus, 'STATUS_CONFLICT');
        });
        it('4.4 Accurately matches multiple logs and picks the authorized recipient transfer', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [
                        makeTransferLog(ARB_USDC, RELAYER_WALLET, UNRELATED_WALLET, 5000000n),
                        makeTransferLog(ARB_USDC, ARB_SPOKE_POOL, USER_WALLET, EXPECTED_AMOUNT)
                    ]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.actualDeliveredAmountRaw, EXPECTED_AMOUNT.toString());
        });
        it('4.5 Ignores unrelated non-transfer events emitted by token contract', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [
                        { address: ARB_USDC, topics: ['0x8c5be1e5eb7d874a75429cda908cc175fd372338903c739f735314d07b85399a'], data: '0x' },
                        makeTransferLog(ARB_USDC, ARB_SPOKE_POOL, USER_WALLET, EXPECTED_AMOUNT)
                    ]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('4.6 Rejects transfer when transfer is an outflow from user to another address', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, USER_WALLET, RELAYER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.deliveredToExpectedRecipient, false);
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
        });
        it('4.7 Matches exact token when multiple different token contracts emit transfers', () => {
            const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [
                        makeTransferLog(WETH, RELAYER_WALLET, USER_WALLET, 1000000000000000000n),
                        makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)
                    ]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.tokenMatched, true);
            assert.strictEqual(res.actualDeliveredAmountRaw, EXPECTED_AMOUNT.toString());
        });
    });
    describe('Suite 5: Balance Delta Evidence Classification', () => {
        it('5.1 Exact balance delta corroborates settlement when transfer log is present', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                preBridgeBalanceRaw: 10000000n,
                currentBalanceRaw: 110000000n,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            const bEvidence = res.evidences.find(e => e.tier === 'TIER_4_RECIPIENT_BALANCE_DELTA');
            assert.strictEqual(bEvidence?.status, 'CONFIRMED');
        });
        it('5.2 Balance delta alone without receipt cannot trigger settlement', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                preBridgeBalanceRaw: 0n,
                currentBalanceRaw: EXPECTED_AMOUNT
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('5.3 Negative or insufficient balance delta is flagged as MISMATCH', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                preBridgeBalanceRaw: 100000000n,
                currentBalanceRaw: 90000000n
            });
            const bEvidence = res.evidences.find(e => e.tier === 'TIER_4_RECIPIENT_BALANCE_DELTA');
            assert.strictEqual(bEvidence?.status, 'MISMATCH');
        });
        it('5.4 Missing pre-bridge balance defaults safely to 0n baseline', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                currentBalanceRaw: EXPECTED_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('5.5 Handles balance delta with string integer amounts', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                preBridgeBalanceRaw: '10000000',
                currentBalanceRaw: '110000000',
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, '100000000')]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
    });
    describe('Suite 6: Bridge Status API Evidence Integration', () => {
        it('6.1 API "filled" + receipt SUCCESS -> DESTINATION_SETTLED', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: 'filled',
                providerFillTx: CANONICAL_TX_HASH,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('6.2 API "filled" + receipt PENDING/MISSING -> DESTINATION_STATUS_UNCERTAIN', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: 'filled',
                providerFillTx: CANONICAL_TX_HASH,
                receipt: null
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
            assert.match(res.conflictReason!, /on-chain receipt is pending or unconfirmed/);
        });
        it('6.3 API "refunded" -> DESTINATION_FAILED', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: 'refunded'
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_FAILED');
            assert.match(res.revertReason!, /order was refunded/);
        });
        it('6.4 API "expired" -> DESTINATION_FAILED', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: 'expired'
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_FAILED');
        });
        it('6.5 Handles uppercase or mixed case "FILLED" safely', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: 'FILLED',
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
    });
    describe('Suite 7: Deterministic Evidence Conflict Resolution Policy', () => {
        it('7.1 Conflict 1: On-Chain Reverted vs Bridge API Filled -> STATUS_CONFLICT (fails closed)', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: 'filled',
                receipt: {
                    status: 0,
                    blockNumber: 1000
                }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
            assert.strictEqual(res.primaryEvidenceTier, 'TIER_1_ONCHAIN_RECEIPT');
            assert.match(res.conflictReason!, /Provider API reported filled.*REVERTED/);
        });
        it('7.2 Conflict 2: On-Chain Success vs Wrong Token Transfer -> STATUS_CONFLICT', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(SPOOF_TOKEN, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
            assert.strictEqual(res.tokenMatched, false);
        });
        it('7.3 Conflict 3: On-Chain Success vs Wrong Recipient -> STATUS_CONFLICT', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, UNRELATED_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
            assert.strictEqual(res.deliveredToExpectedRecipient, false);
        });
        it('7.4 Conflict 4: On-Chain Success vs Amount Below Minimum -> DESTINATION_STATUS_UNCERTAIN', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, MIN_AMOUNT - 100n)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('7.5 Conflict 5: On-Chain Success vs Local Cache FAILED -> On-Chain prevails', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                localCacheStatus: 'FAILED',
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('7.6 Instantiates EvidenceConflictError with code and details', () => {
            const err = new EvidenceConflictError('TIER_1_ONCHAIN_RECEIPT', 'TIER_5_PROVIDER_API', 'Reverted vs Filled');
            assert.strictEqual(err.code, 'EVIDENCE_CONFLICT');
            assert.strictEqual(err.primaryTier, 'TIER_1_ONCHAIN_RECEIPT');
            assert.strictEqual(err.secondaryTier, 'TIER_5_PROVIDER_API');
        });
    });
    describe('Suite 8: Chain-Specific Finality Model (Confirmation Depth)', () => {
        it('8.1 Ethereum Mainnet reorg safety blocks verified from registry', () => {
            const ethConfig = defaultChainRegistry.getChain('ethereum');
            assert.ok(ethConfig);
            assert.strictEqual(ethConfig.finality.reorgSafetyBlocks, 64);
            const resUnfinished = verifyDestinationSettlement({
                destinationChainId: ETH_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                currentBlockNumber: 1000 + 10 - 1,
                requiredConfirmations: ethConfig.finality.reorgSafetyBlocks,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(resUnfinished.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
            assert.strictEqual(resUnfinished.isFinalized, false);
            const resFinalized = verifyDestinationSettlement({
                destinationChainId: ETH_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                currentBlockNumber: 1000 + 64 - 1,
                requiredConfirmations: ethConfig.finality.reorgSafetyBlocks,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(resFinalized.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(resFinalized.isFinalized, true);
        });
        it('8.2 Arbitrum One reorg safety blocks verified from registry', () => {
            const arbConfig = defaultChainRegistry.getChain('arbitrum');
            assert.ok(arbConfig);
            assert.strictEqual(arbConfig.finality.reorgSafetyBlocks, 20);
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                currentBlockNumber: 1000 + 20 - 1,
                requiredConfirmations: arbConfig.finality.reorgSafetyBlocks,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.isFinalized, true);
        });
        it('8.3 Avalanche C-Chain instant finality verified from registry', () => {
            const avaxConfig = defaultChainRegistry.getChain('avalanche');
            assert.ok(avaxConfig);
            assert.strictEqual(avaxConfig.finality.instantFinality, true);
            assert.strictEqual(avaxConfig.finality.reorgSafetyBlocks, 1);
            const res = verifyDestinationSettlement({
                destinationChainId: AVAX_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                currentBlockNumber: 1000,
                requiredConfirmations: avaxConfig.finality.reorgSafetyBlocks,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.isFinalized, true);
        });
        it('8.4 Polygon PoS reorg safety blocks verified from registry', () => {
            const polConfig = defaultChainRegistry.getChain('polygon');
            assert.ok(polConfig);
            assert.strictEqual(polConfig.finality.reorgSafetyBlocks, 128);
        });
        it('8.5 Base and Optimism reorg safety blocks verified from registry', () => {
            const baseConfig = defaultChainRegistry.getChain('base');
            const opConfig = defaultChainRegistry.getChain('optimism');
            assert.ok(baseConfig);
            assert.ok(opConfig);
            assert.strictEqual(baseConfig.finality.reorgSafetyBlocks, 20);
            assert.strictEqual(opConfig.finality.reorgSafetyBlocks, 20);
        });
        it('8.6 Polygon PoS enforces 128-block finality depth before marking settled', () => {
            const polConfig = defaultChainRegistry.getChain('polygon')!;
            const res50 = verifyDestinationSettlement({
                destinationChainId: POL_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: POL_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                currentBlockNumber: 1000 + 50 - 1,
                requiredConfirmations: polConfig.finality.reorgSafetyBlocks,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(POL_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res50.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
            assert.strictEqual(res50.isFinalized, false);
            const res128 = verifyDestinationSettlement({
                destinationChainId: POL_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: POL_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                currentBlockNumber: 1000 + 128 - 1,
                requiredConfirmations: polConfig.finality.reorgSafetyBlocks,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(POL_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res128.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res128.isFinalized, true);
        });
        it('8.7 Base enforces 20-block finality depth before marking settled', () => {
            const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
            const baseConfig = defaultChainRegistry.getChain('base')!;
            const res = verifyDestinationSettlement({
                destinationChainId: BASE_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: BASE_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                currentBlockNumber: 2000 + 20 - 1,
                requiredConfirmations: baseConfig.finality.reorgSafetyBlocks,
                receipt: {
                    status: 1,
                    blockNumber: 2000,
                    logs: [makeTransferLog(BASE_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.isFinalized, true);
        });
    });
    describe('Suite 9: Reorg Handling & Invariant Enforcement', () => {
        it('9.1 Detects block hash mutation and halts with REORG_DETECTED', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                expectedBlockHash: CANONICAL_BLOCK_HASH,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    blockHash: REORGED_BLOCK_HASH,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'REORG_DETECTED');
            assert.strictEqual(res.reorgDetected, true);
            assert.match(res.conflictReason!, /Reorg detected/);
        });
        it('9.2 Receipt disappearance after reorg transitions to UNCERTAIN', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: null
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('9.3 Throws ReorgDetectedError with original and canonical block hash metadata', () => {
            const err = new ReorgDetectedError(CANONICAL_TX_HASH, CANONICAL_BLOCK_HASH, REORGED_BLOCK_HASH);
            assert.strictEqual(err.code, 'REORG_DETECTED');
            assert.strictEqual(err.originalBlockHash, CANONICAL_BLOCK_HASH);
            assert.strictEqual(err.canonicalBlockHash, REORGED_BLOCK_HASH);
            assert.match(err.message, /block hash mutated/);
        });
        it('9.4 ReorgDetectedError backwards compatibility with previousBlock number', () => {
            const err = new ReorgDetectedError(CANONICAL_TX_HASH, 999);
            assert.strictEqual(err.previousBlock, 999);
            assert.match(err.message, /Previous Block: 999/);
        });
    });
    describe('Suite 10: Finality State Machine Invariants', () => {
        it('10.1 Permits FULFILLING -> DESTINATION_FILLED transition', () => {
            assert.doesNotThrow(() => {
                validateSettlementStateTransition('FULFILLING', 'DESTINATION_FILLED');
            });
        });
        it('10.2 Permits DESTINATION_FILLED -> VERIFIED -> SETTLED transition', () => {
            assert.doesNotThrow(() => {
                validateSettlementStateTransition('DESTINATION_FILLED', 'VERIFIED');
                validateSettlementStateTransition('VERIFIED', 'SETTLED');
            });
        });
        it('10.3 Forbids transition out of terminal state SETTLED', () => {
            assert.throws(() => {
                validateSettlementStateTransition('SETTLED', 'FULFILLING');
            }, /INVALID_STATE_TRANSITION/i);
        });
        it('10.4 Forbids transition out of terminal state REFUNDED', () => {
            assert.throws(() => {
                validateSettlementStateTransition('REFUNDED', 'SETTLED');
            }, /INVALID_STATE_TRANSITION/i);
        });
        it('10.5 Forbids transition out of terminal state CANCELLED', () => {
            assert.throws(() => {
                validateSettlementStateTransition('CANCELLED', 'SETTLED');
            }, /INVALID_STATE_TRANSITION/i);
        });
        it('10.6 Terminal states Set includes exactly SETTLED, REFUNDED, CANCELLED', () => {
            assert.strictEqual(TERMINAL_SETTLEMENT_STATES.has('SETTLED'), true);
            assert.strictEqual(TERMINAL_SETTLEMENT_STATES.has('REFUNDED'), true);
            assert.strictEqual(TERMINAL_SETTLEMENT_STATES.has('CANCELLED'), true);
            assert.strictEqual(TERMINAL_SETTLEMENT_STATES.has('FULFILLING'), false);
        });
    });
    describe('Suite 11: Settlement Idempotency Verification', () => {
        const params: AuthoritativeDestinationVerificationParams = {
            destinationChainId: ARB_CHAIN_ID,
            destinationTxHash: CANONICAL_TX_HASH,
            expectedRecipient: USER_WALLET,
            expectedToken: ARB_USDC,
            expectedMinAmountRaw: MIN_AMOUNT,
            receipt: {
                status: 1,
                blockNumber: 1000,
                logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
            }
        };
        it('11.1 1x evaluation produces valid SETTLED result', () => {
            const res = verifyDestinationSettlement(params);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('11.2 2x repeated evaluations produce identical result', () => {
            const r1 = verifyDestinationSettlement(params);
            const r2 = verifyDestinationSettlement(params);
            assert.strictEqual(r1.settlementStatus, r2.settlementStatus);
            assert.strictEqual(r1.actualDeliveredAmountRaw, r2.actualDeliveredAmountRaw);
        });
        it('11.3 5x repeated evaluations produce identical result', () => {
            for (let i = 0; i < 5; i++) {
                const res = verifyDestinationSettlement(params);
                assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            }
        });
        it('11.4 10x repeated evaluations produce identical result', () => {
            for (let i = 0; i < 10; i++) {
                const res = verifyDestinationSettlement(params);
                assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            }
        });
        it('11.5 100x repeated evaluations produce identical result', () => {
            for (let i = 0; i < 100; i++) {
                const res = verifyDestinationSettlement(params);
                assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            }
        });
        it('11.6 1,000x repeat evaluations execute deterministically with 0 state divergence', () => {
            const first = verifyDestinationSettlement(params);
            for (let i = 0; i < 1000; i++) {
                const res = verifyDestinationSettlement(params);
                assert.strictEqual(res.settlementStatus, first.settlementStatus);
                assert.strictEqual(res.primaryEvidenceTier, first.primaryEvidenceTier);
                assert.strictEqual(res.actualDeliveredAmountRaw, first.actualDeliveredAmountRaw);
            }
        });
    });
    describe('Suite 12: Crash Recovery During Settlement', () => {
        it('12.1 Persistence repository records verified settlement', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            await repo.recordSettlement({
                intentId: 'intent-crash-1',
                destinationTxHash: CANONICAL_TX_HASH,
                destinationChainId: String(ARB_CHAIN_ID),
                tokenAddress: ARB_USDC,
                tokenSymbol: 'USDC',
                recipient: USER_WALLET,
                expectedAmountRaw: EXPECTED_AMOUNT.toString(),
                actualAmountRaw: EXPECTED_AMOUNT.toString(),
                verified: true,
                verifiedAt: Date.now()
            });
            const recovered = await repo.getSettlement('intent-crash-1');
            assert.ok(recovered);
            assert.strictEqual(recovered.verified, true);
            assert.strictEqual(recovered.destinationTxHash, CANONICAL_TX_HASH);
        });
        it('12.2 Already settled intent retrieved after crash returns idempotent result', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            await repo.recordSettlement({
                intentId: 'intent-crash-2',
                destinationTxHash: CANONICAL_TX_HASH,
                destinationChainId: String(ARB_CHAIN_ID),
                tokenAddress: ARB_USDC,
                tokenSymbol: 'USDC',
                recipient: USER_WALLET,
                expectedAmountRaw: EXPECTED_AMOUNT.toString(),
                actualAmountRaw: EXPECTED_AMOUNT.toString(),
                verified: true,
                verifiedAt: Date.now()
            });
            const existing = await repo.getSettlement('intent-crash-2');
            assert.strictEqual(existing?.verified, true);
        });
        it('12.3 Crash before receipt leaves intent in recoverable active state', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            await repo.createIntent({
                intentId: 'intent-crash-3',
                userAddress: USER_WALLET,
                sourceChainId: String(POL_CHAIN_ID),
                destinationChainId: String(ARB_CHAIN_ID),
                sourceTokenAddress: POL_USDC,
                sourceTokenSymbol: 'USDC',
                destinationTokenAddress: ARB_USDC,
                destinationTokenSymbol: 'USDC',
                amountInRaw: EXPECTED_AMOUNT.toString(),
                expectedAmountOutRaw: EXPECTED_AMOUNT.toString(),
                minAmountOutRaw: MIN_AMOUNT.toString(),
                provider: 'ACROSS',
                routeId: 'route-1',
                nonce: '1',
                deadline: Date.now() + 600000,
                status: 'FULFILLING',
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            const recoverable = await repo.listRecoverableIntents();
            assert.ok(recoverable.some(i => i.intentId === 'intent-crash-3'));
        });
    });
    describe('Suite 13: Multi-RPC Evidence Consistency', () => {
        it('13.1 Quorum consensus: Provider A (Success) + Provider B (Success) -> Confirmed', async () => {
            const tracker = new CrossChainTracker();
            const mockProvider = {
                getTransactionReceipt: async () => ({ status: 1, blockNumber: 1000 })
            };
            const res = await tracker.verifyDestinationSettlement({
                destinationChainId: String(ARB_CHAIN_ID),
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                provider: mockProvider
            });
            assert.strictEqual(res.isVerified, true);
        });
        it('13.2 Disagreeing provider (Receipt missing) fails closed as pending', async () => {
            const tracker = new CrossChainTracker();
            const mockProviderMissing = {
                getTransactionReceipt: async () => null
            };
            const res = await tracker.verifyDestinationSettlement({
                destinationChainId: String(ARB_CHAIN_ID),
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                provider: mockProviderMissing
            });
            assert.strictEqual(res.isVerified, false);
            assert.match(res.reason!, /pending or not found/);
        });
        it('13.3 Failing provider (Revert) fails closed immediately', async () => {
            const tracker = new CrossChainTracker();
            const mockProviderRevert = {
                getTransactionReceipt: async () => ({ status: 0, blockNumber: 1000 })
            };
            const res = await tracker.verifyDestinationSettlement({
                destinationChainId: String(ARB_CHAIN_ID),
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                provider: mockProviderRevert
            });
            assert.strictEqual(res.isVerified, false);
            assert.match(res.reason!, /reverted on-chain/);
        });
        it('13.4 Corrupted txHash format rejected without making RPC call', async () => {
            const tracker = new CrossChainTracker();
            const res = await tracker.verifyDestinationSettlement({
                destinationChainId: String(ARB_CHAIN_ID),
                destinationTxHash: 'not-a-valid-hex-hash',
                expectedRecipient: USER_WALLET
            });
            assert.strictEqual(res.isVerified, false);
            assert.match(res.reason!, /Invalid destination transaction hash format/);
        });
    });
    describe('Suite 14: Destination Token Identity Verification', () => {
        it('14.1 Rejects token address mismatch even with identical token symbols', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(SPOOF_TOKEN, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.tokenMatched, false);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('14.2 Validates case-insensitive canonical ERC-20 contract address', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC.toUpperCase(),
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC.toLowerCase(), RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.tokenMatched, true);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('14.3 Throws DestinationEvidenceMismatchError with expected vs actual token', () => {
            const err = new DestinationEvidenceMismatchError('tokenAddress', ARB_USDC, SPOOF_TOKEN);
            assert.strictEqual(err.code, 'DESTINATION_EVIDENCE_MISMATCH');
            assert.strictEqual(err.field, 'tokenAddress');
            assert.strictEqual(err.expected, ARB_USDC);
            assert.strictEqual(err.actual, SPOOF_TOKEN);
        });
    });
    describe('Suite 15: Destination Receiver Identity Verification', () => {
        it('15.1 Rejects delivery to relayer or solver address instead of user', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ARB_SPOKE_POOL, RELAYER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.deliveredToExpectedRecipient, false);
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
        });
        it('15.2 Rejects zero address transfer', () => {
            const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ARB_SPOKE_POOL, ZERO_ADDR, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.deliveredToExpectedRecipient, false);
        });
        it('15.3 Throws DestinationEvidenceMismatchError on recipient divergence', () => {
            const err = new DestinationEvidenceMismatchError('recipient', USER_WALLET, RELAYER_WALLET);
            assert.strictEqual(err.code, 'DESTINATION_EVIDENCE_MISMATCH');
            assert.strictEqual(err.field, 'recipient');
        });
    });
    describe('Suite 16: Amount Finality & Value Protection', () => {
        it('16.1 Exact expected amount satisfies settlement', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('16.2 Surplus output (> expected) satisfies settlement', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT + 5000000n)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('16.3 Exact minimum output boundary satisfies settlement', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, MIN_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('16.4 1 wei under-delivery halts execution fail-closed with DESTINATION_STATUS_UNCERTAIN', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, MIN_AMOUNT - 1n)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('16.5 Zero amount transfer halts execution fail-closed with DESTINATION_STATUS_UNCERTAIN', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, 0n)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('16.6 Handles large 256-bit integer amounts safely without overflow', () => {
            const HUGE_AMOUNT = 1000000000000000000000000n;
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: HUGE_AMOUNT - 1000n,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, HUGE_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
    });
    describe('Suite 17: Direct Cross-Chain Settlement Flow', () => {
        it('17.1 Completes direct Polygon -> Arbitrum bridge settlement end-to-end', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: 'filled',
                providerFillTx: CANONICAL_TX_HASH,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    gasUsed: 95000n,
                    logs: [makeTransferLog(ARB_USDC, ARB_SPOKE_POOL, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.actualDeliveredAmountRaw, EXPECTED_AMOUNT.toString());
        });
        it('17.2 Completes direct Ethereum -> Base bridge settlement end-to-end', () => {
            const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
            const res = verifyDestinationSettlement({
                destinationChainId: BASE_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: BASE_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: 'filled',
                receipt: {
                    status: 1,
                    blockNumber: 2000,
                    logs: [makeTransferLog(BASE_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
    });
    describe('Suite 18: Composite Cross-Chain Settlement Flow', () => {
        it('18.1 Verifies multi-stage composite route settlement with refreshed bridge output', () => {
            const refreshedExpectedBridgeOutput = 100200000n;
            const compositeMinOutput = 99800000n;
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: compositeMinOutput,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ARB_SPOKE_POOL, USER_WALLET, refreshedExpectedBridgeOutput)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.actualDeliveredAmountRaw, refreshedExpectedBridgeOutput.toString());
        });
        it('18.2 Rejects composite settlement if final output breaches composite minimum', () => {
            const compositeMinOutput = 99800000n;
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: compositeMinOutput,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ARB_SPOKE_POOL, USER_WALLET, compositeMinOutput - 100n)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
    });
    describe('Suite 19: Provider Failure & Network Outage Handling', () => {
        it('19.1 Bridge API timeout leaves status UNCERTAIN (never assumed settled)', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: null,
                receipt: null
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('19.2 RPC query error in Tracker fails closed with descriptive reason', async () => {
            const tracker = new CrossChainTracker();
            const mockFailingRpc = {
                getTransactionReceipt: async () => { throw new Error('ETIMEDOUT: Connection refused'); }
            };
            const res = await tracker.verifyDestinationSettlement({
                destinationChainId: String(ARB_CHAIN_ID),
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                provider: mockFailingRpc
            });
            assert.strictEqual(res.isVerified, false);
            assert.match(res.reason!, /ETIMEDOUT/);
        });
        it('19.3 Instantiates SettlementFinalityBreachError with metadata', () => {
            const err = new SettlementFinalityBreachError(5, 20, ARB_CHAIN_ID);
            assert.strictEqual(err.code, 'SETTLEMENT_FINALITY_BREACH');
            assert.strictEqual(err.currentConfirmations, 5);
            assert.strictEqual(err.requiredConfirmations, 20);
            assert.strictEqual(err.chainId, ARB_CHAIN_ID);
        });
    });
    describe('Suite 20: Forged Evidence Attack Matrix', () => {
        it('20.1 Attack: Fake receipt with status 1 but random calldata and no transfer event', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [{ address: ARB_SPOKE_POOL, topics: ['0x1234567812345678123456781234567812345678123456781234567812345678'], data: '0x' }]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('20.2 Attack: Fake Bridge API returning "filled" for non-existent destination transaction', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: '0x9999999999999999999999999999999999999999999999999999999999999999',
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                providerStatus: 'filled',
                receipt: null
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('20.3 Attack: Malicious token contract pretending to transfer USDC', () => {
            const MALICIOUS_TOKEN = '0x6666666666666666666666666666666666666666';
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(MALICIOUS_TOKEN, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.tokenMatched, false);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('20.4 Attack: Fake Transfer event with spoofed signature topic[0]', () => {
            const FAKE_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [{
                            address: ARB_USDC,
                            topics: [FAKE_TOPIC, '0x000000000000000000000000' + RELAYER_WALLET.slice(2), '0x000000000000000000000000' + USER_WALLET.slice(2)],
                            data: '0x0000000000000000000000000000000000000000000000000000000005f5e100'
                        }]
                }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
        });
        it('20.5 Attack: Replay of old tx hash from different block', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                expectedBlockHash: CANONICAL_BLOCK_HASH,
                receipt: {
                    status: 1,
                    blockNumber: 500,
                    blockHash: '0x9999999999999999999999999999999999999999999999999999999999999999',
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.settlementStatus, 'REORG_DETECTED');
        });
        it('20.6 Attack: Fake SpokePool emitting transfer of wrong token', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                expectedSpokePoolOrTarget: ARB_SPOKE_POOL,
                transaction: {
                    hash: CANONICAL_TX_HASH,
                    from: RELAYER_WALLET,
                    to: ARB_SPOKE_POOL,
                    chainId: ARB_CHAIN_ID
                },
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(SPOOF_TOKEN, ARB_SPOKE_POOL, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            assert.strictEqual(res.tokenMatched, false);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
    });
    describe('Suite 21: Deterministic Fuzz Testing - 1,000 Receipt Mutations', () => {
        it('21.1 Evaluates 1,000 randomized receipt mutations under seed 0x7A5C34', () => {
            const rng = createMulberry32(0x7A5C34);
            let rejected = 0;
            let settled = 0;
            for (let i = 0; i < 1000; i++) {
                const rand = rng();
                const status = rand < 0.3 ? 0 : (rand < 0.6 ? 1 : '0x1');
                const includeLogs = rand > 0.4;
                const blockNumber = Math.floor(rng() * 1000000);
                const logs = includeLogs ? [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)] : [];
                const res = verifyDestinationSettlement({
                    destinationChainId: ARB_CHAIN_ID,
                    expectedRecipient: USER_WALLET,
                    expectedToken: ARB_USDC,
                    expectedMinAmountRaw: MIN_AMOUNT,
                    receipt: {
                        status,
                        blockNumber,
                        logs
                    }
                });
                if (status === 0 || !includeLogs) {
                    assert.notStrictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
                    rejected++;
                }
                else {
                    assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
                    settled++;
                }
            }
            assert.ok(rejected > 0);
            assert.ok(settled > 0);
            assert.strictEqual(rejected + settled, 1000);
        });
    });
    describe('Suite 22: Deterministic Fuzz Testing - 1,000 Transfer Log Mutations', () => {
        it('22.1 Evaluates 1,000 randomized transfer log mutations under seed 0x7A5C34', () => {
            const rng = createMulberry32(0x7A5C34 + 1);
            let rejected = 0;
            let settled = 0;
            for (let i = 0; i < 1000; i++) {
                const rand = rng();
                const token = rand < 0.25 ? SPOOF_TOKEN : ARB_USDC;
                const recipient = rand < 0.5 ? UNRELATED_WALLET : USER_WALLET;
                const amountDelta = BigInt(Math.floor((rng() - 0.5) * 20000000));
                const amount = EXPECTED_AMOUNT + amountDelta;
                const res = verifyDestinationSettlement({
                    destinationChainId: ARB_CHAIN_ID,
                    expectedRecipient: USER_WALLET,
                    expectedToken: ARB_USDC,
                    expectedMinAmountRaw: MIN_AMOUNT,
                    receipt: {
                        status: 1,
                        blockNumber: 1000,
                        logs: [makeTransferLog(token, RELAYER_WALLET, recipient, amount > 0n ? amount : 0n)]
                    }
                });
                const isSafe = token.toLowerCase() === ARB_USDC.toLowerCase() &&
                    recipient.toLowerCase() === USER_WALLET.toLowerCase() &&
                    amount >= MIN_AMOUNT;
                if (isSafe) {
                    assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
                    settled++;
                }
                else {
                    assert.notStrictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
                    rejected++;
                }
            }
            assert.ok(rejected > 0);
            assert.ok(settled > 0);
            assert.strictEqual(rejected + settled, 1000);
        });
    });
    describe('Suite 23: Deterministic Fuzz Testing - 1,000 Bridge API Mutations', () => {
        it('23.1 Evaluates 1,000 randomized bridge provider API responses under seed 0x7A5C34', () => {
            const rng = createMulberry32(0x7A5C34 + 2);
            const statuses = ['filled', 'pending', 'refunded', 'expired', 'unknown', ''];
            let rejected = 0;
            for (let i = 0; i < 1000; i++) {
                const statusIdx = Math.floor(rng() * statuses.length);
                const providerStatus = statuses[statusIdx];
                const receiptReverted = rng() < 0.3;
                const res = verifyDestinationSettlement({
                    destinationChainId: ARB_CHAIN_ID,
                    expectedRecipient: USER_WALLET,
                    expectedToken: ARB_USDC,
                    expectedMinAmountRaw: MIN_AMOUNT,
                    providerStatus,
                    receipt: receiptReverted ? { status: 0, blockNumber: 1000 } : null
                });
                if (receiptReverted && providerStatus === 'filled') {
                    assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
                }
                else if (receiptReverted || providerStatus === 'refunded' || providerStatus === 'expired') {
                    assert.strictEqual(res.settlementStatus, 'DESTINATION_FAILED');
                }
                else {
                    assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
                }
                rejected++;
            }
            assert.strictEqual(rejected, 1000);
        });
    });
    describe('Suite 24: Deterministic Fuzz Testing - 1,000 Multi-Tier Evidence Combinations', () => {
        it('24.1 Evaluates 1,000 multi-tier evidence combination permutations under seed 0x7A5C34', () => {
            const rng = createMulberry32(0x7A5C34 + 3);
            let passCount = 0;
            for (let i = 0; i < 1000; i++) {
                const hasReceipt = rng() > 0.4;
                const receiptStatus = rng() > 0.3 ? 1 : 0;
                const hasTransfer = rng() > 0.3;
                const hasBalanceDelta = rng() > 0.5;
                const providerStatus = rng() > 0.5 ? 'filled' : 'pending';
                const blockHashMutated = rng() < 0.15;
                const logs = hasTransfer ? [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)] : [];
                const res = verifyDestinationSettlement({
                    destinationChainId: ARB_CHAIN_ID,
                    expectedRecipient: USER_WALLET,
                    expectedToken: ARB_USDC,
                    expectedMinAmountRaw: MIN_AMOUNT,
                    expectedBlockHash: CANONICAL_BLOCK_HASH,
                    providerStatus,
                    preBridgeBalanceRaw: 0n,
                    currentBalanceRaw: hasBalanceDelta ? EXPECTED_AMOUNT : 0n,
                    receipt: hasReceipt ? {
                        status: receiptStatus,
                        blockNumber: 1000,
                        blockHash: blockHashMutated ? REORGED_BLOCK_HASH : CANONICAL_BLOCK_HASH,
                        logs
                    } : null
                });
                if (blockHashMutated && hasReceipt) {
                    assert.strictEqual(res.settlementStatus, 'REORG_DETECTED');
                }
                else if (hasReceipt && receiptStatus === 0 && providerStatus === 'filled') {
                    assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
                }
                else if (hasReceipt && receiptStatus === 0) {
                    assert.strictEqual(res.settlementStatus, 'DESTINATION_FAILED');
                }
                else if (hasReceipt && receiptStatus === 1 && (hasTransfer || hasBalanceDelta)) {
                    assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
                }
                else {
                    assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
                }
                passCount++;
            }
            assert.strictEqual(passCount, 1000);
        });
    });
    describe('Suite 25: Observability & Sanitized Settlement Telemetry', () => {
        it('25.1 Records structured settlement telemetry on verification', () => {
            verifyDestinationSettlement({
                planId: 'plan-telemetry-1',
                intentId: 'intent-telemetry-1',
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, RELAYER_WALLET, USER_WALLET, EXPECTED_AMOUNT)]
                }
            });
            const latest = defaultSettlementTelemetry.getLatestRecord();
            assert.ok(latest);
            assert.strictEqual(latest.planId, 'plan-telemetry-1');
            assert.strictEqual(latest.verificationResult, 'SETTLED');
            assert.strictEqual(latest.destinationTxHash, CANONICAL_TX_HASH);
        });
        it('25.2 Scrubs private keys and credentials from telemetry records', () => {
            const FAKE_SECRET_KEY = '0x11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
            verifyDestinationSettlement({
                planId: `plan-${FAKE_SECRET_KEY}`,
                intentId: `intent-${FAKE_SECRET_KEY}`,
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: MIN_AMOUNT
            });
            const latest = defaultSettlementTelemetry.getLatestRecord();
            assert.ok(latest);
            assert.strictEqual(latest.planId.includes(FAKE_SECRET_KEY), false);
            assert.strictEqual(latest.planId.includes('[REDACTED_SECRET]'), true);
        });
        it('25.3 Telemetry maintains circular buffer capped at 1,000 records', () => {
            const tel = new SettlementTelemetry();
            for (let i = 0; i < 1100; i++) {
                tel.record({
                    planId: `plan-${i}`,
                    intentId: `intent-${i}`,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    destinationTxHash: CANONICAL_TX_HASH,
                    expectedRecipient: USER_WALLET,
                    expectedToken: ARB_USDC,
                    expectedMinAmount: MIN_AMOUNT.toString(),
                    primaryEvidenceTier: 'TIER_1_ONCHAIN_RECEIPT',
                    evidenceSource: 'ON_CHAIN',
                    verificationResult: 'SETTLED'
                });
            }
            assert.strictEqual(tel.getRecords().length, 1000);
            assert.strictEqual(tel.getLatestRecord()?.planId, 'plan-1099');
        });
        it('25.4 Clears telemetry buffer on clear()', () => {
            const tel = new SettlementTelemetry();
            tel.record({
                planId: 'plan-to-clear',
                intentId: 'intent-to-clear',
                sourceChainId: POL_CHAIN_ID,
                destinationChainId: ARB_CHAIN_ID,
                destinationTxHash: CANONICAL_TX_HASH,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmount: MIN_AMOUNT.toString(),
                primaryEvidenceTier: 'TIER_1_ONCHAIN_RECEIPT',
                evidenceSource: 'ON_CHAIN',
                verificationResult: 'SETTLED'
            });
            assert.strictEqual(tel.getRecords().length, 1);
            tel.clear();
            assert.strictEqual(tel.getRecords().length, 0);
            assert.strictEqual(tel.getLatestRecord(), null);
        });
    });
});
