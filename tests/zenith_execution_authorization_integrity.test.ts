import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, Wallet, parseUnits, parseEther, sha256, toUtf8Bytes } from 'ethers';
import {
    ExecutionPlanBuilder,
    sealPlan,
    assertPlanIntegrity,
    verifyPlanIntegrity,
    computeExecutionPlanHash,
    canonicalStringify,
    validateExecutionPlanAuthorization,
    validateCalldataAuthorization,
    validateTargetAllowlist,
    validateTransactionPlanEquivalence,
    validateApprovalSemantics,
    validateSwapSemantics,
    validateBridgeSemantics,
    validateNativeValueSemantics,
    validateGasSemantics,
    validateNonceSemantics,
    validateReceiptSemantics,
    validateCompositeSemantics,
    ExecutionIntegrationPipeline,
    CompositeSettlementMonitoringEngine,
    verifyDestinationSettlement,
    SQLiteCrossChainStateRepository,
    CrossChainRecoveryEngine,
    StatusConflictError
} from '../packages/execution/src';
import {
    ExecutionPlan,
    QuoteRequest,
    CanonicalTransactionPayload,
    Token,
    CrossChainIntent,
    PersistentIntent,
    SettlementEvidenceRecord
} from '../packages/types/src';
import {
    ZERO_ADDRESS,
    ACROSS_SPOKE_POOLS,
    ACROSS_SPOKE_POOL_ABI,
    UNISWAP_V3_SWAP_ROUTERS,
    UNISWAP_V3_SWAP_ROUTER_ABI,
    PlanIntegrityBreachError,
    UnauthorizedExecutionError,
    AuthorizationBoundaryBreachError,
    SemanticEquivalenceBreachError,
    ParameterSemanticMismatchError,
    ApprovalPolicyViolationError,
    ReceiptSemanticError,
    AmountMismatchError,
    MinimumOutputBreachError
} from '../packages/contracts/src';

const USER_ADDR = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';
const ATTACKER_ADDR = '0x9999999999999999999999999999999999999999';
const POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const ARBITRUM_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const SPOKE_POOL_POLYGON = '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096';
const UNISWAP_V3_ROUTER = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';

const spokePoolInterface = new Interface(ACROSS_SPOKE_POOL_ABI);
const swapRouterInterface = new Interface(UNISWAP_V3_SWAP_ROUTER_ABI);

function createSamplePlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
    const tokenIn: Token = {
        address: POLYGON_USDC,
        chainId: '137',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL'
    };
    const tokenOut: Token = {
        address: ARBITRUM_USDC,
        chainId: '42161',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL'
    };

    const depositCalldata = spokePoolInterface.encodeFunctionData('depositV3', [
        USER_ADDR,
        USER_ADDR,
        POLYGON_USDC,
        ARBITRUM_USDC,
        100000000n,
        99500000n,
        42161n,
        ZERO_ADDRESS,
        Math.floor(Date.now() / 1000) - 60,
        Math.floor(Date.now() / 1000) + 1800,
        0,
        '0x'
    ]);

    const plan: ExecutionPlan = {
        planId: 'plan-auth-test-001',
        routeId: 'route-across-polygon-arbitrum',
        routeType: 'CROSS_CHAIN_DIRECT',
        sourceChainId: '137',
        destinationChainId: '42161',
        tokenIn,
        tokenOut,
        expectedAmountInRaw: '100000000',
        expectedAmountOutRaw: '99800000',
        minimumAmountOutRaw: '99500000',
        isExecutable: true,
        selectedProvider: 'across',
        selectedDex: 'uniswap_v3',
        executionTarget: SPOKE_POOL_POLYGON,
        approvalTarget: SPOKE_POOL_POLYGON,
        calldata: depositCalldata,
        expiration: Date.now() + 3600000,
        totalFeeRaw: '200000',
        currentStepIndex: 0,
        overallStatus: 'IDLE',
        diagnostics: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: [
            {
                id: 'step-01-approval',
                type: 'APPROVAL',
                title: 'Approve SpokePool',
                description: 'Authorize Across SpokePool USDC allowance',
                chainId: '137',
                numericChainId: 137,
                executionEnvironment: 'EVM',
                targetAddress: POLYGON_USDC,
                approvalTarget: SPOKE_POOL_POLYGON,
                requiredAmountRaw: '100000000',
                requiredTokenAddress: POLYGON_USDC,
                status: 'IDLE',
                dependencies: [],
                retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 30000 }
            },
            {
                id: 'step-02-deposit',
                type: 'BRIDGE_DEPOSIT',
                title: 'Deposit to Across',
                description: 'Call depositV3 on Across SpokePool',
                chainId: '137',
                numericChainId: 137,
                executionEnvironment: 'EVM',
                targetAddress: SPOKE_POOL_POLYGON,
                calldata: depositCalldata,
                requiredAmountRaw: '100000000',
                outputTokenAddress: ARBITRUM_USDC,
                expectedAmountOutRaw: '99800000',
                minimumAmountOutRaw: '99500000',
                status: 'IDLE',
                dependencies: ['step-01-approval'],
                retryPolicy: { maxRetries: 2, backoffMs: 2000, timeoutMs: 60000 }
            }
        ],
        ...overrides
    };

    (plan as any).recipient = USER_ADDR;
    (plan as any).userWalletAddress = USER_ADDR;
    return sealPlan(plan);
}

