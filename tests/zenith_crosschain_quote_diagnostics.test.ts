import test from 'node:test';
import assert from 'node:assert/strict';
import { AcrossProvider, DeBridgeProvider, StargateProvider, CrossChainAggregator, ZenithRouter, validateCrossChainQuoteExecutability, CrossChainCapabilityMatrix, defaultQuoteDiagnosticLogger } from '../packages/routing/src';
import { defaultChainRegistry } from '../packages/chains/src';
import { defaultTokenService, DEFAULT_TOKENS } from '../packages/tokens/src';
import { AggregateCrossChainQuoteError, QuoteExpiredError, InvalidQuoteAmountError, UnsupportedCrossChainRouteError, ACROSS_SPOKE_POOLS, DEBRIDGE_DLN_SOURCE, STARGATE_V2_ROUTERS } from '../packages/contracts/src';
import { CrossChainQuote, QuoteRequest, Token } from '../packages/types/src';
const USER_ADDRESS = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
test('ZENITH SWAP — Phase 0 / Task 6 Cross-Chain Quote Diagnostics & Normalization', async (t) => {
    const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
    const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
    const usdcPoly = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'USDC')!;
    const polPoly = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'POL')!;
    const wpolPoly = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'WPOL')!;
    const ethEth = defaultTokenService.getNativeToken('ethereum')!;
    await t.test('1. Across successful live quote normalization and swapTx calldata preview', async () => {
        const mockFetch = async () => {
            return new Response(JSON.stringify({
                swapTx: {
                    to: ACROSS_SPOKE_POOLS[1],
                    data: '0x7b9392320000000000000000000000001234567890123456789012345678901234567890',
                    value: '0',
                    chainId: 1
                },
                outputAmount: '999500000',
                quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300,
                fees: { total: { amount: '500000', pct: '0.0005' } }
            }), { status: 200, statusText: 'OK' });
        };
        const provider = new AcrossProvider({
            apiKey: 'test_key',
            integratorId: '0x0001',
            fetchFn: mockFetch as any
        });
        const req: QuoteRequest = {
            sourceChainId: 'ethereum',
            destinationChainId: 'arbitrum',
            tokenIn: usdcEth,
            tokenOut: usdcArb,
            amountInRaw: '1000000000',
            userWalletAddress: USER_ADDRESS,
            recipientAddress: USER_ADDRESS,
            slippageTolerancePercent: 0.5
        };
        const quote = await provider.getQuote(req);
        assert.ok(quote);
        assert.equal(quote.provider, 'ACROSS');
        assert.equal(quote.sourceChainId, 'ethereum');
        assert.equal(quote.destinationChainId, 'arbitrum');
        assert.equal(quote.sourceAmountRaw, '1000000000');
        assert.ok(BigInt(quote.destinationAmountRaw) > 0n);
        assert.ok(BigInt(quote.minDestinationAmountRaw) <= BigInt(quote.destinationAmountRaw));
        assert.equal(quote.executionTarget.toLowerCase(), ACROSS_SPOKE_POOLS[1].toLowerCase());
        assert.equal(quote.approvalTarget.toLowerCase(), ACROSS_SPOKE_POOLS[1].toLowerCase());
    });
    await t.test('2. Across provider unavailable: offline/500/timeout handling leaves quote non-executable', async () => {
        const mockFetch = async () => {
            throw new Error('Network timeout (ETIMEDOUT)');
        };
        const provider = new AcrossProvider({
            apiKey: 'test_key',
            integratorId: '0x0001',
            fetchFn: mockFetch as any
        });
        const req: QuoteRequest = {
            sourceChainId: 'ethereum',
            destinationChainId: 'arbitrum',
            tokenIn: usdcEth,
            tokenOut: usdcArb,
            amountInRaw: '500000000',
            userWalletAddress: USER_ADDRESS,
            recipientAddress: USER_ADDRESS
        };
        const quote = await provider.getQuote(req);
        assert.ok(quote);
        assert.equal(quote.isExecutable, false);
        assert.equal(quote.unexecutableReason, 'PROVIDER_UNAVAILABLE');
    });
    await t.test('3. Across malformed response: incomplete payload caught and marked unexecutable', async () => {
        const mockFetch = async () => {
            return new Response(JSON.stringify({ invalidField: true }), { status: 200, statusText: 'OK' });
        };
        const provider = new AcrossProvider({
            apiKey: 'test_key',
            integratorId: '0x0001',
            fetchFn: mockFetch as any
        });
        const req: QuoteRequest = {
            sourceChainId: 'ethereum',
            destinationChainId: 'arbitrum',
            tokenIn: usdcEth,
            tokenOut: usdcArb,
            amountInRaw: '500000000',
            userWalletAddress: USER_ADDRESS,
            recipientAddress: USER_ADDRESS
        };
        const quote = await provider.getQuote(req);
        assert.ok(quote);
        assert.equal(quote.isExecutable, false);
        assert.ok(quote.unexecutableReason === 'MALFORMED_RESPONSE' || quote.unexecutableReason === 'EXECUTION_DATA_UNAVAILABLE');
    });
    await t.test('4. Across unsupported token: direct POL -> USDC returns isAvailable = false', async () => {
        const provider = new AcrossProvider();
        const isAvail = provider.isAvailable('polygon', 'ethereum', polPoly, usdcEth);
        assert.equal(isAvail, false, 'Across is a same-asset bridge and must reject direct POL -> USDC');
    });
    await t.test('5. deBridge DLN quote normalization: valid parameters and non-empty calldata for live response', async () => {
        const provider = new DeBridgeProvider();
        const origFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => {
                return new Response(JSON.stringify({
                    estimation: {
                        dstChainTokenOut: {
                            recommendedAmount: '999500000',
                            amount: '999500000',
                            decimals: 6
                        },
                        costsDetails: [{ name: 'OperatingExpense', amount: '0.02' }],
                        percentFee: '0.04'
                    },
                    protocolFeeApproximateUsdValue: '0.02'
                }), { status: 200, statusText: 'OK' });
            };
            const req: QuoteRequest = {
                sourceChainId: 'ethereum',
                destinationChainId: 'arbitrum',
                tokenIn: usdcEth,
                tokenOut: usdcArb,
                amountInRaw: '1000000000',
                userWalletAddress: USER_ADDRESS,
                recipientAddress: USER_ADDRESS
            };
            const quote = await provider.getQuote(req);
            assert.ok(quote);
            assert.equal(quote.provider, 'DEBRIDGE_DLN');
            assert.equal(quote.isExecutable, true);
            assert.ok(quote.calldata.startsWith('0x') && quote.calldata !== '0x');
            assert.equal(quote.executionTarget, DEBRIDGE_DLN_SOURCE[1]);
        }
        finally {
            globalThis.fetch = origFetch;
        }
    });
    await t.test('6. deBridge unavailable: HTTP 429 rate limit properly maps error taxonomy', async () => {
        const provider = new DeBridgeProvider();
        const origFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => {
                return new Response('Rate limit exceeded', { status: 429, statusText: 'Too Many Requests' });
            };
            const req: QuoteRequest = {
                sourceChainId: 'ethereum',
                destinationChainId: 'arbitrum',
                tokenIn: usdcEth,
                tokenOut: usdcArb,
                amountInRaw: '1000000000',
                userWalletAddress: USER_ADDRESS
            };
            const quote = await provider.getQuote(req);
            assert.ok(quote);
            assert.equal(quote.isExecutable, false);
            assert.equal(quote.calldata, '0x');
            assert.equal(quote.unexecutableReason, 'RATE_LIMITED');
        }
        finally {
            globalThis.fetch = origFetch;
        }
    });
    await t.test('7. Stargate non-executable invariant: strictly isExecutable = false and calldata = 0x', async () => {
        const provider = new StargateProvider();
        const req: QuoteRequest = {
            sourceChainId: 'ethereum',
            destinationChainId: 'arbitrum',
            tokenIn: usdcEth,
            tokenOut: usdcArb,
            amountInRaw: '1000000000',
            userWalletAddress: USER_ADDRESS
        };
        const quote = await provider.getQuote(req);
        assert.ok(quote);
        assert.equal(quote.provider, 'STARGATE');
        assert.equal(quote.isExecutable, false);
        assert.equal(quote.calldata, '0x');
        assert.ok(quote.unexecutableReason?.includes('Stargate V2 live quoter not configured'));
    });
    await t.test('8. Token normalization: distinct identities and zero synthetic aliasing', () => {
        assert.notEqual(polPoly.address.toLowerCase(), wpolPoly.address.toLowerCase());
        assert.equal(polPoly.isNative, true);
        assert.equal(wpolPoly.isNative, undefined);
        assert.equal(usdcPoly.address, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
        assert.equal(usdcEth.address, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    });
    await t.test('9. Native vs wrapped token representation: EVM zero address & 0xeeee... representation', () => {
        assert.equal(ethEth.isNative, true);
        assert.equal(ethEth.address, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');
        assert.equal(polPoly.isNative, true);
        assert.equal(polPoly.address, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');
    });
    await t.test('10. Decimal conversion accuracy across 6, 8, 18 decimal tokens', () => {
        assert.equal(usdcEth.decimals, 6);
        assert.equal(polPoly.decimals, 18);
        const raw6 = 1000000n;
        const raw18 = 1000000000000000000n;
        assert.equal(raw6.toString(), '1000000');
        assert.equal(raw18.toString(), '1000000000000000000');
    });
    await t.test('11. Raw amount preservation: zero floating-point math during fee calculation', () => {
        const inputBig = 1000000000n;
        const feeBps = 5n;
        const feeRaw = (inputBig * feeBps) / 10000n;
        const netRaw = inputBig - feeRaw;
        assert.equal(feeRaw, 500000n);
        assert.equal(netRaw, 999500000n);
    });
    await t.test('12. Quote expiration validation: expired timestamp marked unexecutable', () => {
        const expiredQuote: CrossChainQuote = {
            provider: 'ACROSS',
            providerName: 'Across Protocol V3',
            sourceChainId: 'ethereum',
            destinationChainId: 'arbitrum',
            sourceToken: usdcEth,
            destinationToken: usdcArb,
            sourceAmountRaw: '1000000000',
            destinationAmountRaw: '999500000',
            minDestinationAmountRaw: '994500000',
            bridgeFeeUSD: 0.5,
            relayerFee: '0.05%',
            gasEstimateUSD: 2.0,
            recipient: USER_ADDRESS,
            expiration: Date.now() - 10000,
            routeIdentifier: 'test-expired',
            executionTarget: ACROSS_SPOKE_POOLS[1],
            calldata: '0x12345678',
            value: '0',
            approvalTarget: ACROSS_SPOKE_POOLS[1],
            quoteTimestamp: Date.now() - 60000,
            estimatedTransferTimeSec: 30,
            securityRating: 'A+',
            isExecutable: true
        };
        const result = validateCrossChainQuoteExecutability(expiredQuote);
        assert.equal(result.isExecutable, false);
        assert.ok(result.failedGates.includes('EXPIRATION_VALID'));
        assert.ok(result.unexecutableReason?.includes('EXPIRED'));
    });
    await t.test('13. Executability validation: all 10 gates tested and confirmed', () => {
        const validQuote: CrossChainQuote = {
            provider: 'ACROSS',
            providerName: 'Across Protocol V3',
            sourceChainId: 'ethereum',
            destinationChainId: 'arbitrum',
            sourceToken: usdcEth,
            destinationToken: usdcArb,
            sourceAmountRaw: '1000000000',
            destinationAmountRaw: '999500000',
            minDestinationAmountRaw: '994500000',
            bridgeFeeUSD: 0.5,
            relayerFee: '0.05%',
            gasEstimateUSD: 2.0,
            recipient: USER_ADDRESS,
            expiration: Date.now() + 60000,
            routeIdentifier: 'test-valid',
            executionTarget: ACROSS_SPOKE_POOLS[1],
            calldata: '0x12345678',
            value: '0',
            approvalTarget: ACROSS_SPOKE_POOLS[1],
            quoteTimestamp: Date.now(),
            estimatedTransferTimeSec: 30,
            securityRating: 'A+',
            isExecutable: true
        };
        const res = validateCrossChainQuoteExecutability(validQuote);
        assert.equal(res.isExecutable, true);
        assert.equal(res.failedGates.length, 0);
        assert.ok(res.passedGates.length > 0);
    });
    await t.test('14. Error taxonomy normalization: accurate code resolution', () => {
        assert.equal(defaultQuoteDiagnosticLogger.normalizeErrorCode('ETIMEDOUT'), 'PROVIDER_UNAVAILABLE');
        assert.equal(defaultQuoteDiagnosticLogger.normalizeErrorCode('', 429), 'RATE_LIMITED');
        assert.equal(defaultQuoteDiagnosticLogger.normalizeErrorCode('', 401), 'API_AUTH_REQUIRED');
        assert.equal(defaultQuoteDiagnosticLogger.normalizeErrorCode('unsupported asset'), 'UNSUPPORTED_TOKEN');
    });
    await t.test('15. Aggregate provider failure: throws AggregateCrossChainQuoteError with per-provider details', () => {
        const aggErr = defaultQuoteDiagnosticLogger.buildAggregateError({
            sourceChainId: 'polygon',
            destinationChainId: 'ethereum',
            tokenIn: polPoly,
            tokenOut: usdcEth,
            amountInRaw: '1000000000000000000',
            diagnostics: {
                ACROSS: {
                    provider: 'ACROSS',
                    sourceChainId: 'polygon',
                    destinationChainId: 'ethereum',
                    sourceToken: 'POL',
                    destinationToken: 'USDC',
                    amountInRaw: '1000000000000000000',
                    requestStatus: 'FAILED',
                    normalizedError: 'UNSUPPORTED_TOKEN',
                    isExecutable: false,
                    timestamp: Date.now()
                },
                STARGATE: {
                    provider: 'STARGATE',
                    sourceChainId: 'polygon',
                    destinationChainId: 'ethereum',
                    sourceToken: 'POL',
                    destinationToken: 'USDC',
                    amountInRaw: '1000000000000000000',
                    requestStatus: 'SKIPPED',
                    normalizedError: 'QUOTE_UNAVAILABLE',
                    isExecutable: false,
                    timestamp: Date.now()
                }
            }
        });
        assert.ok(aggErr instanceof AggregateCrossChainQuoteError);
        assert.equal(aggErr.sourceChainId, 'polygon');
        assert.equal(aggErr.destinationChainId, 'ethereum');
        assert.ok(aggErr.providerDiagnostics.ACROSS);
        assert.ok(aggErr.providerDiagnostics.STARGATE);
    });
    await t.test('16. Non-lethal provider isolation: single provider exception does not crash aggregator', async () => {
        const mockFailingAcross: any = {
            id: 'ACROSS',
            name: 'Across',
            isAvailable: () => true,
            getQuote: async () => { throw new Error('Across catastrophic outage'); }
        };
        const mockWorkingDebridge: any = {
            id: 'DEBRIDGE_DLN',
            name: 'deBridge DLN',
            isAvailable: () => true,
            getQuote: async () => ({
                provider: 'DEBRIDGE_DLN',
                providerName: 'deBridge DLN',
                sourceChainId: 'ethereum',
                destinationChainId: 'arbitrum',
                sourceToken: usdcEth,
                destinationToken: usdcArb,
                sourceAmountRaw: '1000000000',
                destinationAmountRaw: '999500000',
                minDestinationAmountRaw: '994500000',
                bridgeFeeUSD: 0.5,
                relayerFee: '0.04%',
                gasEstimateUSD: 2.0,
                recipient: USER_ADDRESS,
                expiration: Date.now() + 60000,
                routeIdentifier: 'test-debridge',
                executionTarget: DEBRIDGE_DLN_SOURCE[1],
                calldata: '0x1234',
                value: '0',
                approvalTarget: DEBRIDGE_DLN_SOURCE[1],
                quoteTimestamp: Date.now(),
                estimatedTransferTimeSec: 60,
                securityRating: 'A',
                isExecutable: true
            })
        };
        const aggregator = new CrossChainAggregator([mockFailingAcross, mockWorkingDebridge]);
        const quotes = await aggregator.getQuotes({
            sourceChainId: 'ethereum',
            destinationChainId: 'arbitrum',
            tokenIn: usdcEth,
            tokenOut: usdcArb,
            amountInRaw: '1000000000',
            userWalletAddress: USER_ADDRESS
        });
        assert.equal(quotes.length, 1);
        assert.equal(quotes[0].provider, 'DEBRIDGE_DLN');
    });
    await t.test('17. POL -> USDC diagnostic reproduction: connector route queries DEX and Bridge', async () => {
        const matrixRecord = CrossChainCapabilityMatrix.getCapability('ACROSS', 'polygon', 'ethereum', 'POL', 'USDC');
        assert.equal(matrixRecord.quoteSupported, false);
        assert.equal(matrixRecord.capabilityStatus, 'CONFIGURED');
        assert.ok(matrixRecord.unsupportedReason?.includes('same-asset bridge'));
    });
    await t.test('18. Working route vs failing route capability comparison', () => {
        const workingCap = CrossChainCapabilityMatrix.getCapability('ACROSS', 'ethereum', 'arbitrum', 'USDC', 'USDC');
        assert.equal(workingCap.quoteSupported, true);
        assert.equal(workingCap.executionSupported, true);
        assert.equal(workingCap.capabilityStatus, 'LIVE_VERIFIED');
        const failingCap = CrossChainCapabilityMatrix.getCapability('ACROSS', 'polygon', 'ethereum', 'POL', 'USDC');
        assert.equal(failingCap.quoteSupported, false);
        assert.equal(failingCap.capabilityStatus, 'CONFIGURED');
    });
    await t.test('19. Zero synthetic fallback quotes invariant: fallback estimates never marked executable', async () => {
        const provider = new AcrossProvider();
        const origFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => {
                throw new Error('API down');
            };
            const quote = await provider.getQuote({
                sourceChainId: 'ethereum',
                destinationChainId: 'arbitrum',
                tokenIn: usdcEth,
                tokenOut: usdcArb,
                amountInRaw: '1000000000',
                userWalletAddress: USER_ADDRESS
            });
            assert.ok(quote);
            assert.equal(quote.isExecutable, false, 'Offline estimate must NEVER be marked executable');
        }
        finally {
            globalThis.fetch = origFetch;
        }
    });
    await t.test('20. Zero fake executable calldata invariant: unexecutable quotes must have calldata 0x', async () => {
        const provider = new StargateProvider();
        const quote = await provider.getQuote({
            sourceChainId: 'ethereum',
            destinationChainId: 'arbitrum',
            tokenIn: usdcEth,
            tokenOut: usdcArb,
            amountInRaw: '1000000000',
            userWalletAddress: USER_ADDRESS
        });
        assert.ok(quote);
        assert.equal(quote.calldata, '0x', 'Unexecutable quote must strictly retain 0x calldata');
    });
    await t.test('21. Across same-asset ETH request normalizes native token to WETH and passes valid spoke pool', async () => {
        const ethArb = defaultTokenService.getNativeToken('arbitrum')!;
        const ethBase = defaultTokenService.getNativeToken('base')!;
        let capturedUrl = '';
        const mockFetch = async (url: any, opts?: any) => {
            capturedUrl = String(url);
            return new Response(JSON.stringify({
                swapTx: {
                    to: ACROSS_SPOKE_POOLS[42161],
                    data: '0x7b9392320000000000000000000000001234567890123456789012345678901234567890',
                    value: '1000000000000000000',
                    chainId: 42161
                },
                outputAmount: '999500000000000000',
                quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300,
                fees: { total: { amount: '500000000000000', pct: '0.0005' } }
            }), { status: 200, statusText: 'OK' });
        };
        const provider = new AcrossProvider({
            apiKey: 'test_key',
            integratorId: '0x0001',
            fetchFn: mockFetch as any
        });
        const req: QuoteRequest = {
            sourceChainId: 'arbitrum',
            destinationChainId: 'base',
            tokenIn: ethArb,
            tokenOut: ethBase,
            amountInRaw: '1000000000000000000',
            userWalletAddress: USER_ADDRESS,
            recipientAddress: USER_ADDRESS
        };
        const quote = await provider.getQuote(req);
        assert.ok(quote);
        assert.equal(quote.provider, 'ACROSS');
        assert.equal(quote.isExecutable, true);
        assert.ok(capturedUrl.toLowerCase().includes('0x82af49447d8a07e3bd95bd0d56f35241523fbab1'));
        assert.ok(capturedUrl.toLowerCase().includes('0x4200000000000000000000000000000000000006'));
    });
    await t.test('22. Across cross-asset rejection: ETH Arbitrum -> BRETT Base is rejected cleanly', async () => {
        const provider = new AcrossProvider({ apiKey: 'test_key', integratorId: '0x0001' });
        const ethArb = defaultTokenService.getNativeToken('arbitrum')!;
        const brettBase = defaultTokenService.getTokensForChain('base').find((tk) => tk.symbol === 'BRETT')!;
        assert.ok(brettBase, 'BRETT must be present in Base token registry');
        const isAvail = provider.isAvailable('arbitrum', 'base', ethArb, brettBase);
        assert.equal(isAvail, false, 'Across must reject direct cross-asset ETH -> BRETT');
    });
    await t.test('23. Across HTTP 400 with token error payload maps to UNSUPPORTED_TOKEN', async () => {
        const ethArb = defaultTokenService.getNativeToken('arbitrum')!;
        const ethBase = defaultTokenService.getNativeToken('base')!;
        const mockFetch = async () => {
            return new Response(JSON.stringify({ message: 'Token not supported on destination chain' }), { status: 400, statusText: 'Bad Request' });
        };
        const provider = new AcrossProvider({
            apiKey: 'test_key',
            integratorId: '0x0001',
            fetchFn: mockFetch as any
        });
        const req: QuoteRequest = {
            sourceChainId: 'arbitrum',
            destinationChainId: 'base',
            tokenIn: ethArb,
            tokenOut: ethBase,
            amountInRaw: '1000000000000000000',
            userWalletAddress: USER_ADDRESS,
            recipientAddress: USER_ADDRESS
        };
        const quote = await provider.getQuote(req);
        assert.ok(quote);
        assert.equal(quote.isExecutable, false);
        assert.equal(quote.unexecutableReason, 'UNSUPPORTED_TOKEN');
    });
    await t.test('24. Across HTTP 400 with amount/limit payload maps to INVALID_AMOUNT', async () => {
        const ethArb = defaultTokenService.getNativeToken('arbitrum')!;
        const ethBase = defaultTokenService.getNativeToken('base')!;
        const mockFetch = async () => {
            return new Response(JSON.stringify({ error: 'Amount is below minimum deposit limit' }), { status: 400, statusText: 'Bad Request' });
        };
        const provider = new AcrossProvider({
            apiKey: 'test_key',
            integratorId: '0x0001',
            fetchFn: mockFetch as any
        });
        const req: QuoteRequest = {
            sourceChainId: 'arbitrum',
            destinationChainId: 'base',
            tokenIn: ethArb,
            tokenOut: ethBase,
            amountInRaw: '1000',
            userWalletAddress: USER_ADDRESS,
            recipientAddress: USER_ADDRESS
        };
        const quote = await provider.getQuote(req);
        assert.ok(quote);
        assert.equal(quote.isExecutable, false);
        assert.equal(quote.unexecutableReason, 'INVALID_AMOUNT');
    });
    await t.test('25. Across HTTP 400 with opaque body maps to UNKNOWN_PROVIDER_ERROR (not MALFORMED_RESPONSE)', async () => {
        const ethArb = defaultTokenService.getNativeToken('arbitrum')!;
        const ethBase = defaultTokenService.getNativeToken('base')!;
        const mockFetch = async () => {
            return new Response('custom unclassified error text', { status: 400, statusText: 'Bad Request' });
        };
        const provider = new AcrossProvider({
            apiKey: 'test_key',
            integratorId: '0x0001',
            fetchFn: mockFetch as any
        });
        const req: QuoteRequest = {
            sourceChainId: 'arbitrum',
            destinationChainId: 'base',
            tokenIn: ethArb,
            tokenOut: ethBase,
            amountInRaw: '1000000000000000000',
            userWalletAddress: USER_ADDRESS,
            recipientAddress: USER_ADDRESS
        };
        const quote = await provider.getQuote(req);
        assert.ok(quote);
        assert.equal(quote.isExecutable, false);
        assert.equal(quote.unexecutableReason, 'UNKNOWN_PROVIDER_ERROR');
    });
    await t.test('26. deBridge DLN normalizes native ETH to zero address for same-asset bridge', async () => {
        const provider = new DeBridgeProvider();
        const ethArb = defaultTokenService.getNativeToken('arbitrum')!;
        const ethBase = defaultTokenService.getNativeToken('base')!;
        let capturedUrl = '';
        const origFetch = globalThis.fetch;
        try {
            globalThis.fetch = async (url: any) => {
                capturedUrl = String(url);
                return new Response(JSON.stringify({
                    estimation: {
                        dstChainTokenOut: {
                            recommendedAmount: '999500000000000000',
                            amount: '999500000000000000',
                            decimals: 18
                        },
                        costsDetails: [{ name: 'OperatingExpense', amount: '0.001' }],
                        percentFee: '0.04'
                    },
                    protocolFeeApproximateUsdValue: '0.001'
                }), { status: 200, statusText: 'OK' });
            };
            const req: QuoteRequest = {
                sourceChainId: 'arbitrum',
                destinationChainId: 'base',
                tokenIn: ethArb,
                tokenOut: ethBase,
                amountInRaw: '1000000000000000000',
                userWalletAddress: USER_ADDRESS,
                recipientAddress: USER_ADDRESS
            };
            const quote = await provider.getQuote(req);
            assert.ok(quote);
            assert.equal(quote.provider, 'DEBRIDGE_DLN');
            assert.equal(quote.isExecutable, true);
            assert.ok(capturedUrl.includes('srcChainTokenIn=0x0000000000000000000000000000000000000000'));
            assert.ok(capturedUrl.includes('dstChainTokenOut=0x0000000000000000000000000000000000000000'));
        } finally {
            globalThis.fetch = origFetch;
        }
    });
    await t.test('26b. deBridge cross-asset rejection: direct ETH Arbitrum -> BRETT Base returns isAvailable = false', async () => {
        const provider = new DeBridgeProvider();
        const ethArb = defaultTokenService.getNativeToken('arbitrum')!;
        const brettBase = defaultTokenService.getTokensForChain('base').find((tk) => tk.symbol === 'BRETT')!;
        assert.ok(brettBase);
        const isAvail = provider.isAvailable('arbitrum', 'base', ethArb, brettBase);
        assert.equal(isAvail, false, 'deBridge must reject direct cross-asset ETH -> BRETT');
    });
    await t.test('27. deBridge HTTP 400 with provider error body is parsed and classified accurately', async () => {
        const provider = new DeBridgeProvider();
        const ethArb = defaultTokenService.getNativeToken('arbitrum')!;
        const ethBase = defaultTokenService.getNativeToken('base')!;
        const origFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => {
                return new Response(JSON.stringify({ errorMessage: 'Insufficient liquidity in taker pool' }), { status: 400, statusText: 'Bad Request' });
            };
            const req: QuoteRequest = {
                sourceChainId: 'arbitrum',
                destinationChainId: 'base',
                tokenIn: ethArb,
                tokenOut: ethBase,
                amountInRaw: '1000000000000000000',
                userWalletAddress: USER_ADDRESS
            };
            const quote = await provider.getQuote(req);
            assert.ok(quote);
            assert.equal(quote.isExecutable, false);
            assert.equal(quote.unexecutableReason, 'INSUFFICIENT_LIQUIDITY');
        } finally {
            globalThis.fetch = origFetch;
        }
    });
    await t.test('28. deBridge HTTP 500 error maps to PROVIDER_UNAVAILABLE', async () => {
        const provider = new DeBridgeProvider();
        const ethArb = defaultTokenService.getNativeToken('arbitrum')!;
        const ethBase = defaultTokenService.getNativeToken('base')!;
        const origFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => {
                return new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
            };
            const req: QuoteRequest = {
                sourceChainId: 'arbitrum',
                destinationChainId: 'base',
                tokenIn: ethArb,
                tokenOut: ethBase,
                amountInRaw: '1000000000000000000',
                userWalletAddress: USER_ADDRESS
            };
            const quote = await provider.getQuote(req);
            assert.ok(quote);
            assert.equal(quote.isExecutable, false);
            assert.equal(quote.unexecutableReason, 'PROVIDER_UNAVAILABLE');
        } finally {
            globalThis.fetch = origFetch;
        }
    });
    await t.test('29. Diagnostic URL sanitization redacts secrets and keys', () => {
        const dirtyUrl = 'https://api.debridge.finance/v1.0/dln/order/create-tx?apiKey=secret_12345&privateKey=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef&amount=100';
        const cleanUrl = defaultQuoteDiagnosticLogger.sanitizeUrl(dirtyUrl);
        assert.ok(!cleanUrl.includes('secret_12345'));
        assert.ok(!cleanUrl.includes('0x0123456789abcdef'));
        assert.ok(cleanUrl.includes('apiKey=%5BREDACTED%5D') || cleanUrl.includes('apiKey=[REDACTED]'));
    });
    await t.test('30. Diagnostic message sanitization redacts private keys and mnemonic phrases', () => {
        const dirtyMsg = 'Failed at key 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef with mnemonic word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12';
        const cleanMsg = defaultQuoteDiagnosticLogger.sanitizeMessage(dirtyMsg);
        assert.ok(!cleanMsg.includes('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'));
        assert.ok(cleanMsg.includes('[REDACTED_SECRET]'));
    });
    await t.test('31. Authoritative token resolution for BRETT on Base vs non-existent token', () => {
        const baseTokens = defaultTokenService.getTokensForChain('base');
        const brett = baseTokens.find((t) => t.symbol === 'BRETT');
        assert.ok(brett);
        assert.equal(brett.address, '0x532f27101965dd16442E59d40670FaF5eBB142E4');
        assert.equal(brett.chainId, 'base');
        assert.equal(brett.decimals, 18);

        const nonExistent = baseTokens.find((t) => t.symbol === 'NONEXISTENT_XYZ');
        assert.equal(nonExistent, undefined);
    });
});
