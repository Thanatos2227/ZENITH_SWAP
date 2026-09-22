/**
 * ZENITH — Phase 1 Golden Path Live Execution Fixture
 *
 * Evidence Classification: LIVE_ONCHAIN_EVIDENCE
 * Source Chain: Polygon Mainnet (Chain ID 137)
 * Destination Chain: Arbitrum One (Chain ID 42161)
 *
 * CRITICAL SECURITY NOTICE:
 * This fixture contains exclusively sanitized, public, on-chain execution telemetry.
 * It contains ZERO private keys, seeds, environment secrets, or RPC credentials.
 * This represents ground truth on-chain evidence from the first successful real mainnet broadcast.
 */

export interface GoldenPathExecutionEvidence {
  evidenceType: 'LIVE_ONCHAIN_EVIDENCE';
  sourceChainId: number;
  destinationChainId: number;
  sourceChainName: string;
  destinationChainName: string;
  sourceToken: string;
  intermediateToken: string;
  destinationToken: string;
  operatorWallet: string;
  recipientWallet: string;
  sourceAmount: string;
  sourceAmountRaw: string;
  actualSourceSwapOutput: string;
  actualSourceSwapOutputRaw: string;
  bridgeQuotedExpectedOutput: string;
  bridgeQuotedMinOutput: string;
  actualDestinationOutput: string;
  actualDestinationOutputRaw: string;
  sourceSwapTxHash: string;
  approvalTxHash: string;
  bridgeDepositTxHash: string;
  destinationFillTxHash: string;
  acrossDepositId: string;
  sourceSwapBlockNumber: number;
  approvalBlockNumber: number;
  bridgeDepositBlockNumber: number;
  destinationFillBlockNumber: number;
  sourceSwapGasUsed: string;
  approvalGasUsed: string;
  bridgeDepositGasUsed: string;
  destinationFillGasUsed: string;
  finalExecutionState: 'DESTINATION_SETTLED';
  finalEvidenceClass: 'P1_ONCHAIN_RECEIPT';
}

export const LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE: GoldenPathExecutionEvidence = {
  evidenceType: 'LIVE_ONCHAIN_EVIDENCE',
  sourceChainId: 137,
  destinationChainId: 42161,
  sourceChainName: 'polygon',
  destinationChainName: 'arbitrum',
  sourceToken: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WPOL
  intermediateToken: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Polygon native USDC
  destinationToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum One native USDC
  operatorWallet: '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88',
  recipientWallet: '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88',
  sourceAmount: '5.000000',
  sourceAmountRaw: '5000000000000000000',
  actualSourceSwapOutput: '0.553197',
  actualSourceSwapOutputRaw: '553197',
  bridgeQuotedExpectedOutput: '0.507690',
  bridgeQuotedMinOutput: '0.505151',
  actualDestinationOutput: '0.542968',
  actualDestinationOutputRaw: '542968',
  sourceSwapTxHash: '0xbeaa1d786b82b5639bc89f0357dd00fd4f6ef801385a30f2a0e916e2f6bc60c0',
  approvalTxHash: '0x49247a7d4a59df80339c283406855d9ac6faa2e0ca1cc6cb61f19263e6b66c69',
  bridgeDepositTxHash: '0x6cdc877e7a12b0cefb05c480dcec4e8dc9dd7e72a0ec23ea23f4f23a877b99c8',
  destinationFillTxHash: '0xc3f73e3f169d66bfa29af744725e0b4eb3f9f321e29e144a5845eab074e0f3b5',
  acrossDepositId: '2356813',
  sourceSwapBlockNumber: 94206631,
  approvalBlockNumber: 94206634,
  bridgeDepositBlockNumber: 94206638,
  destinationFillBlockNumber: 507526931,
  sourceSwapGasUsed: '155329',
  approvalGasUsed: '48216',
  bridgeDepositGasUsed: '101119',
  destinationFillGasUsed: '128057',
  finalExecutionState: 'DESTINATION_SETTLED',
  finalEvidenceClass: 'P1_ONCHAIN_RECEIPT'
};