function createSampleIntent(overrides: Partial<CrossChainIntent> = {}): CrossChainIntent {
    return {
        intentId: 'intent-auth-001',
        userAddress: USER_ADDR,
        recipientAddress: USER_ADDR,
        sourceChainId: 137,
        destinationChainId: 42161,
        tokenInAddress: POLYGON_USDC,
        tokenOutAddress: ARBITRUM_USDC,
        amountInRaw: '100000000',
        minAmountOutRaw: '99500000',
        deadline: Date.now() + 3600000,
        slippageBps: 50,
        executionMode: 'LIVE_EXECUTION',
        ...overrides
    };
}

test('ZENITH — END-TO-END EXECUTION AUTHORIZATION & PLAN INTEGRITY MASTER MATRIX', async (t) => {

    // =========================================================================
    // I. USER INTENT IMMUTABILITY & CONSTRAINTS (1 - 5)
    // =========================================================================

    await t.test('1. Intent: Mutated recipient is rejected during security authorization', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateExecutionPlanAuthorization(plan, {
                recipientAddress: ATTACKER_ADDR
            });
        }, AuthorizationBoundaryBreachError);
    });

    await t.test('2. Intent: Mutated token is rejected during security authorization', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateExecutionPlanAuthorization(plan, {
                tokenInAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
            });
        }, AuthorizationBoundaryBreachError);
    });

    await t.test('3. Intent: Mutated amount is rejected during security authorization', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateExecutionPlanAuthorization(plan, {
                expectedAmountInRaw: '200000000'
            });
        }, AuthorizationBoundaryBreachError);
    });

    await t.test('4. Intent: Mutated destination chain is rejected during security authorization', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateExecutionPlanAuthorization(plan, {
                destinationChainId: '10' // Optimism instead of Arbitrum
            });
        }, AuthorizationBoundaryBreachError);
    });

    await t.test('5. Intent: Expired deadline is rejected during security authorization', () => {
        const plan = createSamplePlan({
            expiration: Date.now() - 5000
        });
        assert.throws(() => {
            validateExecutionPlanAuthorization(plan);
        }, UnauthorizedExecutionError);
    });

    // =========================================================================
    // II. EXECUTION PLAN INTEGRITY & CANONICAL SEAL (6 - 11)
    // =========================================================================

    await t.test('6. Plan: Plan hash changes deterministically when recipient changes', () => {
        const planA = createSamplePlan();
        const baseHash = computeExecutionPlanHash(planA);

        const planB = createSamplePlan();
        (planB as any).recipient = ATTACKER_ADDR;
        const mutatedHash = computeExecutionPlanHash(planB);

        assert.notEqual(baseHash, mutatedHash, 'Integrity hash must change when recipient is modified');
    });

    await t.test('7. Plan: Plan hash changes deterministically when token changes', () => {
        const planA = createSamplePlan();
        const baseHash = computeExecutionPlanHash(planA);

        const planB = createSamplePlan({
            tokenIn: { ...planA.tokenIn, address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' }
        });
        const mutatedHash = computeExecutionPlanHash(planB);

        assert.notEqual(baseHash, mutatedHash, 'Integrity hash must change when tokenIn is modified');
    });

    await t.test('8. Plan: Plan hash changes deterministically when amount changes', () => {
        const planA = createSamplePlan();
        const baseHash = computeExecutionPlanHash(planA);

        const planB = createSamplePlan({
            expectedAmountInRaw: '105000000'
        });
        const mutatedHash = computeExecutionPlanHash(planB);

        assert.notEqual(baseHash, mutatedHash, 'Integrity hash must change when amountIn is modified');
    });

    await t.test('9. Plan: Plan hash changes deterministically when chain changes', () => {
        const planA = createSamplePlan();
        const baseHash = computeExecutionPlanHash(planA);

        const planB = createSamplePlan({
            destinationChainId: '8453' // Base
        });
        const mutatedHash = computeExecutionPlanHash(planB);

        assert.notEqual(baseHash, mutatedHash, 'Integrity hash must change when destinationChainId is modified');
    });

    await t.test('10. Plan: Plan hash changes deterministically when calldata changes', () => {
        const planA = createSamplePlan();
        const baseHash = computeExecutionPlanHash(planA);

        const planB = createSamplePlan({
            calldata: planA.calldata + '00'
        });
        const mutatedHash = computeExecutionPlanHash(planB);

        assert.notEqual(baseHash, mutatedHash, 'Integrity hash must change when calldata is modified');
    });

    await t.test('11. Plan: Plan hash changes deterministically when execution target changes', () => {
        const planA = createSamplePlan();
        const baseHash = computeExecutionPlanHash(planA);

        const planB = createSamplePlan({
            executionTarget: ATTACKER_ADDR
        });
        const mutatedHash = computeExecutionPlanHash(planB);

        assert.notEqual(baseHash, mutatedHash, 'Integrity hash must change when executionTarget is modified');
    });

    // =========================================================================
    // III. AUTHORIZATION BINDING TO THE PLAN (12 - 16)
    // =========================================================================

    await t.test('12. Authorization: Sealed plan rejects execution if tampered post-seal', () => {
        const plan = createSamplePlan();
        const originalHash = plan.integrityHash;
        (plan as any).expectedAmountInRaw = '50000000'; // Mutate post-seal

        assert.throws(() => {
            assertPlanIntegrity(plan);
        }, PlanIntegrityBreachError);

        assert.equal(verifyPlanIntegrity(plan, originalHash), false);
    });

    await t.test('13. Authorization: Rejects signature / context binding for different recipient', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateExecutionPlanAuthorization(plan, {
                recipientAddress: '0x0000000000000000000000000000000000000001'
            });
        }, AuthorizationBoundaryBreachError);
    });

    await t.test('14. Authorization: Rejects authorization context for different source chain', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateExecutionPlanAuthorization(plan, {
                sourceChainId: '1' // Ethereum Mainnet
            });
        }, AuthorizationBoundaryBreachError);
    });

    await t.test('15. Authorization: Rejects authorization context for different destination token', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateExecutionPlanAuthorization(plan, {
                tokenOutAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' // WETH on Arbitrum
            });
        }, AuthorizationBoundaryBreachError);
    });

    await t.test('16. Authorization: Rejects authorization context when minimum amount out is violated', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateExecutionPlanAuthorization(plan, {
                minimumAmountOutRaw: '99999999' // Requires higher than planned
            });
        }, AuthorizationBoundaryBreachError);
    });

    // =========================================================================
    // IV. TRANSACTION SEMANTICS & EQUIVALENCE (17 - 22)
    // =========================================================================

    await t.test('17. Transaction: Wrong `to` target contract rejected', () => {
        const plan = createSamplePlan();
        const wrongTargetTx: CanonicalTransactionPayload = {
            chainId: 137,
            to: ATTACKER_ADDR,
            data: plan.calldata!,
            value: '0'
        };

        assert.throws(() => {
            validateTransactionPlanEquivalence(wrongTargetTx, plan);
        }, SemanticEquivalenceBreachError);
    });

    await t.test('18. Transaction: Wrong native `value` rejected for ERC20 operation', () => {
        const plan = createSamplePlan();
        const wrongValueTx: CanonicalTransactionPayload = {
            chainId: 137,
            to: plan.executionTarget!,
            data: plan.calldata!,
            value: parseEther('1.0').toString() // Unauthorized native value
        };

        assert.throws(() => {
            validateTransactionPlanEquivalence(wrongValueTx, plan);
        }, SemanticEquivalenceBreachError);
    });

    await t.test('19. Transaction: Mutated calldata parameters rejected', () => {
        const plan = createSamplePlan();
        const mutatedDepositCalldata = spokePoolInterface.encodeFunctionData('depositV3', [
            USER_ADDR,
            ATTACKER_ADDR, // Hijacked recipient inside calldata
            POLYGON_USDC,
            ARBITRUM_USDC,
            100000000n,
            99500000n,
            42161n,
            ZERO_ADDRESS,
            Math.floor(Date.now() / 1000) - 60,
            Math.floor(Date.now() / 1000) + 1800,
            0,
            '0x'
        ]);

        const hijackedTx: CanonicalTransactionPayload = {
            chainId: 137,
            to: plan.executionTarget!,
            data: mutatedDepositCalldata,
            value: '0'
        };

        assert.throws(() => {
            validateTransactionPlanEquivalence(hijackedTx, plan);
        }, SemanticEquivalenceBreachError);
    });

    await t.test('20. Transaction: Wrong chain ID rejected before broadcast', () => {
        const plan = createSamplePlan();
        const wrongChainTx: CanonicalTransactionPayload = {
            chainId: 1, // Mainnet instead of Polygon 137
            to: plan.executionTarget!,
            data: plan.calldata!,
            value: '0'
        };

        assert.throws(() => {
            validateTransactionPlanEquivalence(wrongChainTx, plan);
        }, SemanticEquivalenceBreachError);
    });

    await t.test('21. Transaction: Decoded swap parameters reject sender/recipient mismatch', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateSwapSemantics({
                tokenIn: POLYGON_USDC,
                tokenOut: ARBITRUM_USDC,
                recipient: ATTACKER_ADDR,
                amountIn: 100000000n,
                amountOutMinimum: 99500000n
            }, plan);
        }, ParameterSemanticMismatchError);
    });

    await t.test('22. Transaction: Nonce discontinuity / conflicting replacement rejected', () => {
        assert.throws(() => {
            validateNonceSemantics(5, 5, 5, 6); // Broadcast nonce jumped from 5 to 6
        }, SemanticEquivalenceBreachError);
    });

    // =========================================================================
    // V. ERC20 APPROVAL / PERMIT BOUNDARY SECURITY (23 - 28)
    // =========================================================================

    await t.test('23. ERC20: Wrong token contract rejected for approval', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateApprovalSemantics('0x0000000000000000000000000000000000000002', SPOKE_POOL_POLYGON, 100000000n, plan);
        }, ApprovalPolicyViolationError);
    });

    await t.test('24. ERC20: Wrong spender address rejected for approval', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateApprovalSemantics(POLYGON_USDC, ATTACKER_ADDR, 100000000n, plan);
        }, ApprovalPolicyViolationError);
    });

    await t.test('25. ERC20: Unlimited (type(uint256).max) approval strictly prohibited', () => {
        const plan = createSamplePlan();
        const UINT256_MAX = (1n << 256n) - 1n;
        assert.throws(() => {
            validateApprovalSemantics(POLYGON_USDC, SPOKE_POOL_POLYGON, UINT256_MAX, plan);
        }, ApprovalPolicyViolationError);
    });

    await t.test('26. ERC20: Excessive approval exceeding 2x budget ceiling rejected', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateApprovalSemantics(POLYGON_USDC, SPOKE_POOL_POLYGON, 300000000n, plan);
        }, ApprovalPolicyViolationError);
    });

    await t.test('27. ERC20: Zero or negative approval amount rejected', () => {
        const plan = createSamplePlan();
        assert.throws(() => {
            validateApprovalSemantics(POLYGON_USDC, SPOKE_POOL_POLYGON, 0n, plan);
        }, ApprovalPolicyViolationError);
    });

    await t.test('28. ERC20: Target allowlist rejects unapproved arbitrary addresses', () => {
        assert.throws(() => {
            validateTargetAllowlist(ATTACKER_ADDR, 137);
        });
    });

    // =========================================================================
    // VI. SOURCE TRANSACTION RESULT & ON-CHAIN EVIDENCE (29 - 32)
    // =========================================================================

    await t.test('29. Source Execution: Reverted receipt (status=0) strictly rejected', () => {
        const revertedReceipt = {
            status: 0,
            transactionHash: '0xreverted_tx_001',
            blockNumber: 100000,
            logs: []
        };
        assert.throws(() => {
            validateReceiptSemantics(revertedReceipt);
        }, ReceiptSemanticError);
    });

    await t.test('30. Source Execution: Missing receipt fails closed without fabricated success', () => {
        assert.throws(() => {
            validateReceiptSemantics(null);
        }, ReceiptSemanticError);
    });

    await t.test('31. Source Execution: Receipt with status=1 but zero relevant events rejected', () => {
        const emptyLogsReceipt = {
            status: 1,
            transactionHash: '0xempty_logs_tx',
            blockNumber: 100000,
            logs: [
                {
                    address: '0x1234567890123456789012345678901234567890',
                    topics: ['0x0000000000000000000000000000000000000000000000000000000000000001'],
                    data: '0x'
                }
            ]
        };
        assert.throws(() => {
            validateReceiptSemantics(emptyLogsReceipt);
        }, ReceiptSemanticError);
    });

    await t.test('32. Source Execution: Gas limit exceeding safety ceiling or violating 120% margin rejected', () => {
        assert.throws(() => {
            validateGasSemantics(100000n, undefined, undefined, undefined, 100000n); // 100k limit < 120k min safe
        });
        assert.throws(() => {
            validateGasSemantics(50000000n); // > 30M limit ceiling
        });
    });

    // =========================================================================
    // VII. DESTINATION TRANSACTION & SETTLEMENT EVIDENCE (33 - 39)
    // =========================================================================

    await t.test('33. Destination: Wrong recipient address in settlement evidence rejected', () => {
        const receipt = {
            status: 1,
            blockNumber: 200000,
            transactionHash: '0xdest_tx_001',
            gasUsed: 50000n,
            logs: [
                {
                    address: ARBITRUM_USDC,
                    topics: [
                        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                        '0x000000000000000000000000' + SPOKE_POOL_POLYGON.slice(2),
                        '0x000000000000000000000000' + ATTACKER_ADDR.slice(2) // Wrong recipient
                    ],
                    data: '0x0000000000000000000000000000000000000000000000000000000005f5e100' // 100 USDC
                }
            ]
        };

        const result = verifyDestinationSettlement({
            destinationChainId: 42161,
            destinationTxHash: '0xdest_tx_001',
            expectedRecipient: USER_ADDR,
            expectedToken: ARBITRUM_USDC,
            expectedMinAmountRaw: '99500000',
            receipt: receipt as any,
            currentBlockNumber: 200010
        });

        assert.notEqual(result.settlementStatus, 'DESTINATION_SETTLED');
        assert.equal(result.deliveredToExpectedRecipient, false);
    });

    await t.test('34. Destination: Wrong token address in settlement evidence rejected', () => {
        const receipt = {
            status: 1,
            blockNumber: 200000,
            transactionHash: '0xdest_tx_002',
            gasUsed: 50000n,
            logs: [
                {
                    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH instead of USDC
                    topics: [
                        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                        '0x000000000000000000000000' + SPOKE_POOL_POLYGON.slice(2),
                        '0x000000000000000000000000' + USER_ADDR.slice(2)
                    ],
                    data: '0x0000000000000000000000000000000000000000000000000000000005f5e100'
                }
            ]
        };

        const result = verifyDestinationSettlement({
            destinationChainId: 42161,
            destinationTxHash: '0xdest_tx_002',
            expectedRecipient: USER_ADDR,
            expectedToken: ARBITRUM_USDC,
            expectedMinAmountRaw: '99500000',
            receipt: receipt as any,
            currentBlockNumber: 200010
        });

        assert.notEqual(result.settlementStatus, 'DESTINATION_SETTLED');
        assert.equal(result.tokenMatched, false);
    });

    await t.test('35. Destination: Insufficient delivered amount below minimum output rejected', () => {
        const receipt = {
            status: 1,
            blockNumber: 200000,
            transactionHash: '0xdest_tx_003',
            gasUsed: 50000n,
            logs: [
                {
                    address: ARBITRUM_USDC,
                    topics: [
                        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                        '0x000000000000000000000000' + SPOKE_POOL_POLYGON.slice(2),
                        '0x000000000000000000000000' + USER_ADDR.slice(2)
                    ],
                    data: '0x00000000000000000000000000000000000000000000000000000000055d4a80' // 90 USDC < 99.5 USDC min
                }
            ]
        };

        const result = verifyDestinationSettlement({
            destinationChainId: 42161,
            destinationTxHash: '0xdest_tx_003',
            expectedRecipient: USER_ADDR,
            expectedToken: ARBITRUM_USDC,
            expectedMinAmountRaw: '99500000',
            receipt: receipt as any,
            currentBlockNumber: 200010
        });

        assert.notEqual(result.settlementStatus, 'DESTINATION_SETTLED');
    });

    await t.test('36. Destination: Missing pre-bridge balance provenance fails closed', () => {
        const result = verifyDestinationSettlement({
            destinationChainId: 42161,
            expectedRecipient: USER_ADDR,
            expectedToken: ARBITRUM_USDC,
            expectedMinAmountRaw: '99500000',
            currentBalanceRaw: '100000000',
            // preBridgeBalanceRaw is intentionally omitted
            receipt: null
        });

        assert.notEqual(result.settlementStatus, 'DESTINATION_SETTLED');
        assert.equal(
            result.evidences.find((e) => e.tier === 'TIER_4_RECIPIENT_BALANCE_DELTA')?.status,
            'UNAVAILABLE'
        );
    });

    await t.test('37. Destination: Unrelated successful transaction on same chain rejected', () => {
        const unrelatedReceipt = {
            status: 1,
            blockNumber: 200000,
            transactionHash: '0xdest_unrelated_001',
            gasUsed: 21000n,
            logs: []
        };

        const result = verifyDestinationSettlement({
            destinationChainId: 42161,
            destinationTxHash: '0xdest_unrelated_001',
            expectedRecipient: USER_ADDR,
            expectedToken: ARBITRUM_USDC,
            expectedMinAmountRaw: '99500000',
            receipt: unrelatedReceipt as any
        });

        assert.notEqual(result.settlementStatus, 'DESTINATION_SETTLED');
    });

    await t.test('38. Destination: Provider API response cannot override on-chain transfer deficit', () => {
        const monitor = new CompositeSettlementMonitoringEngine();
        const intent = {
            intentId: 'intent-001',
            userAddress: USER_ADDR,
            recipient: USER_ADDR,
            sourceChainId: 137,
            destinationChainId: 42161,
            inputToken: { symbol: 'USDC', address: POLYGON_USDC, decimals: 6 },
            requestedOutputToken: { symbol: 'USDC', address: ARBITRUM_USDC, decimals: 6 },
            inputAmountRaw: 100000000n,
            minimumOutputRaw: 99500000n,
            routeType: 'DIRECT_CROSS_CHAIN' as const,
            bridgeProvider: 'across',
            createdAt: Date.now()
        };
        monitor.registerIntent(intent);
        monitor.recordBridgeProviderProgress({
            intentId: 'intent-001',
            providerState: 'FILLED',
            providerFillTx: '0xprovider_claimed_tx'
        });

        // Destination receipt has status=0 (reverted on-chain)
        const record = monitor.reconcileDestinationSettlement({
            intentId: 'intent-001',
            destinationTxHash: '0xprovider_claimed_tx',
            receipt: {
                status: 0,
                blockNumber: 200000,
                logs: []
            },
            currentBlockNumber: 200010,
            requiredConfirmations: 1
        });

        assert.equal(record.overallState, 'RECONCILIATION_BLOCKED');
        assert.equal(record.settlementState, 'SETTLEMENT_BLOCKED');
    });

    await t.test('39. Destination: Local cache cannot finalize settlement without on-chain proof', () => {
        const monitor = new CompositeSettlementMonitoringEngine();
        const intent = {
            intentId: 'intent-002',
            userAddress: USER_ADDR,
            recipient: USER_ADDR,
            sourceChainId: 137,
            destinationChainId: 42161,
            inputToken: { symbol: 'USDC', address: POLYGON_USDC, decimals: 6 },
            requestedOutputToken: { symbol: 'USDC', address: ARBITRUM_USDC, decimals: 6 },
            inputAmountRaw: 100000000n,
            minimumOutputRaw: 99500000n,
            routeType: 'DIRECT_CROSS_CHAIN' as const,
            bridgeProvider: 'across',
            createdAt: Date.now()
        };
        monitor.registerIntent(intent);

        const record = monitor.reconcileDestinationSettlement({
            intentId: 'intent-002',
            destinationTxHash: undefined,
            receipt: null,
            currentBlockNumber: 200010,
            requiredConfirmations: 1
        });

        assert.notEqual(record.settlementState, 'SETTLED');
        assert.equal(record.overallState, 'DESTINATION_CONFIRMING');
    });

    // =========================================================================
    // VIII. FINALITY GATING & REORG SAFETY (40 - 42)
    // =========================================================================

    await t.test('40. Finality: Insufficient confirmations remain pending and cannot SETTLE', () => {
        const monitor = new CompositeSettlementMonitoringEngine();
        const intent = {
            intentId: 'intent-003',
            userAddress: USER_ADDR,
            recipient: USER_ADDR,
            sourceChainId: 137,
            destinationChainId: 42161,
            inputToken: { symbol: 'USDC', address: POLYGON_USDC, decimals: 6 },
            requestedOutputToken: { symbol: 'USDC', address: ARBITRUM_USDC, decimals: 6 },
            inputAmountRaw: 100000000n,
            minimumOutputRaw: 99500000n,
            routeType: 'DIRECT_CROSS_CHAIN' as const,
            bridgeProvider: 'across',
            createdAt: Date.now()
        };
        monitor.registerIntent(intent);

        const record = monitor.reconcileDestinationSettlement({
            intentId: 'intent-003',
            destinationTxHash: '0xdest_tx_depth',
            receipt: {
                status: 1,
                blockNumber: 100,
                logs: [
                    {
                        address: ARBITRUM_USDC,
                        topics: [
                            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                            '0x000000000000000000000000' + SPOKE_POOL_POLYGON.slice(2),
                            '0x000000000000000000000000' + USER_ADDR.slice(2)
                        ],
                        data: '0x0000000000000000000000000000000000000000000000000000000005f5e100'
                    }
                ]
            },
            currentBlockNumber: 102, // 2 confirmations < 12 required
            requiredConfirmations: 12
        });

        assert.notEqual(record.settlementState, 'SETTLED');
        assert.equal(record.finalityState, 'FINALITY_PENDING');
    });

    await t.test('41. Finality: Reorg detection invalidates stale settlement evidence', () => {
        const monitor = new CompositeSettlementMonitoringEngine();
        const intent = {
            intentId: 'intent-004',
            userAddress: USER_ADDR,
            recipient: USER_ADDR,
            sourceChainId: 137,
            destinationChainId: 42161,
            inputToken: { symbol: 'USDC', address: POLYGON_USDC, decimals: 6 },
            requestedOutputToken: { symbol: 'USDC', address: ARBITRUM_USDC, decimals: 6 },
            inputAmountRaw: 100000000n,
            minimumOutputRaw: 99500000n,
            routeType: 'DIRECT_CROSS_CHAIN' as const,
            bridgeProvider: 'across',
            createdAt: Date.now()
        };
        monitor.registerIntent(intent);

        const record = monitor.reconcileDestinationSettlement({
            intentId: 'intent-004',
            destinationTxHash: '0xreorged_tx',
            receipt: {
                status: 1,
                blockNumber: 150,
                blockHash: '0xstale_block_hash',
                logs: []
            },
            currentBlockNumber: 140, // current < receipt => reorg detected
            requiredConfirmations: 6
        });

        assert.equal(record.reorgDetected, true);
        assert.equal(record.finalityState, 'REORG_DETECTED');
        assert.equal(record.overallState, 'RECONCILIATION_BLOCKED');
    });

    await t.test('42. Finality: Finality cannot be asserted from missing block data', () => {
        const monitor = new CompositeSettlementMonitoringEngine();
        const intent = {
            intentId: 'intent-005',
            userAddress: USER_ADDR,
            recipient: USER_ADDR,
            sourceChainId: 137,
            destinationChainId: 42161,
            inputToken: { symbol: 'USDC', address: POLYGON_USDC, decimals: 6 },
            requestedOutputToken: { symbol: 'USDC', address: ARBITRUM_USDC, decimals: 6 },
            inputAmountRaw: 100000000n,
            minimumOutputRaw: 99500000n,
            routeType: 'DIRECT_CROSS_CHAIN' as const,
            bridgeProvider: 'across',
            createdAt: Date.now()
        };
        monitor.registerIntent(intent);

        const record = monitor.reconcileDestinationSettlement({
            intentId: 'intent-005',
            destinationTxHash: '0xmissing_block_tx',
            receipt: null,
            currentBlockNumber: 0,
            requiredConfirmations: 6
        });

        assert.notEqual(record.settlementState, 'SETTLED');
    });

    // =========================================================================
    // IX. DATABASE & PERSISTENCE EVIDENCE INTEGRITY (43 - 45)
    // =========================================================================

    await t.test('43. Persistence: Database-only update without authoritative evidence cannot create verified settlement', async () => {
        const repo = new SQLiteCrossChainStateRepository(':memory:');
        const plan = createSamplePlan();

        const intent: PersistentIntent = {
            intentId: plan.planId,
            userAddress: USER_ADDR,
            recipientAddress: USER_ADDR,
            sourceChainId: 137,
            destinationChainId: 42161,
            sourceTokenAddress: POLYGON_USDC,
            sourceTokenSymbol: 'USDC',
            destinationTokenAddress: ARBITRUM_USDC,
            destinationTokenSymbol: 'USDC',
            amountInRaw: '100000000',
            expectedAmountOutRaw: '99800000',
            minAmountOutRaw: '99500000',
            provider: 'across',
            routeId: plan.routeId,
            deadline: Date.now() + 3600000,
            slippageBps: 50,
            nonce: 1,
            status: 'PENDING',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        await repo.createIntent(intent);

        // Attempting to record an unverified settlement row
        await repo.recordSettlement({
            intentId: plan.planId,
            destinationChainId: '42161',
            tokenAddress: ARBITRUM_USDC,
            tokenSymbol: 'USDC',
            recipient: USER_ADDR,
            expectedAmountRaw: '99500000',
            actualAmountRaw: '0',
            verified: false,
            verifiedAt: null,
            destinationTxHash: '0xpending_dest_tx_001'
        });

        const stored = await repo.getSettlement(plan.planId);
        assert.ok(stored);
        assert.equal(stored.verified, false, 'Unverified settlement in DB must remain verified=false');
    });

    await t.test('44. Persistence: Regression of verified settlement to unverified is prevented', async () => {
        const repo = new SQLiteCrossChainStateRepository(':memory:');
        const plan = createSamplePlan();

        const intent: PersistentIntent = {
            intentId: plan.planId,
            userAddress: USER_ADDR,
            recipientAddress: USER_ADDR,
            sourceChainId: 137,
            destinationChainId: 42161,
            sourceTokenAddress: POLYGON_USDC,
            sourceTokenSymbol: 'USDC',
            destinationTokenAddress: ARBITRUM_USDC,
            destinationTokenSymbol: 'USDC',
            amountInRaw: '100000000',
            expectedAmountOutRaw: '99800000',
            minAmountOutRaw: '99500000',
            provider: 'across',
            routeId: plan.routeId,
            deadline: Date.now() + 3600000,
            slippageBps: 50,
            nonce: 1,
            status: 'PENDING',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        await repo.createIntent(intent);

        await repo.recordSettlement({
            intentId: plan.planId,
            destinationChainId: '42161',
            tokenAddress: ARBITRUM_USDC,
            tokenSymbol: 'USDC',
            recipient: USER_ADDR,
            expectedAmountRaw: '99500000',
            actualAmountRaw: '100000000',
            verified: true,
            verifiedAt: Date.now(),
            destinationTxHash: '0xauthoritative_verified_dest_tx'
        });

        // Attempt to regress verified settlement to unverified
        await repo.recordSettlement({
            intentId: plan.planId,
            destinationChainId: '42161',
            tokenAddress: ARBITRUM_USDC,
            tokenSymbol: 'USDC',
            recipient: USER_ADDR,
            expectedAmountRaw: '99500000',
            actualAmountRaw: '0',
            verified: false,
            verifiedAt: null,
            destinationTxHash: '0xunverified_attempt_tx'
        });

        const retrieved = await repo.getSettlement(plan.planId);
        assert.ok(retrieved);
        assert.equal(retrieved.verified, true, 'Verified settlement record cannot be silently overwritten by unverified data');
    });

    await t.test('45. Persistence: Invalid transaction state transition from CREATED directly to CONFIRMED is rejected', async () => {
        const repo = new SQLiteCrossChainStateRepository(':memory:');
        const plan = createSamplePlan();
        await repo.saveExecutionPlan(plan);

        const txRecord: PersistentTransaction = {
            transactionId: 'tx_001',
            planId: plan.planId,
            stepId: plan.steps[0].id,
            chainId: '137',
            state: 'CREATED',
            fromAddress: USER_ADDR,
            toAddress: SPOKE_POOL_POLYGON,
            calldata: '0x1234',
            valueWei: '0',
            nonce: 10,
            gasLimit: '100000',
            createdAt: Date.now()
        };
        await repo.createTransaction(txRecord);

        // Attempt to jump from CREATED directly to CONFIRMED without preflight/broadcast
        await assert.rejects(async () => {
            await repo.updateTransaction('tx_001', {
                state: 'CONFIRMED'
            });
        }, /INVALID_STATE_TRANSITION/);
    });

    // =========================================================================
    // X. PROPERTY & FUZZ TESTING INVARIANTS (Section 22)
    // =========================================================================

    await t.test('46. Property Fuzz: Any security-critical mutation of ExecutionPlan alters integrity hash', () => {
        const basePlan = createSamplePlan();
        const baseHash = computeExecutionPlanHash(basePlan);

        const mutationVectors = [
            (p: any) => { p.recipient = '0x1111111111111111111111111111111111111112'; },
            (p: any) => { p.sourceChainId = '10'; },
            (p: any) => { p.destinationChainId = '8453'; },
            (p: any) => { p.expectedAmountInRaw = '99999999'; },
            (p: any) => { p.minimumAmountOutRaw = '98000000'; },
            (p: any) => { p.calldata = p.calldata + 'ff'; },
            (p: any) => { p.executionTarget = '0x0000000000000000000000000000000000000009'; },
            (p: any) => { p.approvalTarget = '0x0000000000000000000000000000000000000008'; },
            (p: any) => { p.selectedProvider = 'stargate'; },
            (p: any) => { p.selectedDex = 'curve'; },
            (p: any) => { p.tokenIn = { ...p.tokenIn, address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' }; },
            (p: any) => { p.tokenOut = { ...p.tokenOut, address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' }; },
            (p: any) => { p.steps[0].requiredAmountRaw = '50000000'; },
            (p: any) => { p.steps[1].calldata = '0x9999'; }
        ];

        for (let i = 0; i < mutationVectors.length; i++) {
            const mutatedPlan = JSON.parse(JSON.stringify(basePlan));
            mutationVectors[i](mutatedPlan);
            const mutatedHash = computeExecutionPlanHash(mutatedPlan);
            assert.notEqual(
                baseHash,
                mutatedHash,
                `Mutation vector ${i + 1} failed to alter execution plan integrity hash`
            );
        }
    });

    await t.test('47. Property Fuzz: Canonical serialization is key-ordering invariant', () => {
        const obj1 = { b: 2, a: 1, c: { z: 10, y: 20 } };
        const obj2 = { c: { y: 20, z: 10 }, a: 1, b: 2 };

        const str1 = canonicalStringify(obj1);
        const str2 = canonicalStringify(obj2);

        assert.equal(str1, str2, 'Canonical serialization must be strictly invariant to object key ordering');
        assert.equal(str1, '{"a":1,"b":2,"c":{"y":20,"z":10}}');
    });

    await t.test('48. End-to-End Pipeline: Complete 17-stage lifecycle executes with cryptographic and logical consistency', async () => {
        const pipeline = new ExecutionIntegrationPipeline();
        const intent = createSampleIntent();
        const plan = createSamplePlan();

        const depositTx: CanonicalTransactionPayload = {
            chainId: 137,
            to: plan.executionTarget!,
            data: plan.calldata!,
            value: '0'
        };

        const result = await pipeline.executePipeline({
            intent,
            plan,
            transaction: depositTx,
            sourceReceipt: {
                status: 1,
                blockNumber: 94120000,
                transactionHash: '0xsource_e2e_tx',
                gasUsed: 120000n,
                logs: [
                    {
                        address: POLYGON_USDC,
                        topics: [
                            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                            '0x000000000000000000000000' + USER_ADDR.slice(2),
                            '0x000000000000000000000000' + SPOKE_POOL_POLYGON.slice(2)
                        ],
                        data: '0x0000000000000000000000000000000000000000000000000000000005f5e100'
                    }
                ]
            },
            destReceipt: {
                status: 1,
                blockNumber: 250000000,
                transactionHash: '0xdest_e2e_tx',
                gasUsed: 65000n,
                logs: [
                    {
                        address: ARBITRUM_USDC,
                        topics: [
                            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                            '0x000000000000000000000000' + SPOKE_POOL_POLYGON.slice(2),
                            '0x000000000000000000000000' + USER_ADDR.slice(2)
                        ],
                        data: '0x0000000000000000000000000000000000000000000000000000000005f5e100'
                    }
                ]
            },
            currentBlockNumber: 250000030
        });

        assert.equal(result.success, true);
        assert.equal(result.stages.length, 17);
        for (const stage of result.stages) {
            assert.ok(stage.status === 'PASS' || stage.status === 'SKIPPED');
        }
    });
});
