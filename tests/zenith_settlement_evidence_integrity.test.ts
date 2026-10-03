import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import {
    verifyDestinationSettlement,
    DestinationEvidenceTier,
    DestinationSettlementStatus
} from '../packages/execution/src/crosschain/authoritativeDestinationVerifier';
import {
    validateTransactionStateTransition,
    validateSettlementStateTransition,
    InMemoryCrossChainStateRepository
} from '../packages/execution/src/persistence/repository';
import { SQLiteCrossChainStateRepository } from '../packages/execution/src/persistence/sqliteRepository';
import { ExecutionIntegrationPipeline } from '../packages/execution/src/crosschain/executionIntegrationPipeline';
import { InvalidStateTransitionError } from '../packages/contracts/src/errors';
import { PersistentSettlement, PersistentTransaction } from '../packages/types/src';

const ERC20_TRANSFER_EVENT = 'event Transfer(address indexed from, address indexed to, uint256 value)';
const erc20Iface = new Interface([ERC20_TRANSFER_EVENT]);

describe('ZENITH — Authoritative Settlement Evidence & Finality Hardening Test Suite', () => {
    const RECIPIENT = '0x1111111111111111111111111111111111111111';
    const ATTACKER = '0x9999999999999999999999999999999999999999';
    const TOKEN_USDC = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
    const TOKEN_SHITCOIN = '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead';
    const SPOKE_POOL = '0x2222222222222222222222222222222222222222';

    // ------------------------------------------------------------------------
    // 1. Confirmation Without Receipt / Broadcast Uncertainty Transitions
    // ------------------------------------------------------------------------
    it('1.1 Hard Invariant: BROADCAST_UNCERTAIN transitions validate safely', () => {
        assert.doesNotThrow(() => validateTransactionStateTransition('BROADCAST_UNCERTAIN', 'CONFIRMED'));
        assert.doesNotThrow(() => validateTransactionStateTransition('BROADCAST_UNCERTAIN', 'BROADCAST_CONFIRMED'));
        assert.doesNotThrow(() => validateTransactionStateTransition('BROADCAST_UNCERTAIN', 'RECOVERY_REQUIRED'));
        assert.doesNotThrow(() => validateTransactionStateTransition('BROADCAST_UNCERTAIN', 'REVERTED'));
        assert.throws(
            () => validateTransactionStateTransition('BROADCAST_UNCERTAIN', 'READY_TO_BROADCAST'),
            InvalidStateTransitionError
        );
    });

    it('1.2 Hard Invariant: Missing receipt leaves destination status UNCERTAIN', () => {
        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            destinationTxHash: '0xabc123',
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            receipt: null
        });

        assert.strictEqual(result.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        assert.strictEqual(result.primaryEvidenceTier, 'NONE');
        assert.strictEqual(result.evidences[0].status, 'NOT_FOUND');
    });

    // ------------------------------------------------------------------------
    // 2. Reverted Receipts and Conflict Handling
    // ------------------------------------------------------------------------
    it('2.1 Reverted on-chain receipt strictly marks DESTINATION_FAILED', () => {
        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            destinationTxHash: '0xrevert',
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            receipt: {
                status: 0,
                blockNumber: 50000000,
                blockHash: '0xblock1'
            }
        });

        assert.strictEqual(result.settlementStatus, 'DESTINATION_FAILED');
        assert.strictEqual(result.primaryEvidenceTier, 'TIER_1_ONCHAIN_RECEIPT');
        assert.ok(result.revertReason?.includes('reverted on-chain'));
    });

    it('2.2 Provider reported filled vs on-chain reverted receipt triggers STATUS_CONFLICT', () => {
        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            destinationTxHash: '0xrevert',
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            providerStatus: 'filled',
            bridgeProvider: 'across',
            receipt: {
                status: 0,
                blockNumber: 50000000,
                blockHash: '0xblock1'
            }
        });

        assert.strictEqual(result.settlementStatus, 'STATUS_CONFLICT');
        assert.strictEqual(result.primaryEvidenceTier, 'TIER_1_ONCHAIN_RECEIPT');
        assert.ok(result.conflictReason?.includes('REVERTED'));
    });

    // ------------------------------------------------------------------------
    // 3. Diagnostic Evidence Isolation (Provider API & Local Cache)
    // ------------------------------------------------------------------------
    it('3.1 Provider API filled claim without receipt remains UNCERTAIN', () => {
        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            destinationTxHash: '0xpending',
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            providerStatus: 'filled',
            providerFillTx: '0xpending',
            receipt: null
        });

        assert.strictEqual(result.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        assert.strictEqual(result.primaryEvidenceTier, 'TIER_5_PROVIDER_API');
    });

    it('3.2 Local cache SETTLED claim without on-chain receipt remains UNCERTAIN', () => {
        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            localCacheStatus: 'SETTLED',
            receipt: null
        });

        assert.strictEqual(result.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
    });

    // ------------------------------------------------------------------------
    // 4. Provenance-Guarded Balance Delta Validation
    // ------------------------------------------------------------------------
    it('4.1 Balance delta WITHOUT pre-balance baseline is marked UNAVAILABLE (no false positive)', () => {
        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            currentBalanceRaw: '10000000', // User already has 10 USDC
            preBridgeBalanceRaw: undefined, // Missing pre-balance provenance!
            receipt: {
                status: 1,
                blockNumber: 50000000,
                blockHash: '0xblock1',
                logs: []
            }
        });

        assert.strictEqual(result.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        const balanceEvidence = result.evidences.find((e) => e.tier === 'TIER_4_RECIPIENT_BALANCE_DELTA');
        assert.strictEqual(balanceEvidence?.status, 'UNAVAILABLE');
    });

    it('4.2 Balance delta WITH trusted pre-balance baseline certifies settlement', () => {
        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            currentBalanceRaw: '11000000', // 11 USDC
            preBridgeBalanceRaw: '10000000', // 10 USDC (delta = +1 USDC >= 1 USDC min)
            currentBlockNumber: 50000020,
            requiredConfirmations: 5,
            receipt: {
                status: 1,
                blockNumber: 50000000,
                blockHash: '0xblock1',
                logs: []
            }
        });

        assert.strictEqual(result.settlementStatus, 'DESTINATION_SETTLED');
        assert.strictEqual(result.primaryEvidenceTier, 'TIER_4_RECIPIENT_BALANCE_DELTA');
        assert.strictEqual(result.isFinalized, true);
    });

    // ------------------------------------------------------------------------
    // 5. ERC20 Transfer Event Validation & Semantic Equivalence
    // ------------------------------------------------------------------------
    it('5.1 Valid ERC20 Transfer log verifies destination settlement', () => {
        const logData = erc20Iface.encodeEventLog(erc20Iface.getEvent('Transfer')!, [
            SPOKE_POOL,
            RECIPIENT,
            1000000n
        ]);

        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            destinationTxHash: '0xsuccess1',
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            currentBlockNumber: 50000020,
            requiredConfirmations: 10,
            receipt: {
                status: 1,
                blockNumber: 50000000,
                blockHash: '0xblock1',
                logs: [
                    {
                        address: TOKEN_USDC,
                        topics: logData.topics as string[],
                        data: logData.data
                    }
                ]
            }
        });

        assert.strictEqual(result.settlementStatus, 'DESTINATION_SETTLED');
        assert.strictEqual(result.primaryEvidenceTier, 'TIER_3_ERC20_TRANSFER_EVENT');
        assert.strictEqual(result.deliveredToExpectedRecipient, true);
        assert.strictEqual(result.actualDeliveredAmountRaw, '1000000');
    });

    it('5.2 Transfer log to wrong recipient triggers STATUS_CONFLICT', () => {
        const logData = erc20Iface.encodeEventLog(erc20Iface.getEvent('Transfer')!, [
            SPOKE_POOL,
            ATTACKER,
            1000000n
        ]);

        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            destinationTxHash: '0xwrongrecipient',
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            receipt: {
                status: 1,
                blockNumber: 50000000,
                blockHash: '0xblock1',
                logs: [
                    {
                        address: TOKEN_USDC,
                        topics: logData.topics as string[],
                        data: logData.data
                    }
                ]
            }
        });

        assert.strictEqual(result.settlementStatus, 'STATUS_CONFLICT');
        assert.ok(result.conflictReason?.includes('did not match expected'));
    });

    it('5.3 Transfer log with wrong token triggers STATUS_CONFLICT / NOT_FOUND', () => {
        const logData = erc20Iface.encodeEventLog(erc20Iface.getEvent('Transfer')!, [
            SPOKE_POOL,
            RECIPIENT,
            1000000n
        ]);

        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            destinationTxHash: '0xwrongtoken',
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            receipt: {
                status: 1,
                blockNumber: 50000000,
                blockHash: '0xblock1',
                logs: [
                    {
                        address: TOKEN_SHITCOIN, // Unrelated token
                        topics: logData.topics as string[],
                        data: logData.data
                    }
                ]
            }
        });

        assert.strictEqual(result.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        assert.strictEqual(result.tokenMatched, false);
    });

    it('5.4 Multiple partial transfers aggregating to meet minimum succeed', () => {
        const log1 = erc20Iface.encodeEventLog(erc20Iface.getEvent('Transfer')!, [SPOKE_POOL, RECIPIENT, 600000n]);
        const log2 = erc20Iface.encodeEventLog(erc20Iface.getEvent('Transfer')!, [SPOKE_POOL, RECIPIENT, 450000n]);

        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            destinationTxHash: '0xmulti',
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            currentBlockNumber: 50000020,
            requiredConfirmations: 5,
            receipt: {
                status: 1,
                blockNumber: 50000000,
                blockHash: '0xblock1',
                logs: [
                    { address: TOKEN_USDC, topics: log1.topics as string[], data: log1.data },
                    { address: TOKEN_USDC, topics: log2.topics as string[], data: log2.data }
                ]
            }
        });

        assert.strictEqual(result.settlementStatus, 'DESTINATION_SETTLED');
        assert.strictEqual(result.actualDeliveredAmountRaw, '1050000');
    });

    // ------------------------------------------------------------------------
    // 6. Native Token Settlement Validation
    // ------------------------------------------------------------------------
    it('6.1 Native ETH/POL transfer verified through transaction value and recipient', () => {
        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            destinationTxHash: '0xnative',
            expectedRecipient: RECIPIENT,
            expectedToken: 'POL',
            expectedMinAmountRaw: '1000000000000000000', // 1 POL
            currentBlockNumber: 50000020,
            requiredConfirmations: 5,
            transaction: {
                hash: '0xnative',
                from: SPOKE_POOL,
                to: RECIPIENT,
                value: '1000000000000000000',
                chainId: 137
            },
            receipt: {
                status: 1,
                blockNumber: 50000000,
                blockHash: '0xblock1'
            }
        });

        assert.strictEqual(result.settlementStatus, 'DESTINATION_SETTLED');
        assert.strictEqual(result.primaryEvidenceTier, 'TIER_1_ONCHAIN_RECEIPT');
        assert.strictEqual(result.deliveredToExpectedRecipient, true);
    });

    // ------------------------------------------------------------------------
    // 7. Transaction Destination Chain & Target Validation
    // ------------------------------------------------------------------------
    it('7.1 Destination transaction on wrong chain ID triggers STATUS_CONFLICT', () => {
        const result = verifyDestinationSettlement({
            destinationChainId: 137, // Expected Polygon
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            transaction: {
                hash: '0xwrongchain',
                from: SPOKE_POOL,
                to: RECIPIENT,
                chainId: 42161 // Arbitrum!
            },
            receipt: {
                status: 1,
                blockNumber: 50000000,
                blockHash: '0xblock1'
            }
        });

        assert.strictEqual(result.settlementStatus, 'STATUS_CONFLICT');
        assert.ok(result.conflictReason?.includes('does not match expected destination chain'));
    });

    // ------------------------------------------------------------------------
    // 8. Reorganization and Finality Hardening
    // ------------------------------------------------------------------------
    it('8.1 Detected block reorganization invalidates settlement and flags REORG_DETECTED', () => {
        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            destinationTxHash: '0xreorg',
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            expectedBlockHash: '0xcanonicalblock',
            receipt: {
                status: 1,
                blockNumber: 50000000,
                blockHash: '0xforkedblock' // Reorg!
            }
        });

        assert.strictEqual(result.settlementStatus, 'REORG_DETECTED');
        assert.strictEqual(result.reorgDetected, true);
        assert.ok(result.conflictReason?.includes('Reorg detected'));
    });

    it('8.2 Confirmations below required threshold keeps settlement in UNCERTAIN / PENDING', () => {
        const logData = erc20Iface.encodeEventLog(erc20Iface.getEvent('Transfer')!, [SPOKE_POOL, RECIPIENT, 1000000n]);

        const result = verifyDestinationSettlement({
            destinationChainId: 137,
            destinationTxHash: '0xdepth',
            expectedRecipient: RECIPIENT,
            expectedToken: TOKEN_USDC,
            expectedMinAmountRaw: '1000000',
            currentBlockNumber: 50000002, // Only 3 confirmations
            requiredConfirmations: 20, // Requires 20
            receipt: {
                status: 1,
                blockNumber: 50000000,
                blockHash: '0xblock1',
                logs: [{ address: TOKEN_USDC, topics: logData.topics as string[], data: logData.data }]
            }
        });

        assert.strictEqual(result.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        assert.strictEqual(result.isFinalized, false);
        assert.ok(result.conflictReason?.includes('below required finality threshold'));
    });

    // ------------------------------------------------------------------------
    // 9. Persistence Settlement Recording Protection
    // ------------------------------------------------------------------------
    it('9.1 Database records verified settlement record with valid parent intent', async () => {
        const repo = new SQLiteCrossChainStateRepository(':memory:');
        await repo.createIntent({
            intentId: 'intent-fake-01',
            userAddress: RECIPIENT,
            sourceChainId: '1',
            destinationChainId: '137',
            sourceTokenAddress: TOKEN_USDC,
            sourceTokenSymbol: 'USDC',
            destinationTokenAddress: TOKEN_USDC,
            destinationTokenSymbol: 'USDC',
            amountInRaw: '1000000',
            expectedAmountOutRaw: '1000000',
            minAmountOutRaw: '990000',
            provider: 'across',
            routeId: 'route-1',
            nonce: 1,
            deadline: Date.now() + 3600000,
            status: 'DESTINATION_FILLED'
        });

        const settlementRecord: PersistentSettlement = {
            intentId: 'intent-fake-01',
            destinationChainId: '137',
            destinationTxHash: '0xsettletx',
            tokenAddress: TOKEN_USDC,
            tokenSymbol: 'USDC',
            recipient: RECIPIENT,
            expectedAmountRaw: '1000000',
            actualAmountRaw: '1000000',
            verified: true,
            verifiedAt: Date.now()
        };

        await repo.recordSettlement(settlementRecord);
        const fetched = await repo.getSettlement('intent-fake-01');
        assert.ok(fetched);
        assert.strictEqual(fetched?.verified, true);
    });

    it('9.2 Verified settlement cannot be regressed by unverified replay', async () => {
        const repo = new SQLiteCrossChainStateRepository(':memory:');
        await repo.createIntent({
            intentId: 'intent-immutable-01',
            userAddress: RECIPIENT,
            sourceChainId: '1',
            destinationChainId: '137',
            sourceTokenAddress: TOKEN_USDC,
            sourceTokenSymbol: 'USDC',
            destinationTokenAddress: TOKEN_USDC,
            destinationTokenSymbol: 'USDC',
            amountInRaw: '1000000',
            expectedAmountOutRaw: '1000000',
            minAmountOutRaw: '990000',
            provider: 'across',
            routeId: 'route-2',
            nonce: 2,
            deadline: Date.now() + 3600000,
            status: 'DESTINATION_FILLED'
        });

        // 1. Initial verified settlement
        await repo.recordSettlement({
            intentId: 'intent-immutable-01',
            destinationChainId: '137',
            destinationTxHash: '0xverifiedtx',
            tokenAddress: TOKEN_USDC,
            tokenSymbol: 'USDC',
            recipient: RECIPIENT,
            expectedAmountRaw: '1000000',
            actualAmountRaw: '1000000',
            verified: true,
            verifiedAt: 1000
        });

        // 2. Late unverified event arrives
        await repo.recordSettlement({
            intentId: 'intent-immutable-01',
            destinationChainId: '137',
            destinationTxHash: '0xlateevent',
            tokenAddress: TOKEN_USDC,
            tokenSymbol: 'USDC',
            recipient: RECIPIENT,
            expectedAmountRaw: '1000000',
            actualAmountRaw: '0',
            verified: false,
            verifiedAt: 2000
        });

        // 3. Verified state must remain intact
        const fetched = await repo.getSettlement('intent-immutable-01');
        assert.strictEqual(fetched?.verified, true);
        assert.strictEqual(fetched?.destinationTxHash, '0xverifiedtx');
    });
});
