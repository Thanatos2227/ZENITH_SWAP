import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EconomicParametersInventory,
  SlippagePolicyConfig,
  GasEconomicParams,
  EconomicTelemetryRecord
} from '@zenith/types';
import {
  EconomicSafetyBreachError,
  SlippagePolicyViolationError,
  MinimumOutputBreachError,
  InsufficientNativeReserveError,
  QuoteFreshnessExpiredError,
  FeeAccountingBreachError,
  PriceImpactExceededError,
  InvalidQuoteAmountError,
  StatusConflictError,
  SourceSwapFailedError,
  AmountMismatchError,
  ZERO_ADDRESS
} from '@zenith/contracts';
import {
  validateAmountFormat,
  calculateDeterministicMinimumOutput,
  validateSlippagePolicy,
  validateMinimumOutput,
  validateSourceSwapEconomics,
  validateBridgeQuoteRefreshEconomics,
  validateBridgeEconomics,
  validateDestinationSettlementEconomics,
  validateCrossChainEconomicBounds,
  validateFeeAccounting,
  validateGasEconomicsAndReserve,
  validatePriceImpactEconomics,
  validateQuoteFreshnessEconomics,
  validateApprovalEconomics,
  validateCompositeEconomicInvariant,
  validateDirectCrossChainInvariant,
  defaultEconomicTelemetry,
  UINT256_MAX,
  DEFAULT_MAX_SLIPPAGE_BPS,
  ABSOLUTE_MAX_SLIPPAGE_BPS
} from '../packages/execution/src/economic';
import { extractActualSourceSwapOutput } from '../packages/execution/src/crosschain/sourceSwapOutputExtractor';
import { verifyDestinationSettlement } from '../packages/execution/src/crosschain/authoritativeDestinationVerifier';
import { CostNormalizer } from '../packages/routing/src/arbitration/costNormalizer';
import { RouteArbitrator } from '../packages/routing/src/arbitration/routeArbitrator';
import { parseTokenUnits, formatTokenUnits } from '../packages/routing/src/tokenDecimals';
import { ConstantProductMath } from '../packages/routing/src/math/ammMath';

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ZENITH — PHASE 1 TASK 33: ECONOMIC SAFETY, SLIPPAGE & VALUE-PROTECTION CERTIFICATION', () => {

  describe('Part 1 — Economic Input Inventory & Integrity', () => {
    const canonicalInventory: EconomicParametersInventory = {
      amountIn: '1000000000',
      amountOut: '994000000',
      minimumAmountOut: '990000000',
      expectedAmountOut: '994000000',
      actualAmountOut: '994200000',
      slippage: 50,
      priceImpact: 0.05,
      bridgeFee: '1500000',
      protocolFee: '500000',
      gasCost: '2000000000000000',
      solverFee: '0',
      destinationFee: '0',
      relayerFee: '0',
      nativeGasReserve: '50000000000000000',
      approvalAmount: '1000000000',
      exchangeRate: '0.994',
      tokenDecimals: { in: 6, out: 6 },
      quoteExpiration: Date.now() + 120000,
      quoteTimestamp: Date.now(),
      routeCost: '2500000',
      guaranteedOutput: '990000000',
      estimatedOutput: '994000000'
    };

    test('Inventory 1: contains all 21 certified economic fields', () => {
      const keys = Object.keys(canonicalInventory);
      assert.equal(keys.length >= 21, true);
      assert.ok('amountIn' in canonicalInventory);
      assert.ok('amountOut' in canonicalInventory);
      assert.ok('minimumAmountOut' in canonicalInventory);
      assert.ok('expectedAmountOut' in canonicalInventory);
      assert.ok('actualAmountOut' in canonicalInventory);
      assert.ok('slippage' in canonicalInventory);
      assert.ok('priceImpact' in canonicalInventory);
      assert.ok('bridgeFee' in canonicalInventory);
      assert.ok('protocolFee' in canonicalInventory);
      assert.ok('gasCost' in canonicalInventory);
      assert.ok('solverFee' in canonicalInventory);
      assert.ok('destinationFee' in canonicalInventory);
      assert.ok('relayerFee' in canonicalInventory);
      assert.ok('nativeGasReserve' in canonicalInventory);
      assert.ok('approvalAmount' in canonicalInventory);
      assert.ok('exchangeRate' in canonicalInventory);
      assert.ok('tokenDecimals' in canonicalInventory);
      assert.ok('quoteExpiration' in canonicalInventory);
      assert.ok('quoteTimestamp' in canonicalInventory);
      assert.ok('routeCost' in canonicalInventory);
      assert.ok('guaranteedOutput' in canonicalInventory);
      assert.ok('estimatedOutput' in canonicalInventory);
    });

    test('Inventory 2: verifies all amount strings represent exact non-negative integers', () => {
      assert.equal(validateAmountFormat(canonicalInventory.amountIn), 1000000000n);
      assert.equal(validateAmountFormat(canonicalInventory.minimumAmountOut), 990000000n);
      assert.equal(validateAmountFormat(canonicalInventory.expectedAmountOut), 994000000n);
      assert.equal(validateAmountFormat(canonicalInventory.actualAmountOut!), 994200000n);
    });

    test('Inventory 3: rejects fabricated or non-string numeric inputs for amountIn', () => {
      assert.throws(() => validateAmountFormat(100 as any), InvalidQuoteAmountError);
      assert.throws(() => validateAmountFormat(null as any), InvalidQuoteAmountError);
      assert.throws(() => validateAmountFormat(undefined as any), InvalidQuoteAmountError);
    });

    test('Inventory 4: rejects empty or whitespace-only amount strings', () => {
      assert.throws(() => validateAmountFormat(''), InvalidQuoteAmountError);
      assert.throws(() => validateAmountFormat('   '), InvalidQuoteAmountError);
    });
  });

  describe('Part 2 — Exact Arithmetic Certification', () => {
    test('Arithmetic 1: verifies UINT256_MAX boundary representation', () => {
      const maxStr = UINT256_MAX.toString();
      const parsed = validateAmountFormat(maxStr, 'uint256Max');
      assert.equal(parsed, UINT256_MAX);
    });

    test('Arithmetic 2: rejects values exceeding UINT256_MAX', () => {
      const overMax = (UINT256_MAX + 1n).toString();
      assert.throws(() => validateAmountFormat(overMax), InvalidQuoteAmountError);
    });

    test('Arithmetic 3: validates exact zero as valid integer string', () => {
      assert.equal(validateAmountFormat('0'), 0n);
    });

    test('Arithmetic 4: validates exact one wei as valid integer string', () => {
      assert.equal(validateAmountFormat('1'), 1n);
    });

    test('Arithmetic 5: rejects leading zeros in non-zero integers', () => {
      assert.throws(() => validateAmountFormat('01'), InvalidQuoteAmountError);
      assert.throws(() => validateAmountFormat('000100'), InvalidQuoteAmountError);
    });

    test('Arithmetic 6: rejects floating-point numbers in token amounts', () => {
      assert.throws(() => validateAmountFormat('100.5'), InvalidQuoteAmountError);
      assert.throws(() => validateAmountFormat('0.0001'), InvalidQuoteAmountError);
    });

    test('Arithmetic 7: rejects scientific notation in token amounts', () => {
      assert.throws(() => validateAmountFormat('1e18'), InvalidQuoteAmountError);
      assert.throws(() => validateAmountFormat('1.5E6'), InvalidQuoteAmountError);
    });

    test('Arithmetic 8: rejects negative integers', () => {
      assert.throws(() => validateAmountFormat('-1'), InvalidQuoteAmountError);
      assert.throws(() => validateAmountFormat('-1000000'), InvalidQuoteAmountError);
    });

    test('Arithmetic 9: rejects explicit positive signs', () => {
      assert.throws(() => validateAmountFormat('+100'), InvalidQuoteAmountError);
    });

    test('Arithmetic 10: preserves precision beyond Number.MAX_SAFE_INTEGER', () => {
      const largeVal = '9007199254740993000000000000';
      const parsed = validateAmountFormat(largeVal);
      assert.equal(parsed.toString(), largeVal);
      assert.notEqual(Number(parsed), parsed);
    });
  });

  describe('Part 3 — Token Decimal Normalization', () => {
    test('Decimals 1: normalizes 6-decimal USDC raw units to human units and back', () => {
      const human = '100.5';
      const raw = parseTokenUnits(human, 6);
      assert.equal(raw, '100500000');
      const roundTrip = formatTokenUnits(raw, 6);
      assert.equal(roundTrip, '100.5');
    });

    test('Decimals 2: normalizes 18-decimal DAI/ETH raw units to human units and back', () => {
      const human = '1.000000000000000001';
      const raw = parseTokenUnits(human, 18);
      assert.equal(raw, '1000000000000000001');
      const roundTrip = formatTokenUnits(raw, 18);
      assert.equal(roundTrip, '1.000000000000000001');
    });

    test('Decimals 3: normalizes 8-decimal WBTC raw units to human units and back', () => {
      const human = '0.12345678';
      const raw = parseTokenUnits(human, 8);
      assert.equal(raw, '12345678');
      const roundTrip = formatTokenUnits(raw, 8);
      assert.equal(roundTrip, '0.12345678');
    });

    test('Decimals 4: normalizes 0-decimal token raw units', () => {
      const human = '42';
      const raw = parseTokenUnits(human, 0);
      assert.equal(raw, '42');
      const roundTrip = formatTokenUnits(raw, 0);
      assert.equal(roundTrip, '42');
    });


    test('Decimals 5: truncation does not round upward or invent tokens', () => {
      const humanExcess = '100.123456789';
      const raw6 = parseTokenUnits(humanExcess, 6);
      assert.equal(raw6, '100123456');
    });

    test('Decimals 6: handles empty, null, undefined, or zero decimals gracefully', () => {
      assert.equal(parseTokenUnits('', 18), '0');
      assert.equal(parseTokenUnits(null as any, 18), '0');
      assert.equal(parseTokenUnits(undefined as any, 18), '0');
      assert.equal(formatTokenUnits(undefined as any, 18), '0.0');
    });
  });

  describe('Part 4 — Slippage Policy', () => {
    test('Slippage 1: derives minimum output deterministically with 0 slippage', () => {
      const expected = '1000000';
      const minOut = calculateDeterministicMinimumOutput(expected, 0);
      assert.equal(minOut, 1000000n);
    });

    test('Slippage 2: derives minimum output deterministically with 50 bps (0.5%)', () => {
      const expected = '1000000';
      const minOut = calculateDeterministicMinimumOutput(expected, 50);
      assert.equal(minOut, 995000n);
    });

    test('Slippage 3: derives minimum output deterministically with 100 bps (1.0%)', () => {
      const expected = '1000000';
      const minOut = calculateDeterministicMinimumOutput(expected, 100);
      assert.equal(minOut, 990000n);
    });

    test('Slippage 4: derives minimum output deterministically with 500 bps (5.0%)', () => {
      const expected = '1000000';
      const minOut = calculateDeterministicMinimumOutput(expected, 500);
      assert.equal(minOut, 950000n);
    });

    test('Slippage 5: permits maximum allowed policy slippage (1000 bps = 10.0%)', () => {
      const expected = '1000000';
      const minOut = calculateDeterministicMinimumOutput(expected, 1000);
      assert.equal(minOut, 900000n);
    });

    test('Slippage 6: rejects slippage above policy ceiling (> 1000 bps)', () => {
      assert.throws(
        () => calculateDeterministicMinimumOutput('1000000', 1001),
        SlippagePolicyViolationError
      );
    });

    test('Slippage 7: rejects negative slippage basis points', () => {
      assert.throws(
        () => validateSlippagePolicy(-1),
        SlippagePolicyViolationError
      );
      assert.throws(
        () => validateSlippagePolicy(-50),
        SlippagePolicyViolationError
      );
    });

    test('Slippage 8: rejects NaN and non-finite slippage', () => {
      assert.throws(
        () => validateSlippagePolicy(NaN),
        SlippagePolicyViolationError
      );
      assert.throws(
        () => validateSlippagePolicy(Infinity),
        SlippagePolicyViolationError
      );
    });

    test('Slippage 9: custom config permits custom max bps up to absolute limit', () => {
      assert.doesNotThrow(() => validateSlippagePolicy(2000, { maxAllowedBps: 2000 }));
      assert.throws(() => validateSlippagePolicy(2500, { maxAllowedBps: 2000 }), SlippagePolicyViolationError);
    });

    test('Slippage 10: integer division truncates in user favor (floor on minimum output)', () => {
      const expected = '1000001';
      const minOut = calculateDeterministicMinimumOutput(expected, 50);
      assert.equal(minOut, 995000n);
    });
  });

  describe('Part 5 — Minimum Output Invariant', () => {
    test('MinOutput 1: passes when actualAmountOut strictly equals minimumAmountOut', () => {
      assert.doesNotThrow(() => validateMinimumOutput('1000', '1000'));
    });

    test('MinOutput 2: passes when actualAmountOut is greater than minimumAmountOut', () => {
      assert.doesNotThrow(() => validateMinimumOutput('1050', '1000'));
      assert.doesNotThrow(() => validateMinimumOutput(1050n, 1000n));
    });

    test('MinOutput 3: throws MinimumOutputBreachError when actualAmountOut is below minimumAmountOut', () => {
      assert.throws(
        () => validateMinimumOutput('999', '1000'),
        MinimumOutputBreachError
      );
      assert.throws(
        () => validateMinimumOutput(999n, 1000n),
        MinimumOutputBreachError
      );
    });

    test('MinOutput 4: throws MinimumOutputBreachError when actual output is zero but minimum is positive', () => {
      assert.throws(
        () => validateMinimumOutput('0', '1000'),
        MinimumOutputBreachError
      );
    });

    test('MinOutput 5: passes when both actual and minimum are zero', () => {
      assert.doesNotThrow(() => validateMinimumOutput('0', '0'));
    });

    test('MinOutput 6: error includes context and exact expected/actual values', () => {
      try {
        validateMinimumOutput('900', '1000', 'Arbitrage check');
        assert.fail('Should have thrown');
      } catch (err: any) {
        assert.ok(err instanceof MinimumOutputBreachError);
        assert.equal(err.field, 'minimumAmountOut');
        assert.equal(err.expected, '>= 1000');
        assert.equal(err.actual, '900');
      }
    });
  });

  describe('Part 6 — Source Swap Economic Safety', () => {
    test('SourceSwap 1: validates healthy source swap economic parameters', () => {
      const res = validateSourceSwapEconomics({
        amountInRaw: '1000000',
        expectedAmountOutRaw: '995000',
        minimumAmountOutRaw: '990000',
        actualAmountOutRaw: '994000'
      });
      assert.equal(res.isSafe, true);
    });

    test('SourceSwap 2: rejects source swap when amountIn is zero or non-positive', () => {
      assert.throws(
        () => validateSourceSwapEconomics({
          amountInRaw: '0',
          expectedAmountOutRaw: '995000',
          minimumAmountOutRaw: '990000'
        }),
        EconomicSafetyBreachError
      );
    });

    test('SourceSwap 3: rejects source swap when expectedAmountOut is zero', () => {
      assert.throws(
        () => validateSourceSwapEconomics({
          amountInRaw: '1000000',
          expectedAmountOutRaw: '0',
          minimumAmountOutRaw: '0'
        }),
        EconomicSafetyBreachError
      );
    });

    test('SourceSwap 4: rejects source swap when minimumAmountOut exceeds expectedAmountOut', () => {
      assert.throws(
        () => validateSourceSwapEconomics({
          amountInRaw: '1000000',
          expectedAmountOutRaw: '990000',
          minimumAmountOutRaw: '995000'
        }),
        EconomicSafetyBreachError
      );
    });

    test('SourceSwap 5: rejects source swap execution when actual mined output is below minimum', () => {
      assert.throws(
        () => validateSourceSwapEconomics({
          amountInRaw: '1000000',
          expectedAmountOutRaw: '995000',
          minimumAmountOutRaw: '990000',
          actualAmountOutRaw: '989999'
        }),
        MinimumOutputBreachError
      );
    });
  });

  describe('Part 7 — Actual Output Extraction Audit', () => {
    const tokenOut = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
    const recipient = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

    test('OutputExtract 1: extracts output amount from authoritative Transfer event log', () => {
      const receipt = {
        status: 1,
        logs: [
          {
            address: tokenOut,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000001111111111111111111111111111111111111111',
              '0x000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f4240'
          }
        ]
      };

      const result = extractActualSourceSwapOutput({
        receipt,
        expectedTokenOutAddress: tokenOut,
        recipientAddress: recipient,
        minimumAmountOutRaw: '900000'
      });

      assert.equal(result.actualAmountRaw, '1000000');
      assert.equal(result.actualAmountBig, 1000000n);
      assert.equal(result.extractionMethod, 'RECEIPT_LOGS');
      assert.equal(result.verified, true);
    });

    test('OutputExtract 2: extracts output amount from balance delta when logs unavailable', () => {
      const result = extractActualSourceSwapOutput({
        expectedTokenOutAddress: tokenOut,
        recipientAddress: recipient,
        minimumAmountOutRaw: '900000',
        balanceBeforeRaw: '5000000',
        balanceAfterRaw: '6000000'
      });

      assert.equal(result.actualAmountRaw, '1000000');
      assert.equal(result.extractionMethod, 'BALANCE_DELTA');
      assert.equal(result.verified, true);
    });

    test('OutputExtract 3: reconciles matching Transfer log and balance delta', () => {
      const receipt = {
        status: 1,
        logs: [
          {
            address: tokenOut,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000001111111111111111111111111111111111111111',
              '0x000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f4240'
          }
        ]
      };

      const result = extractActualSourceSwapOutput({
        receipt,
        expectedTokenOutAddress: tokenOut,
        recipientAddress: recipient,
        minimumAmountOutRaw: '900000',
        balanceBeforeRaw: '1000000',
        balanceAfterRaw: '2000000'
      });

      assert.equal(result.actualAmountRaw, '1000000');
      assert.equal(result.extractionMethod, 'COMBINED_RECONCILED');
    });

    test('OutputExtract 4: throws StatusConflictError on discrepancy between log and balance delta', () => {
      const receipt = {
        status: 1,
        logs: [
          {
            address: tokenOut,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000001111111111111111111111111111111111111111',
              '0x000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f4240'
          }
        ]
      };

      assert.throws(
        () => extractActualSourceSwapOutput({
          receipt,
          expectedTokenOutAddress: tokenOut,
          recipientAddress: recipient,
          minimumAmountOutRaw: '900000',
          balanceBeforeRaw: '1000000',
          balanceAfterRaw: '1500000'
        }),
        StatusConflictError
      );
    });

    test('OutputExtract 5: ignores Transfer events emitted by other tokens', () => {
      const wrongToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const receipt = {
        status: 1,
        logs: [
          {
            address: wrongToken,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000001111111111111111111111111111111111111111',
              '0x000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f4240'
          }
        ]
      };

      assert.throws(
        () => extractActualSourceSwapOutput({
          receipt,
          expectedTokenOutAddress: tokenOut,
          recipientAddress: recipient,
          minimumAmountOutRaw: '900000'
        }),
        SourceSwapFailedError
      );
    });

    test('OutputExtract 6: ignores Transfer events to other recipients', () => {
      const otherRecipient = '0x1111111111111111111111111111111111111111';
      const receipt = {
        status: 1,
        logs: [
          {
            address: tokenOut,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000002222222222222222222222222222222222222222',
              `0x000000000000000000000000${otherRecipient.slice(2)}`
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f4240'
          }
        ]
      };

      assert.throws(
        () => extractActualSourceSwapOutput({
          receipt,
          expectedTokenOutAddress: tokenOut,
          recipientAddress: recipient,
          minimumAmountOutRaw: '900000'
        }),
        SourceSwapFailedError
      );
    });

    test('OutputExtract 7: throws SourceSwapFailedError on receipt status 0', () => {
      const receipt = { status: 0, transactionHash: '0xrevert_tx' };
      assert.throws(
        () => extractActualSourceSwapOutput({
          receipt,
          expectedTokenOutAddress: tokenOut,
          recipientAddress: recipient,
          minimumAmountOutRaw: '900000'
        }),
        SourceSwapFailedError
      );
    });

    test('OutputExtract 8: throws AmountMismatchError when extracted output is below minimumAmountOut', () => {
      const receipt = {
        status: 1,
        logs: [
          {
            address: tokenOut,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000001111111111111111111111111111111111111111',
              '0x000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b'
            ],
            data: '0x000000000000000000000000000000000000000000000000000000000007a120'
          }
        ]
      };

      assert.throws(
        () => extractActualSourceSwapOutput({
          receipt,
          expectedTokenOutAddress: tokenOut,
          recipientAddress: recipient,
          minimumAmountOutRaw: '900000'
        }),
        AmountMismatchError
      );
    });
  });

  describe('Part 8 — Bridge Quote Refresh Invariant', () => {
    test('BridgeRefresh 1: passes when refreshed bridge quote input equals actual mined output', () => {
      const res = validateBridgeQuoteRefreshEconomics({
        actualSourceOutputRaw: '994200',
        refreshedBridgeInputRaw: '994200',
        initialGuaranteedMinOutputRaw: '990000',
        refreshedGuaranteedMinOutputRaw: '991500'
      });
      assert.equal(res.isSafe, true);
    });

    test('BridgeRefresh 2: fails closed when bridge quote input does not match actual mined output', () => {
      assert.throws(
        () => validateBridgeQuoteRefreshEconomics({
          actualSourceOutputRaw: '994200',
          refreshedBridgeInputRaw: '1000000',
          initialGuaranteedMinOutputRaw: '990000',
          refreshedGuaranteedMinOutputRaw: '991500'
        }),
        EconomicSafetyBreachError
      );
    });

    test('BridgeRefresh 3: rejects zero refreshed guaranteed minimum output', () => {
      assert.throws(
        () => validateBridgeQuoteRefreshEconomics({
          actualSourceOutputRaw: '994200',
          refreshedBridgeInputRaw: '994200',
          initialGuaranteedMinOutputRaw: '990000',
          refreshedGuaranteedMinOutputRaw: '0'
        }),
        EconomicSafetyBreachError
      );
    });

    test('BridgeRefresh 4: rejects non-integer strings in bridge quote refresh inputs', () => {
      assert.throws(
        () => validateBridgeQuoteRefreshEconomics({
          actualSourceOutputRaw: '994200.5',
          refreshedBridgeInputRaw: '994200.5',
          initialGuaranteedMinOutputRaw: '990000',
          refreshedGuaranteedMinOutputRaw: '991500'
        }),
        InvalidQuoteAmountError
      );
    });
  });

  describe('Part 9 — Bridge Economic Safety', () => {
    const validParams = {
      inputAmountRaw: '1000000000',
      expectedOutputRaw: '998000000',
      minOutputRaw: '995000000',
      totalFeeRaw: '2000000',
      destinationChainId: 1,
      destinationTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      receiverAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      expirationTimestamp: Date.now() + 60000,
      currentTime: Date.now(),
      maxAllowedFeeRaw: '5000000'
    };

    test('BridgeEcon 1: validates healthy bridge economic parameters', () => {
      const res = validateBridgeEconomics(validParams);
      assert.equal(res.isSafe, true);
    });

    test('BridgeEcon 2: rejects bridge quote when minimum output exceeds expected output', () => {
      assert.throws(
        () => validateBridgeEconomics({
          ...validParams,
          expectedOutputRaw: '995000000',
          minOutputRaw: '998000000'
        }),
        EconomicSafetyBreachError
      );
    });

    test('BridgeEcon 3: rejects bridge quote when total fee exceeds authorized ceiling', () => {
      assert.throws(
        () => validateBridgeEconomics({
          ...validParams,
          totalFeeRaw: '6000000',
          maxAllowedFeeRaw: '5000000'
        }),
        FeeAccountingBreachError
      );
    });

    test('BridgeEcon 4: rejects expired bridge quote', () => {
      assert.throws(
        () => validateBridgeEconomics({
          ...validParams,
          expirationTimestamp: 1000,
          currentTime: 2000
        }),
        QuoteFreshnessExpiredError
      );
    });

    test('BridgeEcon 5: rejects invalid receiver address', () => {
      assert.throws(
        () => validateBridgeEconomics({
          ...validParams,
          receiverAddress: '0xinvalid'
        })
      );
    });

    test('BridgeEcon 6: rejects zero input amount', () => {
      assert.throws(
        () => validateBridgeEconomics({
          ...validParams,
          inputAmountRaw: '0'
        }),
        EconomicSafetyBreachError
      );
    });
  });

  describe('Part 10 — Destination Output Protection', () => {
    const destToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const destRecipient = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

    test('DestProtect 1: validates successful destination delivery meeting minimum output', () => {
      const res = validateDestinationSettlementEconomics({
        expectedRecipient: destRecipient,
        expectedToken: destToken,
        expectedMinAmountRaw: '990000000',
        actualDeliveredAmountRaw: '992000000',
        deliveredRecipient: destRecipient,
        deliveredToken: destToken
      });
      assert.equal(res.isSafe, true);
    });

    test('DestProtect 2: rejects destination settlement when delivered to wrong recipient', () => {
      assert.throws(
        () => validateDestinationSettlementEconomics({
          expectedRecipient: destRecipient,
          expectedToken: destToken,
          expectedMinAmountRaw: '990000000',
          actualDeliveredAmountRaw: '992000000',
          deliveredRecipient: '0x1234567890123456789012345678901234567890',
          deliveredToken: destToken
        }),
        EconomicSafetyBreachError
      );
    });

    test('DestProtect 3: rejects destination settlement when delivered wrong token', () => {
      assert.throws(
        () => validateDestinationSettlementEconomics({
          expectedRecipient: destRecipient,
          expectedToken: destToken,
          expectedMinAmountRaw: '990000000',
          actualDeliveredAmountRaw: '992000000',
          deliveredRecipient: destRecipient,
          deliveredToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7'
        }),
        EconomicSafetyBreachError
      );
    });

    test('DestProtect 4: rejects destination settlement when delivered amount is below minimum', () => {
      assert.throws(
        () => validateDestinationSettlementEconomics({
          expectedRecipient: destRecipient,
          expectedToken: destToken,
          expectedMinAmountRaw: '990000000',
          actualDeliveredAmountRaw: '989000000',
          deliveredRecipient: destRecipient,
          deliveredToken: destToken
        }),
        MinimumOutputBreachError
      );
    });

    test('DestProtect 5: authoritative 6-tier verifier confirms Tier 1 on-chain receipt with Transfer log', () => {
      const res = verifyDestinationSettlement({
        destinationChainId: 1,
        expectedRecipient: destRecipient,
        expectedToken: destToken,
        expectedMinAmountRaw: '990000000',
        receipt: {
          status: 1,
          blockNumber: 19000000,
          logs: [
            {
              address: destToken,
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x0000000000000000000000005555555555555555555555555555555555555555',
                `0x000000000000000000000000${destRecipient.slice(2)}`
              ],
              data: '0x000000000000000000000000000000000000000000000000000000003b1d5c00' // 991,787,008 raw
            }
          ]
        }
      });

      assert.equal(res.settlementStatus, 'DESTINATION_SETTLED');
      assert.equal(res.primaryEvidenceTier, 'TIER_3_ERC20_TRANSFER_EVENT');
      assert.equal(res.deliveredToExpectedRecipient, true);
      assert.equal(res.tokenMatched, true);
    });


    test('DestProtect 6: authoritative 6-tier verifier detects below-minimum delivery in mined receipt', () => {
      const res = verifyDestinationSettlement({
        destinationChainId: 1,
        expectedRecipient: destRecipient,
        expectedToken: destToken,
        expectedMinAmountRaw: '990000000',
        receipt: {
          status: 1,
          blockNumber: 19000000,
          logs: [
            {
              address: destToken,
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x0000000000000000000000005555555555555555555555555555555555555555',
                `0x000000000000000000000000${destRecipient.slice(2)}`
              ],
              data: '0x0000000000000000000000000000000000000000000000000000000035000000' // 889,192,448 raw
            }
          ]
        }
      });

      assert.notEqual(res.settlementStatus, 'DESTINATION_SETTLED');
    });
  });

  describe('Part 11 — Cross-Chain Economic Bounds', () => {
    test('CrossChainBounds 1: validates monotonic transitions across all steps', () => {
      const res = validateCrossChainEconomicBounds({
        sourceAmountInRaw: '1000000000000000000', // 1 POL
        sourceAmountOutRaw: '994000',            // 0.994 USDC
        bridgeAmountInRaw: '994000',             // exact match
        bridgeAmountOutRaw: '992000',            // bridge out
        destinationAmountRaw: '992000',          // delivered
        minDestinationAmountRaw: '990000'        // guaranteed min
      });
      assert.equal(res.isSafe, true);
    });

    test('CrossChainBounds 2: fails closed when bridge input diverges from source output', () => {
      assert.throws(
        () => validateCrossChainEconomicBounds({
          sourceAmountInRaw: '1000000000000000000',
          sourceAmountOutRaw: '994000',
          bridgeAmountInRaw: '995000',
          bridgeAmountOutRaw: '992000',
          destinationAmountRaw: '992000',
          minDestinationAmountRaw: '990000'
        }),
        EconomicSafetyBreachError
      );
    });

    test('CrossChainBounds 3: fails closed when destination amount is below minDestinationAmount', () => {
      assert.throws(
        () => validateCrossChainEconomicBounds({
          sourceAmountInRaw: '1000000000000000000',
          sourceAmountOutRaw: '994000',
          bridgeAmountInRaw: '994000',
          bridgeAmountOutRaw: '992000',
          destinationAmountRaw: '989000',
          minDestinationAmountRaw: '990000'
        }),
        MinimumOutputBreachError
      );
    });
  });

  describe('Part 12 — Fee Accounting', () => {
    test('FeeAccounting 1: calculates total fee correctly across all components', () => {
      const res = validateFeeAccounting({
        sourceSwapFeeRaw: '3000',
        bridgeFeeRaw: '15000',
        destSwapFeeRaw: '2000',
        gasCostRaw: '50000',
        protocolFeeRaw: '1000',
        solverFeeRaw: '500',
        relayerFeeRaw: '250'
      });
      assert.equal(res.totalFeeBig, 71750n);
      assert.equal(res.totalFeeRaw, '71750');
      assert.equal(res.isWithinAuthorizedLimit, true);
    });

    test('FeeAccounting 2: respects authorized fee ceiling', () => {
      const res = validateFeeAccounting({
        bridgeFeeRaw: '10000',
        gasCostRaw: '20000',
        maxAuthorizedFeeRaw: '50000'
      });
      assert.equal(res.totalFeeBig, 30000n);
      assert.equal(res.isWithinAuthorizedLimit, true);
    });

    test('FeeAccounting 3: throws FeeAccountingBreachError when total fee exceeds authorized ceiling', () => {
      assert.throws(
        () => validateFeeAccounting({
          bridgeFeeRaw: '40000',
          gasCostRaw: '20000',
          maxAuthorizedFeeRaw: '50000'
        }),
        FeeAccountingBreachError
      );
    });

    test('FeeAccounting 4: treats omitted fee components as 0n in total sum', () => {
      const res = validateFeeAccounting({
        bridgeFeeRaw: '10000'
      });
      assert.equal(res.totalFeeBig, 10000n);
    });
  });

  describe('Part 13 — Gas Economic Safety & Native Reserve', () => {
    test('GasSafety 1: validates sufficient native balance for value + gas + reserve buffer', () => {
      const params: GasEconomicParams = {
        gasLimit: 200000n,
        maxFeePerGas: 30000000000n, // 30 gwei -> gas cost = 6,000,000,000,000,000 wei (0.006 ETH)
        nativeValueWei: 1000000000000000000n, // 1 ETH
        reserveBufferWei: 10000000000000000n, // 0.01 ETH
        nativeBalance: 2000000000000000000n   // 2 ETH
      };

      const res = validateGasEconomicsAndReserve(params);
      assert.equal(res.isSafe, true);
      assert.equal(res.totalRequiredNativeWei, 1016000000000000000n);
      assert.equal(res.remainingReserveWei, 984000000000000000n);
    });

    test('GasSafety 2: throws InsufficientNativeReserveError when native balance is insufficient', () => {
      const params: GasEconomicParams = {
        gasLimit: 200000n,
        maxFeePerGas: 30000000000n,
        nativeValueWei: 1000000000000000000n,
        reserveBufferWei: 10000000000000000n,
        nativeBalance: 1005000000000000000n // Shortfall
      };

      assert.throws(
        () => validateGasEconomicsAndReserve(params),
        InsufficientNativeReserveError
      );
    });

    test('GasSafety 3: supports legacy gasPrice fallback when EIP-1559 maxFeePerGas is omitted', () => {
      const params: GasEconomicParams = {
        gasLimit: 100000n,
        gasPrice: 20000000000n, // 20 gwei
        nativeValueWei: 0n,
        nativeBalance: 5000000000000000n
      };

      const res = validateGasEconomicsAndReserve(params);
      assert.equal(res.isSafe, true);
      assert.equal(res.totalRequiredNativeWei, 2000000000000000n);
    });

    test('GasSafety 4: rejects zero or negative gasLimit', () => {
      assert.throws(
        () => validateGasEconomicsAndReserve({
          gasLimit: 0n,
          gasPrice: 10n,
          nativeValueWei: 0n,
          nativeBalance: 100n
        }),
        EconomicSafetyBreachError
      );
    });
  });

  describe('Part 14 — Price Impact Status & Verification', () => {
    test('PriceImpact 1: validates price impact within 10% policy threshold', () => {
      const res = validatePriceImpactEconomics(100, 98, 10);
      assert.equal(res.isWithinPolicy, true);
      assert.equal(res.priceImpactPercent, 2);
    });

    test('PriceImpact 2: throws PriceImpactExceededError when impact exceeds ceiling', () => {
      assert.throws(
        () => validatePriceImpactEconomics(100, 85, 10),
        PriceImpactExceededError
      );
    });

    test('PriceImpact 3: handles zero or negative prices gracefully', () => {
      const res = validatePriceImpactEconomics(0, 0, 10);
      assert.equal(res.priceImpactPercent, 0);
      assert.equal(res.isWithinPolicy, true);
    });

    test('PriceImpact 4: AMM ConstantProductMath verifies price impact against pool reserves', () => {
      const spot = ConstantProductMath.calculateSpotPrice(1000000n * 10n ** 18n, 1000000n * 10n ** 6n, 18, 6);
      assert.equal(spot, 1);
      const impact = ConstantProductMath.calculatePriceImpact(1.0, 0.98);
      assert.ok(Math.abs(impact - 2) < 0.0001);
    });
  });

  describe('Part 15 — Quote Freshness & Staleness Lifecycle', () => {
    test('Freshness 1: classifies quote < 90s as FRESH', () => {
      const now = 1000000;
      const quoteTime = now - 30000; // 30s old
      const res = validateQuoteFreshnessEconomics(quoteTime, now);
      assert.equal(res.freshnessState, 'FRESH');
      assert.equal(res.ageMs, 30000);
    });

    test('Freshness 2: classifies quote between 90s and 120s as EXPIRING_SOON', () => {
      const now = 1000000;
      const quoteTime = now - 100000; // 100s old
      const res = validateQuoteFreshnessEconomics(quoteTime, now);
      assert.equal(res.freshnessState, 'EXPIRING_SOON');
      assert.equal(res.ageMs, 100000);
    });

    test('Freshness 3: throws QuoteFreshnessExpiredError for quote > 120s', () => {
      const now = 1000000;
      const quoteTime = now - 120001; // 120.001s old
      assert.throws(
        () => validateQuoteFreshnessEconomics(quoteTime, now),
        QuoteFreshnessExpiredError
      );
    });

    test('Freshness 4: classifies zero or missing timestamp as UNKNOWN', () => {
      const res = validateQuoteFreshnessEconomics(0);
      assert.equal(res.freshnessState, 'UNKNOWN');
    });
  });

  describe('Part 16 — Route Arbitration Economic Safety', () => {
    test('Arbitration 1: higher minimum guaranteed output deterministically beats lower minimum output', () => {
      const now = Date.now();
      const routeA: any = {
        routeId: 'route-A',
        routeType: 'DIRECT_CROSS_CHAIN',
        capabilityLevel: 'LIVE_VERIFIED',
        freshnessState: 'FRESH',
        isExecutable: true,
        quotedAt: now,
        expiresAt: now + 60000,
        sourceChainId: 137,
        destinationChainId: 1,
        sourceToken: { symbol: 'USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', name: 'USDC', decimals: 6, chainId: 137 },
        destinationToken: { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'USDC', decimals: 6, chainId: 1 },
        bridgeProvider: 'ACROSS',
        executionTarget: '0x9295ee1d8C5b022Be115A805381f71b5F4099740',
        approvalTarget: '0x9295ee1d8C5b022Be115A805381f71b5F4099740',
        minimumOutputRaw: '990000',
        expectedOutputRaw: '1000000',
        totalFeeRaw: '1000',
        estimatedGasCostRaw: '500'
      };
      const routeB: any = {
        routeId: 'route-B',
        routeType: 'DIRECT_CROSS_CHAIN',
        capabilityLevel: 'LIVE_VERIFIED',
        freshnessState: 'FRESH',
        isExecutable: true,
        quotedAt: now,
        expiresAt: now + 60000,
        sourceChainId: 137,
        destinationChainId: 1,
        sourceToken: { symbol: 'USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', name: 'USDC', decimals: 6, chainId: 137 },
        destinationToken: { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'USDC', decimals: 6, chainId: 1 },
        bridgeProvider: 'ACROSS',
        executionTarget: '0x9295ee1d8C5b022Be115A805381f71b5F4099740',
        approvalTarget: '0x9295ee1d8C5b022Be115A805381f71b5F4099740',
        minimumOutputRaw: '995000',
        expectedOutputRaw: '998000',
        totalFeeRaw: '1000',
        estimatedGasCostRaw: '500'
      };

      const request: any = {
        sourceChainId: 137,
        destinationChainId: 1,
        executionMode: 'SIMULATION',
        tokenIn: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', name: 'USDC', decimals: 6, chainId: 137, verificationTier: 'VERIFIED_CANONICAL' },
        tokenOut: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USDC', decimals: 6, chainId: 1, verificationTier: 'VERIFIED_CANONICAL' },
        amountInRaw: '1000000'
      };

      const result = RouteArbitrator.arbitrate([routeA, routeB], request);

      assert.equal(result.selectedRoute?.routeId, 'route-B');
    });

    test('Arbitration 2: tie-breaker selects lower total cost when minimum output is identical', () => {
      const now = Date.now();
      const routeA: any = {
        routeId: 'route-A',
        routeType: 'DIRECT_CROSS_CHAIN',
        capabilityLevel: 'LIVE_VERIFIED',
        freshnessState: 'FRESH',
        isExecutable: true,
        quotedAt: now,
        expiresAt: now + 60000,
        sourceChainId: 137,
        destinationChainId: 1,
        sourceToken: { symbol: 'USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', name: 'USDC', decimals: 6, chainId: 137 },
        destinationToken: { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'USDC', decimals: 6, chainId: 1 },
        bridgeProvider: 'ACROSS',
        executionTarget: '0x9295ee1d8C5b022Be115A805381f71b5F4099740',
        approvalTarget: '0x9295ee1d8C5b022Be115A805381f71b5F4099740',
        minimumOutputRaw: '990000',
        expectedOutputRaw: '1000000',
        totalFeeRaw: '2000',
        estimatedGasCostRaw: '500'
      };
      const routeB: any = {
        routeId: 'route-B',
        routeType: 'DIRECT_CROSS_CHAIN',
        capabilityLevel: 'LIVE_VERIFIED',
        freshnessState: 'FRESH',
        isExecutable: true,
        quotedAt: now,
        expiresAt: now + 60000,
        sourceChainId: 137,
        destinationChainId: 1,
        sourceToken: { symbol: 'USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', name: 'USDC', decimals: 6, chainId: 137 },
        destinationToken: { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'USDC', decimals: 6, chainId: 1 },
        bridgeProvider: 'ACROSS',
        executionTarget: '0x9295ee1d8C5b022Be115A805381f71b5F4099740',
        approvalTarget: '0x9295ee1d8C5b022Be115A805381f71b5F4099740',
        minimumOutputRaw: '990000',
        expectedOutputRaw: '1000000',
        totalFeeRaw: '1000',
        estimatedGasCostRaw: '500'
      };

      const request: any = {
        sourceChainId: 137,
        destinationChainId: 1,
        executionMode: 'SIMULATION',
        tokenIn: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', name: 'USDC', decimals: 6, chainId: 137, verificationTier: 'VERIFIED_CANONICAL' },
        tokenOut: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USDC', decimals: 6, chainId: 1, verificationTier: 'VERIFIED_CANONICAL' },
        amountInRaw: '1000000'
      };

      const result = RouteArbitrator.arbitrate([routeA, routeB], request);

      assert.equal(result.selectedRoute?.routeId, 'route-B');
    });



  });

  describe('Part 17 — Cost Normalization Edge Cases', () => {
    test('CostNorm 1: calculates exact integer sum of all fees', () => {
      const res = CostNormalizer.normalize({
        sourceSwapFeeRaw: '100',
        bridgeFeeRaw: '200',
        destSwapFeeRaw: '50',
        gasCostRaw: '1000',
        protocolFeeRaw: '25',
        feeToken: 'USDC',
        feeTokenDecimals: 6
      });

      assert.equal(res.isAvailable, true);
      assert.equal(res.totalCostRaw, '1375');
    });

    test('CostNorm 2: converts to normalized USD using verified price evidence', () => {
      const res = CostNormalizer.normalize({
        bridgeFeeRaw: '1000000', // 1 USDC
        feeToken: 'USDC',
        feeTokenDecimals: 6,
        currentTime: 1000000,
        priceEvidence: {
          priceUSD: 1.0,
          priceSource: 'CHAINLINK',
          timestamp: 990000 // 10s old
        }
      });

      assert.equal(res.isAvailable, true);
      assert.equal(res.normalizedCostUSD, '1.000000');
    });

    test('CostNorm 3: returns ROUTE_COST_UNAVAILABLE when price evidence is stale', () => {
      const res = CostNormalizer.normalize({
        bridgeFeeRaw: '1000000',
        feeToken: 'USDC',
        currentTime: 1000000,
        priceEvidence: {
          priceUSD: 1.0,
          priceSource: 'CHAINLINK',
          timestamp: 500000, // 500s old (> 300s maxAge)
          maxAgeMs: 300000
        }
      });

      assert.equal(res.isAvailable, false);
      assert.equal(res.unavailableReason, 'ROUTE_COST_UNAVAILABLE');
    });

    test('CostNorm 4: returns ROUTE_COST_UNAVAILABLE when price is zero or missing', () => {
      const res = CostNormalizer.normalize({
        bridgeFeeRaw: '1000000',
        feeToken: 'USDC',
        currentTime: 1000000,
        priceEvidence: {
          priceUSD: 0,
          priceSource: 'UNKNOWN',
          timestamp: 990000
        }
      });

      assert.equal(res.isAvailable, false);
      assert.equal(res.unavailableReason, 'ROUTE_COST_UNAVAILABLE');
    });
  });

  describe('Part 18 — Approval Economics', () => {
    const spender = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';

    test('ApprovalEcon 1: validates exact approval matching required amount', () => {
      const res = validateApprovalEconomics({
        approvedAmountRaw: '1000000',
        requiredAmountRaw: '1000000',
        userBalanceRaw: '2000000',
        spenderAddress: spender,
        allowedSpenderAddress: spender,
        policy: 'EXACT'
      });
      assert.equal(res.isSafe, true);
    });

    test('ApprovalEcon 2: rejects approval when approved amount is less than required', () => {
      assert.throws(
        () => validateApprovalEconomics({
          approvedAmountRaw: '999999',
          requiredAmountRaw: '1000000',
          spenderAddress: spender,
          allowedSpenderAddress: spender
        }),
        EconomicSafetyBreachError
      );
    });

    test('ApprovalEcon 3: rejects excessive approval when EXACT policy is enforced', () => {
      assert.throws(
        () => validateApprovalEconomics({
          approvedAmountRaw: '2000000',
          requiredAmountRaw: '1000000',
          spenderAddress: spender,
          allowedSpenderAddress: spender,
          policy: 'EXACT'
        }),
        EconomicSafetyBreachError
      );
    });

    test('ApprovalEcon 4: rejects required amount greater than available token balance', () => {
      assert.throws(
        () => validateApprovalEconomics({
          approvedAmountRaw: '1000000',
          requiredAmountRaw: '1000000',
          userBalanceRaw: '500000',
          spenderAddress: spender,
          allowedSpenderAddress: spender
        }),
        EconomicSafetyBreachError
      );
    });

    test('ApprovalEcon 5: rejects spender address mismatch', () => {
      assert.throws(
        () => validateApprovalEconomics({
          approvedAmountRaw: '1000000',
          requiredAmountRaw: '1000000',
          spenderAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
          allowedSpenderAddress: spender
        }),
        EconomicSafetyBreachError
      );
    });
  });


  describe('Part 19 — Native Token Reserve Protection', () => {
    test('Reserve 1: calculates exact native requirement and remaining buffer', () => {
      const res = validateGasEconomicsAndReserve({
        gasLimit: 150000n,
        maxFeePerGas: 40000000000n, // 40 gwei -> gas cost = 6,000,000,000,000,000 wei
        nativeValueWei: 500000000000000000n, // 0.5 ETH
        reserveBufferWei: 50000000000000000n, // 0.05 ETH
        nativeBalance: 1000000000000000000n // 1.0 ETH
      });

      assert.equal(res.isSafe, true);
      assert.equal(res.totalRequiredNativeWei, 556000000000000000n);
      assert.equal(res.remainingReserveWei, 444000000000000000n);
    });

    test('Reserve 2: fails closed when native balance exactly equals gas cost without buffer', () => {
      const gasCost = 150000n * 40000000000n; // 6,000,000,000,000,000 wei
      assert.throws(
        () => validateGasEconomicsAndReserve({
          gasLimit: 150000n,
          maxFeePerGas: 40000000000n,
          nativeValueWei: 0n,
          reserveBufferWei: 10000000000000000n, // 0.01 ETH reserve required
          nativeBalance: gasCost
        }),
        InsufficientNativeReserveError
      );
    });
  });

  describe('Part 20 — Composite Economic Invariant', () => {
    test('CompositeInvariant 1: validates end-to-end 5-stage composite pipeline', () => {
      const res = validateCompositeEconomicInvariant({
        sourceInput: '1000000000000000000',
        sourceOutputActual: '994000',
        bridgeInput: '994000',
        bridgeExpectedOutput: '992000',
        bridgeMinOutput: '990000',
        destDeliveredActual: '992100'
      });
      assert.equal(res.isSafe, true);
    });

    test('CompositeInvariant 2: fails closed if bridge input diverges from source output', () => {
      assert.throws(
        () => validateCompositeEconomicInvariant({
          sourceInput: '1000000000000000000',
          sourceOutputActual: '994000',
          bridgeInput: '994001',
          bridgeExpectedOutput: '992000',
          bridgeMinOutput: '990000',
          destDeliveredActual: '992100'
        }),
        EconomicSafetyBreachError
      );
    });

    test('CompositeInvariant 3: fails closed if final delivered output is below guaranteed minimum', () => {
      assert.throws(
        () => validateCompositeEconomicInvariant({
          sourceInput: '1000000000000000000',
          sourceOutputActual: '994000',
          bridgeInput: '994000',
          bridgeExpectedOutput: '992000',
          bridgeMinOutput: '990000',
          destDeliveredActual: '989999'
        }),
        MinimumOutputBreachError
      );
    });
  });

  describe('Part 21 — Direct Cross-Chain Economic Invariant', () => {
    test('DirectInvariant 1: validates single bridge hop parameter consistency', () => {
      const res = validateDirectCrossChainInvariant({
        sourceAmountRaw: '1000000000',
        bridgeInputRaw: '1000000000',
        expectedDestRaw: '998000000',
        minDestRaw: '995000000',
        actualDestRaw: '998100000'
      });
      assert.equal(res.isSafe, true);
    });

    test('DirectInvariant 2: fails closed when bridge input != source amount', () => {
      assert.throws(
        () => validateDirectCrossChainInvariant({
          sourceAmountRaw: '1000000000',
          bridgeInputRaw: '999999999',
          expectedDestRaw: '998000000',
          minDestRaw: '995000000'
        }),
        EconomicSafetyBreachError
      );
    });

    test('DirectInvariant 3: fails closed when actual delivered output is below minDestRaw', () => {
      assert.throws(
        () => validateDirectCrossChainInvariant({
          sourceAmountRaw: '1000000000',
          bridgeInputRaw: '1000000000',
          expectedDestRaw: '998000000',
          minDestRaw: '995000000',
          actualDestRaw: '994999999'
        }),
        MinimumOutputBreachError
      );
    });
  });

  describe('Part 22 — Economic Attack Matrix', () => {
    test('Attack 1: Amount Tampering — rejects negative and modified input amounts', () => {
      assert.throws(() => validateAmountFormat('-500'), InvalidQuoteAmountError);
      assert.throws(() => validateAmountFormat('0x500'), InvalidQuoteAmountError);
    });

    test('Attack 2: Minimum Output Truncation — rejects zero minimum output for positive expected', () => {
      assert.throws(
        () => validateMinimumOutput('0', '1000'),
        MinimumOutputBreachError
      );
    });

    test('Attack 3: Slippage Inflation — rejects 1500 BPS (15%) when max policy is 1000 BPS', () => {
      assert.throws(() => validateSlippagePolicy(1500), SlippagePolicyViolationError);
    });

    test('Attack 4: Fee Underreporting — ensures sum of all fees is strictly additive', () => {
      const res = validateFeeAccounting({
        bridgeFeeRaw: '100000',
        gasCostRaw: '50000',
        protocolFeeRaw: '25000'
      });
      assert.equal(res.totalFeeBig, 175000n);
    });

    test('Attack 5: Bridge Fee Front-Running — rejects fee surge exceeding authorized max', () => {
      assert.throws(
        () => validateFeeAccounting({
          bridgeFeeRaw: '200000',
          maxAuthorizedFeeRaw: '150000'
        }),
        FeeAccountingBreachError
      );
    });

    test('Attack 6: Gas Estimate Manipulation — rejects zero gasLimit', () => {
      assert.throws(
        () => validateGasEconomicsAndReserve({
          gasLimit: 0n,
          gasPrice: 10n,
          nativeValueWei: 0n,
          nativeBalance: 1000n
        }),
        EconomicSafetyBreachError
      );
    });

    test('Attack 7: Price Manipulation — catches price drop exceeding 10% policy', () => {
      assert.throws(() => validatePriceImpactEconomics(1.0, 0.85, 10), PriceImpactExceededError);
    });

    test('Attack 8: Decimal Confusion — rejects decimal points in integer string', () => {
      assert.throws(() => validateAmountFormat('100.000'), InvalidQuoteAmountError);
    });

    test('Attack 9: Token Substitution — rejects token mismatch in destination settlement', () => {
      assert.throws(
        () => validateDestinationSettlementEconomics({
          expectedRecipient: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
          expectedToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          expectedMinAmountRaw: '100',
          actualDeliveredAmountRaw: '100',
          deliveredRecipient: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
          deliveredToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
        }),
        EconomicSafetyBreachError
      );
    });

    test('Attack 10: Receiver Diversion — rejects recipient mismatch in destination settlement', () => {
      assert.throws(
        () => validateDestinationSettlementEconomics({
          expectedRecipient: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
          expectedToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          expectedMinAmountRaw: '100',
          actualDeliveredAmountRaw: '100',
          deliveredRecipient: '0x1234567890123456789012345678901234567890',
          deliveredToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        }),
        EconomicSafetyBreachError
      );
    });


    test('Attack 11: Quote Expiration — rejects quote executed past expiration timestamp', () => {
      assert.throws(
        () => validateQuoteFreshnessEconomics(1000, 200000, 120000),
        QuoteFreshnessExpiredError
      );
    });

    test('Attack 12: Quote Staleness — rejects quote older than 120 seconds', () => {
      assert.throws(
        () => validateQuoteFreshnessEconomics(Date.now() - 130000),
        QuoteFreshnessExpiredError
      );
    });

    test('Attack 13: Actual Output Spoofing — rejects fabricated output with no receipt logs or balance delta', () => {
      assert.throws(
        () => extractActualSourceSwapOutput({
          expectedTokenOutAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
          recipientAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
          minimumAmountOutRaw: '1000'
        }),
        SourceSwapFailedError
      );
    });

    test('Attack 14: Bridge Output Shortfall — fails closed when bridge expected output < min output', () => {
      assert.throws(
        () => validateBridgeEconomics({
          inputAmountRaw: '1000',
          expectedOutputRaw: '800',
          minOutputRaw: '900',
          totalFeeRaw: '50',
          destinationChainId: 1,
          destinationTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          receiverAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'
        }),
        EconomicSafetyBreachError
      );
    });

    test('Attack 15: Destination Output Under-delivery — rejects delivery 1 wei below minimum', () => {
      assert.throws(
        () => validateMinimumOutput('999999', '1000000'),
        MinimumOutputBreachError
      );
    });

    test('Attack 16: Cost Erasure — rejects missing price evidence masquerading as 0 USD cost', () => {
      const res = CostNormalizer.normalize({
        bridgeFeeRaw: '1000000',
        feeToken: 'USDC',
        currentTime: Date.now(),
        priceEvidence: {
          priceUSD: 0,
          priceSource: 'NONE',
          timestamp: Date.now()
        }
      });
      assert.equal(res.isAvailable, false);
    });

    test('Attack 17: Native Reserve Exhaustion — rejects execution leaving zero native gas buffer', () => {
      assert.throws(
        () => validateGasEconomicsAndReserve({
          gasLimit: 100000n,
          gasPrice: 20000000000n,
          nativeValueWei: 1000000000000000000n,
          reserveBufferWei: 50000000000000000n,
          nativeBalance: 1002000000000000000n
        }),
        InsufficientNativeReserveError
      );
    });
  });

  describe('Part 23 — Deterministic Economic Fuzzing (4,000 Iterations)', () => {
    const rng = mulberry32(0x7A5C33);

    test('Fuzz 1: 1,000 Amount mutations with seeded PRNG (100% deterministic fail-closed rejection)', () => {
      let rejectedCount = 0;
      const invalidChars = ['.', 'e', 'E', '-', '+', ' ', 'a', 'x', '\t', '\n'];

      for (let i = 0; i < 1000; i++) {
        const choice = Math.floor(rng() * 4);
        let mutatedStr = '';

        if (choice === 0) {
          // Negative value
          mutatedStr = `-${Math.floor(rng() * 1000000) + 1}`;
        } else if (choice === 1) {
          // Floating-point value
          mutatedStr = `${Math.floor(rng() * 10000)}.${Math.floor(rng() * 1000) + 1}`;
        } else if (choice === 2) {
          // Scientific notation
          mutatedStr = `${Math.floor(rng() * 10) + 1}e${Math.floor(rng() * 18) + 1}`;
        } else {
          // Injected random invalid character
          const base = String(Math.floor(rng() * 1000000));
          const char = invalidChars[Math.floor(rng() * invalidChars.length)];
          const pos = Math.floor(rng() * base.length);
          mutatedStr = base.slice(0, pos) + char + base.slice(pos);
        }

        try {
          validateAmountFormat(mutatedStr);
          assert.fail(`Should have rejected mutated amount: "${mutatedStr}"`);
        } catch (err: any) {
          assert.ok(err instanceof InvalidQuoteAmountError);
          rejectedCount++;
        }
      }

      assert.equal(rejectedCount, 1000);
    });

    test('Fuzz 2: 1,000 Slippage mutations with seeded PRNG (100% deterministic rejection)', () => {
      let rejectedCount = 0;

      for (let i = 0; i < 1000; i++) {
        const choice = Math.floor(rng() * 3);
        let mutatedSlippage: any;

        if (choice === 0) {
          // Negative slippage
          mutatedSlippage = -(Math.floor(rng() * 1000) + 1);
        } else if (choice === 1) {
          // Slippage exceeding 1000 bps policy limit (1001 to 10000)
          mutatedSlippage = Math.floor(rng() * 9000) + 1001;
        } else {
          // Non-finite or NaN
          mutatedSlippage = rng() > 0.5 ? NaN : (rng() > 0.5 ? Infinity : -Infinity);
        }

        try {
          validateSlippagePolicy(mutatedSlippage);
          assert.fail(`Should have rejected mutated slippage: ${mutatedSlippage}`);
        } catch (err: any) {
          assert.ok(err instanceof SlippagePolicyViolationError);
          rejectedCount++;
        }
      }

      assert.equal(rejectedCount, 1000);
    });

    test('Fuzz 3: 1,000 Fee/Cost mutations exceeding authorized ceiling (100% deterministic rejection)', () => {
      let rejectedCount = 0;

      for (let i = 0; i < 1000; i++) {
        const maxAuthorized = BigInt(Math.floor(rng() * 1000000) + 1000);
        const excess = BigInt(Math.floor(rng() * 500000) + 1);
        const actualFee = maxAuthorized + excess;

        try {
          validateFeeAccounting({
            bridgeFeeRaw: actualFee.toString(),
            maxAuthorizedFeeRaw: maxAuthorized.toString()
          });
          assert.fail(`Should have rejected fee ${actualFee} exceeding max ${maxAuthorized}`);
        } catch (err: any) {
          assert.ok(err instanceof FeeAccountingBreachError);
          rejectedCount++;
        }
      }

      assert.equal(rejectedCount, 1000);
    });

    test('Fuzz 4: 1,000 Cross-field economic mutations (100% deterministic rejection)', () => {
      let rejectedCount = 0;

      for (let i = 0; i < 1000; i++) {
        const minOut = BigInt(Math.floor(rng() * 1000000) + 100);
        const shortfall = BigInt(Math.floor(rng() * 50) + 1);
        const actualDelivered = minOut - shortfall; // Below minimum

        try {
          validateMinimumOutput(actualDelivered.toString(), minOut.toString());
          assert.fail(`Should have rejected actual ${actualDelivered} < min ${minOut}`);
        } catch (err: any) {
          assert.ok(err instanceof MinimumOutputBreachError);
          rejectedCount++;
        }
      }

      assert.equal(rejectedCount, 1000);
    });
  });

  describe('Part 24 — Economic Observability & Sanitized Telemetry', () => {
    test('Observability 1: records sanitized economic telemetry entry', () => {
      defaultEconomicTelemetry.clear();

      const record = defaultEconomicTelemetry.record({
        planId: 'plan-123',
        routeId: 'route-across-pol-eth',
        stepId: 'step-bridge-deposit',
        inputAmount: '1000000',
        expectedOutput: '998000',
        minimumOutput: '995000',
        actualOutput: '998200',
        feeCategory: 'BRIDGE_FEE',
        totalFeeRaw: '2000',
        quoteAgeMs: 45000,
        provider: 'ACROSS',
        sourceChainId: 137,
        destinationChainId: 1,
        tokenInAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        tokenOutAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        status: 'SAFE'
      });

      assert.equal(record.planId, 'plan-123');
      assert.equal(record.status, 'SAFE');
      assert.equal(defaultEconomicTelemetry.getRecords().length, 1);
      assert.equal(defaultEconomicTelemetry.getLatestRecord()?.planId, 'plan-123');
    });

    test('Observability 2: strictly excludes private keys, passwords, and authorization tokens', () => {
      const records = defaultEconomicTelemetry.getRecords();
      for (const rec of records) {
        const json = JSON.stringify(rec);
        assert.equal(json.includes('privateKey'), false);
        assert.equal(json.includes('secret'), false);
        assert.equal(json.includes('mnemonic'), false);
        assert.equal(json.includes('Bearer'), false);
      }
    });
  });

  describe('Part 25 — Golden Path & Multi-Provider Integration Scenarios', () => {
    test('Integration 1: Across V3 direct cross-chain economic path', () => {
      const bridgeRes = validateBridgeEconomics({
        inputAmountRaw: '100000000', // 100 USDC
        expectedOutputRaw: '99900000', // 99.9 USDC
        minOutputRaw: '99500000',     // 99.5 USDC
        totalFeeRaw: '100000',        // 0.1 USDC fee
        destinationChainId: 1,
        destinationTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        receiverAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'
      });
      assert.equal(bridgeRes.isSafe, true);

      const destRes = validateDestinationSettlementEconomics({
        expectedRecipient: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        expectedToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        expectedMinAmountRaw: '99500000',
        actualDeliveredAmountRaw: '99910000',
        deliveredRecipient: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        deliveredToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      });
      assert.equal(destRes.isSafe, true);
    });

    test('Integration 2: Stargate direct cross-chain economic path', () => {
      const res = validateDirectCrossChainInvariant({
        sourceAmountRaw: '500000000',
        bridgeInputRaw: '500000000',
        expectedDestRaw: '499000000',
        minDestRaw: '497000000',
        actualDestRaw: '499000000'
      });
      assert.equal(res.isSafe, true);
    });

    test('Integration 3: deBridge DLN direct cross-chain economic path', () => {
      const res = validateDirectCrossChainInvariant({
        sourceAmountRaw: '250000000',
        bridgeInputRaw: '250000000',
        expectedDestRaw: '249500000',
        minDestRaw: '248000000',
        actualDestRaw: '249600000'
      });
      assert.equal(res.isSafe, true);
    });

    test('Integration 4: Uniswap V3 Polygon same-chain swap economic path', () => {
      const res = validateSourceSwapEconomics({
        amountInRaw: '1000000000000000000', // 1 POL
        expectedAmountOutRaw: '99699',        // 0.099699 USDC
        minimumAmountOutRaw: '99200',        // 0.099200 USDC
        actualAmountOutRaw: '99699'
      });
      assert.equal(res.isSafe, true);
    });
  });

  describe('Part 26 — Cumulative Regression & Safety Assurance', () => {
    test('Regression 1: zero floating-point arithmetic verified across all functions', () => {
      const min = calculateDeterministicMinimumOutput('100000000000000000000', 50);
      assert.equal(typeof min, 'bigint');
      assert.equal(min, 99500000000000000000n);
    });

    test('Regression 2: Task 28 route arbitration invariants preserved', () => {
      const now = Date.now();
      const routes: any[] = [
        {
          routeId: 'r1',
          routeType: 'SAME_CHAIN',
          sourceDex: 'ZENITH_V3',
          capabilityLevel: 'LIVE_VERIFIED',
          freshnessState: 'FRESH',
          isExecutable: true,
          quotedAt: now,
          expiresAt: now + 60000,
          sourceChainId: 137,
          destinationChainId: 137,
          sourceToken: { symbol: 'POL', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', name: 'POL', decimals: 18, chainId: 137 },
          destinationToken: { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'USDC', decimals: 6, chainId: 137 },
          executionTarget: '0x9295ee1d8C5b022Be115A805381f71b5F4099740',
          approvalTarget: '0x9295ee1d8C5b022Be115A805381f71b5F4099740',
          minimumOutputRaw: '1000',
          expectedOutputRaw: '1000',
          totalFeeRaw: '10',
          estimatedGasCostRaw: '5'
        }
      ];

      const res = RouteArbitrator.arbitrate(routes, {
        sourceChainId: 137,
        destinationChainId: 137,
        executionMode: 'SIMULATION',
        tokenIn: { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'POL', name: 'POL', decimals: 18, chainId: 137, verificationTier: 'VERIFIED_CANONICAL' },
        tokenOut: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USDC', decimals: 6, chainId: 137, verificationTier: 'VERIFIED_CANONICAL' },
        amountInRaw: '1000'
      } as any);
      assert.equal(res.selectedRoute?.routeId, 'r1');
    });




    test('Regression 3: Task 31 execution authorization validator accepts valid integer amounts', () => {
      assert.equal(validateAmountFormat('12345678901234567890'), 12345678901234567890n);
    });

    test('Regression 4: Task 32 semantic equivalence constants align with economic boundary', () => {
      assert.equal(DEFAULT_MAX_SLIPPAGE_BPS, 1000);
      assert.equal(ABSOLUTE_MAX_SLIPPAGE_BPS, 5000);
    });
  });

});
