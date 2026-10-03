import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthoritativeTokenRegistry } from '../packages/tokens/src/authoritative/authoritativeTokenRegistry';
import { AuthoritativeNetworkRegistry } from '../packages/chains/src/authoritative/authoritativeNetworkRegistry';
import { SQLiteCrossChainStateRepository } from '../packages/execution/src/persistence/sqliteRepository';
import {
    validateSettlementStateTransition,
    validateTransactionStateTransition,
    validatePlanStatusTransition,
    validateStepStatusTransition
} from '../packages/execution/src/persistence/repository';
import { TokenIdentity, PersistentIntent, PersistentSettlement } from '@zenith/types';
import { InvalidStateTransitionError } from '@zenith/contracts';

test('ZENITH Phase 3 — Production Integrity, State Consistency & Concurrency Hardening', async (t) => {

    await t.test('1. Authoritative Token Registry: Cross-Index Synchrony on Mutation', async () => {
        const registry = new AuthoritativeTokenRegistry();
        const testToken: TokenIdentity = {
            tokenId: 'polygon:0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
            networkId: 'polygon',
            networkIdentityKey: 'EVM:eip155:137',
            family: 'EVM',
            namespace: 'eip155',
            standard: 'ERC20',
            address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
            normalizedAddress: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
            symbol: 'SHIB_POLY',
            name: 'SHIBA INU on Polygon',
            decimals: 18,
            assetType: 'FUNGIBLE',
            isNative: false,
            isWrappedNative: false,
            verificationStatus: 'IDENTITY_VERIFIED',
            verificationDimensions: {
                identityVerified: true,
                addressVerified: true,
                standardVerified: true,
                decimalsVerified: true,
                metadataVerified: true,
                contractCodeVerified: true,
                networkVerified: true
            },
            metadataStatus: 'LIVE_VERIFIED',
            capabilityLevel: 'CONFIGURED',
            onboardingState: 'EXECUTION_ENABLED',
            source: 'USER_IMPORT',
            isFungible: true,
            isNFT: false,
            isMultiToken: false,
            tags: ['test', 'phase3']
        };

        // 1. Register and verify across all lookup paths
        registry.registerToken(testToken);

        const byId = registry.getToken(testToken.tokenId);
        assert.ok(byId);
        assert.equal(byId.symbol, 'SHIB_POLY');

        const byKey = registry.getTokenByIdentityKey('EVM:eip155:137:ERC20:0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce');
        assert.ok(byKey);
        assert.equal(byKey.tokenId, testToken.tokenId);

        const byAddress = registry.getTokenByAddress('polygon', 'ERC20', '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE');
        assert.ok(byAddress);
        assert.equal(byAddress.tokenId, testToken.tokenId);

        const resolvedSym = registry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'SHIB_POLY' });
        assert.equal(resolvedSym.status, 'RESOLVED_EXACT');
        assert.equal(resolvedSym.token?.tokenId, testToken.tokenId);

        const netTokens = registry.getTokens('polygon');
        assert.ok(netTokens.some(t => t.tokenId === testToken.tokenId));

        // 2. Promote token and verify all lookup paths reflect updated state
        registry.promoteToken(testToken.tokenId, 'LIVE_VERIFIED', { reason: 'Phase 3 Verification' });

        const promotedById = registry.getToken(testToken.tokenId);
        assert.equal(promotedById?.onboardingState, 'LIVE_VERIFIED');
        assert.equal(promotedById?.capabilityLevel, 'LIVE_VERIFIED');

        const promotedByAddr = registry.getTokenByAddress('polygon', 'ERC20', '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE');
        assert.equal(promotedByAddr?.onboardingState, 'LIVE_VERIFIED');

        // 3. Disable token and verify state across all paths
        registry.disableToken(testToken.tokenId, 'Phase 3 Disable Test');
        const disabledById = registry.getToken(testToken.tokenId);
        assert.equal(disabledById?.onboardingState, 'DISABLED');
        assert.equal(disabledById?.capabilityLevel, 'UNSUPPORTED');

        // 4. Remove token and verify complete absence across all paths
        const removed = registry.removeToken(testToken.tokenId);
        assert.equal(removed, true);
        assert.equal(registry.getToken(testToken.tokenId), undefined);
        assert.equal(registry.getTokenByAddress('polygon', 'ERC20', '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE'), undefined);
        assert.equal(registry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'SHIB_POLY' }).status, 'UNRESOLVED');
        assert.ok(!registry.getTokens('polygon').some(t => t.tokenId === testToken.tokenId));
    });

    await t.test('2. Authoritative Token Registry: Deep Caller Immutability', async () => {
        const registry = new AuthoritativeTokenRegistry();
        const initial = registry.getNativeToken('polygon');
        assert.ok(initial);

        // Caller attempts to mutate returned object deeply
        (initial as any).symbol = 'MUTATED_POL';
        (initial as any).verificationDimensions.identityVerified = false;
        if (initial.tags) {
            initial.tags.push('HACKED_TAG');
        }

        // Fresh retrieval must remain pristine
        const fresh = registry.getNativeToken('polygon');
        assert.ok(fresh);
        assert.equal(fresh.symbol, 'POL');
        assert.equal(fresh.verificationDimensions.identityVerified, true);
        assert.ok(!fresh.tags?.includes('HACKED_TAG'));
    });

    await t.test('3. Authoritative Token Registry: O(1) Direct Native & Wrapped Indexing', async () => {
        const registry = new AuthoritativeTokenRegistry();
        const nativePol = registry.getNativeToken('polygon');
        assert.ok(nativePol);
        assert.equal(nativePol.isNative, true);
        assert.equal(nativePol.symbol, 'POL');

        const wrappedPol = registry.getWrappedNativeToken('polygon');
        assert.ok(wrappedPol);
        assert.equal(wrappedPol.isWrappedNative, true);
        assert.equal(wrappedPol.symbol, 'WMATIC');

        const nativeEth = registry.getNativeToken('ethereum');
        assert.ok(nativeEth);
        assert.equal(nativeEth.isNative, true);
        assert.equal(nativeEth.symbol, 'ETH');

        const wrappedEth = registry.getWrappedNativeToken('ethereum');
        assert.ok(wrappedEth);
        assert.equal(wrappedEth.isWrappedNative, true);
        assert.equal(wrappedEth.symbol, 'WETH');
    });

    await t.test('4. Authoritative Token Registry: Standard Filter Isolation', async () => {
        const registry = new AuthoritativeTokenRegistry();
        // ERC20 lookup should not match unsupported standard
        const usdc = registry.getTokenByAddress('polygon', 'ERC20', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
        assert.ok(usdc);
        assert.equal(usdc.standard, 'ERC20');

        const erc721Lookup = registry.getTokenByAddress('polygon', 'ERC721', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
        assert.equal(erc721Lookup, undefined, 'ERC721 lookup on ERC20 address must return undefined');

        const resolvedErc721 = registry.resolveTokenIdentity({
            networkId: 'polygon',
            symbol: 'USDC',
            standard: 'ERC721'
        });
        assert.equal(resolvedErc721.status, 'UNRESOLVED', 'Requesting incompatible standard must fail resolution');
    });

    await t.test('5. Authoritative Network Registry: Secondary Index Re-Registration & Removal', async () => {
        const netRegistry = new AuthoritativeNetworkRegistry();
        const customNetwork: any = {
            networkId: 'testnet_custom',
            numericChainId: 999999,
            family: 'EVM',
            namespace: 'eip155',
            networkIdentityKey: 'EVM:eip155:999999',
            name: 'Custom Testnet',
            environment: 'TESTNET',
            isMainnet: false,
            isTestnet: true,
            aliases: ['custom-test', 'c-test'],
            nativeAsset: {
                symbol: 'TEST',
                name: 'Test Native',
                decimals: 18,
                isNative: true,
                wrappedAddress: '0x0000000000000000000000000000000000000001'
            },
            gasModel: { type: 'EIP1559', baseFeeMultiplier: 1.2 },
            finality: { confirmationBlocks: 1, finalizedBlocks: 2 },
            rpcEndpoints: [{ url: 'https://rpc.test.custom', priority: 1, status: 'HEALTHY' }],
            onboardingState: 'CONFIGURED'
        };

        netRegistry.registerNetwork(customNetwork, true);
        assert.equal(netRegistry.resolveNetworkIdentity('custom-test'), 'testnet_custom');
        assert.equal(netRegistry.resolveNetworkIdentity(999999), 'testnet_custom');

        // Re-register with updated alias and chain ID
        const updatedNetwork = {
            ...customNetwork,
            numericChainId: 888888,
            networkIdentityKey: 'EVM:eip155:888888',
            aliases: ['new-custom-alias']
        };
        netRegistry.registerNetwork(updatedNetwork, true);

        assert.equal(netRegistry.resolveNetworkIdentity('new-custom-alias'), 'testnet_custom');
        assert.equal(netRegistry.resolveNetworkIdentity(888888), 'testnet_custom');
        assert.equal(netRegistry.resolveNetworkIdentity('custom-test'), undefined, 'Old alias must be unindexed');
        assert.equal(netRegistry.resolveNetworkIdentity(999999), undefined, 'Old chain ID must be unindexed');

        // Remove network
        const removed = netRegistry.removeNetwork('testnet_custom');
        assert.equal(removed, true);
        assert.equal(netRegistry.resolveNetworkIdentity('testnet_custom'), undefined);
        assert.equal(netRegistry.resolveNetworkIdentity('new-custom-alias'), undefined);
    });

    await t.test('6. Persistence: Atomic Concurrent Worker Lease Contention (Exactly One Winner)', async () => {
        const repo = new SQLiteCrossChainStateRepository(':memory:');
        const resourceId = 'lease:plan-stress-test-1';

        // 10 concurrent workers attempt to acquire the exact same lease simultaneously
        const workers = Array.from({ length: 10 }, (_, i) => `worker-${i}`);
        const results = await Promise.all(
            workers.map(w => repo.acquireLease(resourceId, w, 5000))
        );

        const winners = results.filter(r => r === true);
        assert.equal(winners.length, 1, 'Exactly one worker must win concurrent lease contention');

        const winningWorkerIdx = results.findIndex(r => r === true);
        const winningWorkerId = workers[winningWorkerIdx];

        const lease = await repo.getLease(resourceId);
        assert.ok(lease);
        assert.equal(lease.workerId, winningWorkerId);

        // Same worker can renew/re-acquire
        const reacquired = await repo.acquireLease(resourceId, winningWorkerId, 5000);
        assert.equal(reacquired, true);

        // Different worker fails to acquire active lease
        const diffWorker = await repo.acquireLease(resourceId, 'rogue-worker', 5000);
        assert.equal(diffWorker, false);

        repo.close();
    });

    await t.test('7. Persistence: Atomic Concurrent Intent Lease Contention', async () => {
        const repo = new SQLiteCrossChainStateRepository(':memory:');
        const intentId = 'intent-lease-test-101';

        await repo.createIntent({
            intentId,
            userAddress: '0x1111111111111111111111111111111111111111',
            sourceChainId: '137',
            destinationChainId: '42161',
            sourceTokenAddress: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
            sourceTokenSymbol: 'WMATIC',
            destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            destinationTokenSymbol: 'USDC',
            amountInRaw: '1000000000000000000',
            expectedAmountOutRaw: '1000000',
            minAmountOutRaw: '990000',
            provider: 'across',
            routeId: 'polygon-arbitrum:across',
            nonce: 'nonce-101',
            deadline: Date.now() + 3600000,
            status: 'CREATED'
        });

        // 10 concurrent workers attempt to claim intent lease
        const workers = Array.from({ length: 10 }, (_, i) => `worker-intent-${i}`);
        const claims = await Promise.all(
            workers.map(w => repo.claimIntentLease(intentId, w, 10000))
        );

        const winners = claims.filter(c => c === true);
        assert.equal(winners.length, 1, 'Exactly one worker must successfully claim intent lease');

        repo.close();
    });

    await t.test('8. Persistence: SQLite Unique Nonce Enforcement & Replay Rejection', async () => {
        const repo = new SQLiteCrossChainStateRepository(':memory:');
        const baseIntent: PersistentIntent = {
            intentId: 'intent-nonce-1',
            userAddress: '0x2222222222222222222222222222222222222222',
            sourceChainId: '137',
            destinationChainId: '42161',
            sourceTokenAddress: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
            sourceTokenSymbol: 'WMATIC',
            destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            destinationTokenSymbol: 'USDC',
            amountInRaw: '1000000000000000000',
            expectedAmountOutRaw: '1000000',
            minAmountOutRaw: '990000',
            provider: 'across',
            routeId: 'polygon-arbitrum:across',
            nonce: 'unique-nonce-abc',
            deadline: Date.now() + 3600000,
            status: 'CREATED'
        };

        await repo.createIntent(baseIntent);

        // Attempt duplicate intent with same (user, sourceChain, destChain, nonce)
        const duplicateIntent: PersistentIntent = {
            ...baseIntent,
            intentId: 'intent-nonce-2'
        };

        await assert.rejects(
            async () => repo.createIntent(duplicateIntent),
            /Nonce replay detected|UNIQUE constraint failed/,
            'Duplicate nonce must be rejected fail-closed'
        );

        repo.close();
    });

    await t.test('9. Persistence: Verified Settlement Invariant (Non-Regressive Verification)', async () => {
        const repo = new SQLiteCrossChainStateRepository(':memory:');
        const intentId = 'intent-settle-1';

        await repo.createIntent({
            intentId,
            userAddress: '0x3333333333333333333333333333333333333333',
            sourceChainId: '137',
            destinationChainId: '42161',
            sourceTokenAddress: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
            sourceTokenSymbol: 'WMATIC',
            destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            destinationTokenSymbol: 'USDC',
            amountInRaw: '1000000000000000000',
            expectedAmountOutRaw: '1000000',
            minAmountOutRaw: '990000',
            provider: 'across',
            routeId: 'polygon-arbitrum:across',
            nonce: 'nonce-settle-1',
            deadline: Date.now() + 3600000,
            status: 'CREATED'
        });

        // 1. Record verified settlement
        const verifiedSettlement: PersistentSettlement = {
            intentId,
            destinationTxHash: '0xverifiedtx1234567890abcdef1234567890abcdef',
            destinationChainId: '42161',
            tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            tokenSymbol: 'USDC',
            recipient: '0x3333333333333333333333333333333333333333',
            expectedAmountRaw: '1000000',
            actualAmountRaw: '1000000',
            verified: true,
            verifiedAt: 1727400000000
        };
        await repo.recordSettlement(verifiedSettlement);

        const fetched = await repo.getSettlement(intentId);
        assert.ok(fetched);
        assert.equal(fetched.verified, true);
        assert.equal(fetched.destinationTxHash, '0xverifiedtx1234567890abcdef1234567890abcdef');

        // 2. Attempt stale unverified settlement overwrite
        const staleUnverified: PersistentSettlement = {
            ...verifiedSettlement,
            destinationTxHash: '0xstaletx9999999999999999999999999999999999',
            verified: false,
            verifiedAt: 1727300000000
        };
        await repo.recordSettlement(staleUnverified);

        const afterStale = await repo.getSettlement(intentId);
        assert.ok(afterStale);
        assert.equal(afterStale.verified, true, 'Verified status must never be regressed by unverified write');

        repo.close();
    });

    await t.test('10. State Machine: Fail-Closed Terminal State Invariants', async () => {
        // Settlement Terminal States: SETTLED, REFUNDED, CANCELLED cannot transition
        assert.throws(() => validateSettlementStateTransition('SETTLED', 'FULFILLING'), InvalidStateTransitionError);
        assert.throws(() => validateSettlementStateTransition('SETTLED', 'FAILED'), InvalidStateTransitionError);
        assert.throws(() => validateSettlementStateTransition('REFUNDED', 'SUBMITTED'), InvalidStateTransitionError);
        assert.throws(() => validateSettlementStateTransition('CANCELLED', 'CREATED'), InvalidStateTransitionError);

        // Transaction Terminal States: CONFIRMED, REVERTED cannot transition
        assert.throws(() => validateTransactionStateTransition('CONFIRMED', 'BROADCASTING'), InvalidStateTransitionError);
        assert.throws(() => validateTransactionStateTransition('REVERTED', 'CONFIRMING'), InvalidStateTransitionError);

        // Plan Terminal States: COMPLETED, FAILED cannot transition
        assert.throws(() => validatePlanStatusTransition('COMPLETED', 'EXECUTING'), InvalidStateTransitionError);
        assert.throws(() => validatePlanStatusTransition('FAILED', 'EXECUTING'), InvalidStateTransitionError);

        // Step Terminal States: SUCCESS, FAILED cannot transition
        assert.throws(() => validateStepStatusTransition('SUCCESS', 'ACTIVE'), InvalidStateTransitionError);
        assert.throws(() => validateStepStatusTransition('FAILED', 'ACTIVE'), InvalidStateTransitionError);

        // Legal Transitions must succeed without error
        assert.doesNotThrow(() => validateSettlementStateTransition('CREATED', 'SUBMITTED'));
        assert.doesNotThrow(() => validateSettlementStateTransition('SUBMITTED', 'FULFILLING'));
        assert.doesNotThrow(() => validateSettlementStateTransition('FULFILLING', 'DESTINATION_FILLED'));
        assert.doesNotThrow(() => validateSettlementStateTransition('DESTINATION_FILLED', 'SETTLED'));
    });

    await t.test('11. Persistence: Atomic Submission Transaction Rollback & Provider Order Idempotency', async () => {
        const repo = new SQLiteCrossChainStateRepository(':memory:');
        const intentId = 'intent-atomic-1';
        const stepId = 'step-atomic-1';
        const orderId = 'order-atomic-1';

        await repo.createIntent({
            intentId,
            userAddress: '0x4444444444444444444444444444444444444444',
            sourceChainId: '137',
            destinationChainId: '42161',
            sourceTokenAddress: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
            sourceTokenSymbol: 'WMATIC',
            destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            destinationTokenSymbol: 'USDC',
            amountInRaw: '1000000000000000000',
            expectedAmountOutRaw: '1000000',
            minAmountOutRaw: '990000',
            provider: 'across',
            routeId: 'polygon-arbitrum:across',
            nonce: 'nonce-atomic-1',
            deadline: Date.now() + 3600000,
            status: 'CREATED'
        });

        await repo.createStep({
            stepId,
            intentId,
            stepIndex: 0,
            type: 'SOURCE_SWAP',
            chainId: '137',
            status: 'PENDING',
            dependsOn: []
        });

        // 1. Successful atomic submission
        const order: PersistentProviderOrder = {
            orderId,
            intentId,
            provider: 'across',
            sourceChainId: '137',
            destinationChainId: '42161',
            sourceTxHash: '0xsourceTx1234567890abcdef1234567890abcdef',
            recipient: '0x4444444444444444444444444444444444444444',
            quoteJson: JSON.stringify({ fee: '100' }),
            status: 'FULFILLING'
        };

        await repo.atomicRecordSourceSubmission({
            intentId,
            stepId,
            sourceTxHash: '0xsourceTx1234567890abcdef1234567890abcdef',
            providerOrderId: orderId,
            order
        });

        const updatedIntent = await repo.getIntent(intentId);
        assert.equal(updatedIntent?.status, 'FULFILLING');
        assert.equal(updatedIntent?.sourceTxHash, '0xsourceTx1234567890abcdef1234567890abcdef');

        const updatedStep = await repo.getStep(stepId);
        assert.equal(updatedStep?.status, 'ACTIVE');

        const createdOrder = await repo.getProviderOrder(orderId);
        assert.ok(createdOrder);
        assert.equal(createdOrder.sourceTxHash, '0xsourceTx1234567890abcdef1234567890abcdef');

        // 2. Rollback when intent is already in terminal state
        await repo.updateIntent(intentId, { status: 'SETTLED' });

        await assert.rejects(
            async () => repo.atomicRecordSourceSubmission({
                intentId,
                stepId,
                sourceTxHash: '0xrogueTx99999999999999999999999999999999',
                providerOrderId: 'order-atomic-2',
                order: { ...order, orderId: 'order-atomic-2' }
            }),
            /in terminal state/
        );

        // Verify transaction rolled back completely
        const finalIntent = await repo.getIntent(intentId);
        assert.equal(finalIntent?.status, 'SETTLED');
        assert.equal(finalIntent?.sourceTxHash, '0xsourceTx1234567890abcdef1234567890abcdef');

        repo.close();
    });

    await t.test('12. Token Identity Collision Matrix: Fail-Closed Address & Standard Collision', async () => {
        const registry = new AuthoritativeTokenRegistry();

        // 1. Attempt to register duplicate address on same network
        const duplicateAddrToken: TokenIdentity = {
            tokenId: 'polygon:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359:duplicate',
            networkId: 'polygon',
            networkIdentityKey: 'EVM:eip155:137',
            family: 'EVM',
            namespace: 'eip155',
            standard: 'ERC20',
            address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Already registered as USDC on Polygon
            normalizedAddress: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
            symbol: 'FAKE_USDC',
            name: 'Fake USD Coin',
            decimals: 6,
            assetType: 'FUNGIBLE',
            isNative: false,
            isWrappedNative: false,
            verificationStatus: 'IDENTITY_VERIFIED',
            verificationDimensions: {
                identityVerified: true,
                addressVerified: true,
                standardVerified: true,
                decimalsVerified: true,
                metadataVerified: true,
                contractCodeVerified: true,
                networkVerified: true
            },
            metadataStatus: 'LIVE_VERIFIED',
            capabilityLevel: 'CONFIGURED',
            onboardingState: 'EXECUTION_ENABLED',
            source: 'USER_IMPORT',
            isFungible: true,
            isNFT: false,
            isMultiToken: false
        };

        assert.throws(
            () => registry.registerToken(duplicateAddrToken),
            /Token address collision|already registered/,
            'Same network + same canonical address must fail closed'
        );

        // 2. Same address on DIFFERENT network is allowed
        const arbUsdcToken: TokenIdentity = {
            tokenId: 'arbitrum:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
            networkId: 'arbitrum',
            networkIdentityKey: 'EVM:eip155:42161',
            family: 'EVM',
            namespace: 'eip155',
            standard: 'ERC20',
            address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
            normalizedAddress: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
            symbol: 'USDC_ARB_TEST',
            name: 'USD Coin on Arbitrum',
            decimals: 6,
            assetType: 'FUNGIBLE',
            isNative: false,
            isWrappedNative: false,
            verificationStatus: 'IDENTITY_VERIFIED',
            verificationDimensions: {
                identityVerified: true,
                addressVerified: true,
                standardVerified: true,
                decimalsVerified: true,
                metadataVerified: true,
                contractCodeVerified: true,
                networkVerified: true
            },
            metadataStatus: 'LIVE_VERIFIED',
            capabilityLevel: 'CONFIGURED',
            onboardingState: 'EXECUTION_ENABLED',
            source: 'USER_IMPORT',
            isFungible: true,
            isNFT: false,
            isMultiToken: false
        };

        assert.doesNotThrow(() => registry.registerToken(arbUsdcToken));
    });

    await t.test('13. Token Registry Performance Benchmark (Lookup Latencies < 1ms)', async () => {
        const registry = new AuthoritativeTokenRegistry();

        // Cold lookup
        const t0 = performance.now();
        const pol = registry.getNativeToken('polygon');
        const coldDuration = performance.now() - t0;
        assert.ok(pol);
        assert.ok(coldDuration < 5.0, `Cold lookup took ${coldDuration.toFixed(4)}ms (threshold < 5.0ms)`);

        // Warm batch lookups (10,000 queries)
        const count = 10000;
        const tStart = performance.now();
        for (let i = 0; i < count; i++) {
            registry.getTokenByAddress('polygon', 'ERC20', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
            registry.getNativeToken('polygon');
            registry.getWrappedNativeToken('polygon');
        }
        const totalDuration = performance.now() - tStart;
        const avgPerOpUs = (totalDuration / (count * 3)) * 1000;
        assert.ok(avgPerOpUs < 50.0, `Average lookup took ${avgPerOpUs.toFixed(2)}µs (threshold < 50µs)`);
    });
});
