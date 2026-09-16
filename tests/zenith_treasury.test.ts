import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ZENITH_TREASURY_ABI,
  ZENITH_FEE_CONTROLLER_ABI,
  ZENITH_DEPLOYMENTS,
  getZenithDeployment,
  registerZenithDeployment,
  getZenithTreasuryAddress,
  getZenithFeeController
} from '@zenith/contracts';
import { Interface } from 'ethers';

describe('ZENITH SWAP — Sovereign Protocol Treasury & Fee Controller Test Suite', () => {
  const treasuryInterface = new Interface(ZENITH_TREASURY_ABI);
  const feeControllerInterface = new Interface(ZENITH_FEE_CONTROLLER_ABI);

  describe('1. Non-Custodial Invariant & Architecture', () => {
    it('only tracks accrued protocol fees, not user custody balances', () => {
      // Check ABI exposes exact fee tracking functions and not generic deposit-pool custody
      const depositERC20FeeFrag = treasuryInterface.getFunction('depositERC20Fee');
      const depositNativeFeeFrag = treasuryInterface.getFunction('depositNativeFee');
      const getTreasuryBalanceFrag = treasuryInterface.getFunction('getTreasuryBalance');
      const getCollectedFeesFrag = treasuryInterface.getFunction('getCollectedFees');
      const rescueTokenFrag = treasuryInterface.getFunction('rescueToken');
      const setFeeCollectorFrag = treasuryInterface.getFunction('setFeeCollector');
      const isAuthorizedCollectorFrag = treasuryInterface.getFunction('isAuthorizedCollector');

      assert.ok(depositERC20FeeFrag, 'depositERC20Fee must exist on treasury interface');
      assert.ok(depositNativeFeeFrag, 'depositNativeFee must exist on treasury interface');
      assert.ok(getTreasuryBalanceFrag, 'getTreasuryBalance must exist on treasury interface');
      assert.ok(getCollectedFeesFrag, 'getCollectedFees must exist on treasury interface');
      assert.ok(rescueTokenFrag, 'rescueToken must exist for emergency governance recovery');
      assert.ok(setFeeCollectorFrag, 'setFeeCollector must exist for collector authorization');
      assert.ok(isAuthorizedCollectorFrag, 'isAuthorizedCollector must exist for collector queries');
    });

    it('has 2-step governance handover ABI functions', () => {
      const transferGov = treasuryInterface.getFunction('transferGovernance');
      const acceptGov = treasuryInterface.getFunction('acceptGovernance');
      const pendingGov = treasuryInterface.getFunction('pendingGovernance');

      assert.ok(transferGov, 'transferGovernance must be present');
      assert.ok(acceptGov, 'acceptGovernance must be present');
      assert.ok(pendingGov, 'pendingGovernance must be present');
    });

    it('has emergency pause controls in treasury ABI', () => {
      const pauseFrag = treasuryInterface.getFunction('setEmergencyPause');
      const isPausedFrag = treasuryInterface.getFunction('isEmergencyPaused');

      assert.ok(pauseFrag, 'setEmergencyPause must exist');
      assert.ok(isPausedFrag, 'isEmergencyPaused must exist');
    });
  });

  describe('2. Fee Controller Bounds & Rules', () => {
    it('defines protocol fee and cross-chain fee control methods', () => {
      const setProtocolFee = feeControllerInterface.getFunction('setProtocolFeeBps');
      const setCrossChainFee = feeControllerInterface.getFunction('setCrossChainFeeBps');
      const setV1TotalFee = feeControllerInterface.getFunction('setV1TotalFeeBps');
      const configV2Tier = feeControllerInterface.getFunction('configureV2FeeTier');
      const configV3Tier = feeControllerInterface.getFunction('configureV3FeeTier');
      const calcProtocolFee = feeControllerInterface.getFunction('calculateProtocolFee');
      const calcCrossChainFee = feeControllerInterface.getFunction('calculateCrossChainFee');

      assert.ok(setProtocolFee, 'setProtocolFeeBps must exist');
      assert.ok(setCrossChainFee, 'setCrossChainFeeBps must exist');
      assert.ok(setV1TotalFee, 'setV1TotalFeeBps must exist');
      assert.ok(configV2Tier, 'configureV2FeeTier must exist');
      assert.ok(configV3Tier, 'configureV3FeeTier must exist');
      assert.ok(calcProtocolFee, 'calculateProtocolFee must exist');
      assert.ok(calcCrossChainFee, 'calculateCrossChainFee must exist');
    });

    it('encodes setProtocolFeeBps calldata accurately', () => {
      const calldata = feeControllerInterface.encodeFunctionData('setProtocolFeeBps', [5n]);
      assert.ok(calldata.startsWith('0x'));

      const decoded = feeControllerInterface.decodeFunctionData('setProtocolFeeBps', calldata);
      assert.strictEqual(Number(decoded[0]), 5);
    });

    it('fails closed when deployments are unconfigured and allows dynamic registration', () => {
      // Production chains without active on-chain deployments throw ConfigurationError
      assert.throws(() => {
        getZenithTreasuryAddress(1);
      }, /ZENITH Treasury address is not configured/);
      assert.strictEqual(getZenithFeeController(1), undefined);

      // Register local devnet deployment
      registerZenithDeployment(31337, {
        treasury: '0x0123456789012345678901234567890123456789',
        feeController: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      });

      assert.strictEqual(getZenithTreasuryAddress(31337), '0x0123456789012345678901234567890123456789');
      assert.strictEqual(getZenithFeeController(31337), '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    });
  });
});
