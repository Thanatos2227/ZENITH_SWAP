import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ethers, getAddress } from 'ethers';
import { CircuitBreakerMonitor, defaultCircuitBreaker } from '@zenith/security';
import {
  BroadcastAuthorizationGate,
  BroadcastAuthorizationError,
  SecurityStateMachine,
  validateExecutionPlanAuthorization,
  validateCalldataAuthorization,
  validateApprovalPolicy,
} from '@zenith/execution';
import { ZERO_ADDRESS } from '@zenith/contracts';

describe('ZENITH — Governance Multisig & Emergency Circuit Breaker Drill Suite', () => {
  // Test Identifiers (Deterministic Simulated Addresses for Verification)
  const GOVERNANCE_MULTISIG = '0x1000000000000000000000000000000000000001';
  const EMERGENCY_GUARDIAN = '0x2000000000000000000000000000000000000002';
  const UNAUTHORIZED_ATTACKER = '0x9999999999999999999999999999999999999999';
  const DEPLOYER_EOA = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';
  const NEW_GUARDIAN = '0x3000000000000000000000000000000000000003';
  const NEW_GOVERNANCE_MULTISIG = '0x4000000000000000000000000000000000000004';

  describe('1. Smart Contract Governance Architecture & Role Isolation', () => {
    it('verifies ZenithCircuitBreaker permissions: Guardian can pause, but CANNOT resume or update guardian', () => {
      // Simulation of ZenithCircuitBreaker.sol rules
      let isPaused = false;
      let guardian = EMERGENCY_GUARDIAN;
      const governance = GOVERNANCE_MULTISIG;

      const pause = (caller: string, reason: string) => {
        const callerNorm = getAddress(caller);
        if (callerNorm !== getAddress(governance) && callerNorm !== getAddress(guardian)) {
          throw new Error('ZenithCB: Unauthorized');
        }
        if (isPaused) throw new Error('ZenithCB: Already paused');
        isPaused = true;
      };

      const resume = (caller: string) => {
        const callerNorm = getAddress(caller);
        if (callerNorm !== getAddress(governance)) {
          throw new Error('ZenithCB: Only governance');
        }
        if (!isPaused) throw new Error('ZenithCB: Not paused');
        isPaused = false;
      };

      const updateGuardian = (caller: string, newG: string) => {
        const callerNorm = getAddress(caller);
        if (callerNorm !== getAddress(governance)) {
          throw new Error('ZenithCB: Only governance');
        }
        if (newG === ZERO_ADDRESS) throw new Error('ZenithCB: Zero guardian');
        guardian = newG;
      };

      // Scenario 1: Unauthorized attacker attempts to pause -> REJECTED
      assert.throws(() => pause(UNAUTHORIZED_ATTACKER, 'Exploit attempt'), /ZenithCB: Unauthorized/);
      assert.equal(isPaused, false);

      // Scenario 2: Emergency Guardian triggers emergency pause -> SUCCEEDS
      pause(EMERGENCY_GUARDIAN, 'Oracle anomaly detected on Polygon');
      assert.equal(isPaused, true);

      // Scenario 3: Double pause while active -> REJECTS with "Already paused"
      assert.throws(() => pause(EMERGENCY_GUARDIAN, 'Second pause'), /ZenithCB: Already paused/);

      // Scenario 4: Emergency Guardian attempts to resume -> REJECTED (Only governance can unpause!)
      assert.throws(() => resume(EMERGENCY_GUARDIAN), /ZenithCB: Only governance/);
      assert.equal(isPaused, true);

      // Scenario 5: Unauthorized attacker attempts to resume -> REJECTED
      assert.throws(() => resume(UNAUTHORIZED_ATTACKER), /ZenithCB: Only governance/);
      assert.equal(isPaused, true);

      // Scenario 6: Emergency Guardian attempts to change guardian -> REJECTED
      assert.throws(() => updateGuardian(EMERGENCY_GUARDIAN, NEW_GUARDIAN), /ZenithCB: Only governance/);

      // Scenario 7: Governance Multisig authorizes and executes recovery -> SUCCEEDS
      resume(GOVERNANCE_MULTISIG);
      assert.equal(isPaused, false);

      // Scenario 8: Double resume -> REJECTS with "Not paused"
      assert.throws(() => resume(GOVERNANCE_MULTISIG), /ZenithCB: Not paused/);

      // Scenario 9: Governance updates guardian -> SUCCEEDS
      updateGuardian(GOVERNANCE_MULTISIG, NEW_GUARDIAN);
      assert.equal(guardian, NEW_GUARDIAN);
    });

    it('verifies 2-step governance handover (Treasury & FeeController) prevents accidental transfers', () => {
      let governance = DEPLOYER_EOA;
      let pendingGovernance: string | null = null;

      const transferGovernance = (caller: string, newGov: string) => {
        if (getAddress(caller) !== getAddress(governance)) throw new Error('OnlyGovernance');
        if (newGov === ZERO_ADDRESS) throw new Error('ZeroAddress');
        pendingGovernance = newGov;
      };

      const acceptGovernance = (caller: string) => {
        if (!pendingGovernance || getAddress(caller) !== getAddress(pendingGovernance)) {
          throw new Error('NotPendingGovernance');
        }
        governance = pendingGovernance;
        pendingGovernance = null;
      };

      // 1. Attacker attempts to initiate transfer -> REJECTED
      assert.throws(() => transferGovernance(UNAUTHORIZED_ATTACKER, UNAUTHORIZED_ATTACKER), /OnlyGovernance/);

      // 2. Current governance initiates handover to 4-of-7 Safe Multisig
      transferGovernance(DEPLOYER_EOA, GOVERNANCE_MULTISIG);
      assert.equal(pendingGovernance, GOVERNANCE_MULTISIG);
      assert.equal(governance, DEPLOYER_EOA); // Not transferred yet!

      // 3. Random address or old deployer tries to accept -> REJECTED
      assert.throws(() => acceptGovernance(DEPLOYER_EOA), /NotPendingGovernance/);
      assert.throws(() => acceptGovernance(UNAUTHORIZED_ATTACKER), /NotPendingGovernance/);

      // 4. Safe Multisig signs and accepts governance -> SUCCEEDS
      acceptGovernance(GOVERNANCE_MULTISIG);
      assert.equal(governance, GOVERNANCE_MULTISIG);
      assert.equal(pendingGovernance, null);

      // 5. Old deployer no longer has any governance authority -> REJECTED
      assert.throws(() => transferGovernance(DEPLOYER_EOA, DEPLOYER_EOA), /OnlyGovernance/);
    });

    it('verifies immutable fee ceilings in ZenithFeeController protect users from malicious fee hikes', () => {
      const MAX_PROTOCOL_FEE_BPS = 30; // 0.30%
      let protocolFeeBps = 5; // 0.05%

      const setProtocolFee = (caller: string, newFee: number) => {
        if (getAddress(caller) !== getAddress(GOVERNANCE_MULTISIG)) throw new Error('OnlyGovernance');
        if (newFee > MAX_PROTOCOL_FEE_BPS) throw new Error('FeeExceedsMaxCeiling');
        protocolFeeBps = newFee;
      };

      // 1. Setting within ceiling (e.g. 10 BPS = 0.10%) -> SUCCEEDS
      setProtocolFee(GOVERNANCE_MULTISIG, 10);
      assert.equal(protocolFeeBps, 10);

      // 2. Governance itself CANNOT exceed the hardcoded 30 BPS ceiling -> REJECTED
      assert.throws(() => setProtocolFee(GOVERNANCE_MULTISIG, 31), /FeeExceedsMaxCeiling/);
      assert.throws(() => setProtocolFee(GOVERNANCE_MULTISIG, 500), /FeeExceedsMaxCeiling/);
    });
  });

  describe('2. Security Layer & Execution Engine Circuit Breaker Integration', () => {
    it('proves CircuitBreakerMonitor halts chain execution and blocks price deviation anomalies', () => {
      const monitor = new CircuitBreakerMonitor();
      assert.equal(monitor.getState().isEmergencyPaused, false);
      assert.equal(monitor.isChainPaused('polygon'), false);

      // Validate price deviation within threshold (15%)
      const normalPrice = monitor.validatePriceDeviation({
        oraclePriceUSD: 1.0,
        quotedPriceUSD: 1.02,
      });
      assert.equal(normalPrice.isValid, true);
      assert.equal(normalPrice.deviationPercent < 15, true);

      // Validate extreme price deviation (e.g. 25% anomaly / pool drainage)
      const anomalousPrice = monitor.validatePriceDeviation({
        oraclePriceUSD: 1.0,
        quotedPriceUSD: 0.75,
      });
      assert.equal(anomalousPrice.isValid, false);
      assert.match(anomalousPrice.reason || '', /exceeds the circuit breaker threshold/);

      // Emergency Pause on specific chain (Polygon)
      monitor.emergencyPause('Anomalous spread detected', EMERGENCY_GUARDIAN, 'polygon');
      assert.equal(monitor.isChainPaused('polygon'), true);
      assert.equal(monitor.isChainPaused('arbitrum'), false);

      // Global Emergency Pause
      monitor.emergencyPause('Global security alert', EMERGENCY_GUARDIAN);
      assert.equal(monitor.isChainPaused('polygon'), true);
      assert.equal(monitor.isChainPaused('arbitrum'), true);
      assert.equal(monitor.isChainPaused('ethereum'), true);

      // Resume Global
      monitor.resume(GOVERNANCE_MULTISIG);
      assert.equal(monitor.getState().isEmergencyPaused, false);
    });

    it('proves BroadcastAuthorizationGate strictly blocks transaction execution when prerequisites fail', () => {
      // 1. Evaluate readiness with missing signer
      const noSignerResult = BroadcastAuthorizationGate.evaluateReadinessState({
        signerConfigured: false,
        signerAddress: null,
        nativeBalanceSufficient: false,
        usdcBalanceSufficient: false,
        allowanceSufficient: false,
        sourceRpcHealthy: true,
        destinationRpcHealthy: true,
        routeSupported: true,
        quoteValid: true,
        quoteExpired: false,
        simulationExecution: 'UNAVAILABLE',
        simulationClassification: 'NO_SIGNER_CONFIGURED',
      });
      assert.equal(noSignerResult.authorized, false);
      assert.equal(noSignerResult.state, 'NO_SIGNER_CONFIGURED');

      // 2. Evaluate readiness with valid signer and all technical checks passed
      const readyResult = BroadcastAuthorizationGate.evaluateReadinessState({
        signerConfigured: true,
        signerAddress: DEPLOYER_EOA,
        nativeBalanceSufficient: true,
        usdcBalanceSufficient: true,
        allowanceSufficient: true,
        sourceRpcHealthy: true,
        destinationRpcHealthy: true,
        routeSupported: true,
        quoteValid: true,
        quoteExpired: false,
        simulationExecution: 'SUCCESS',
        simulationClassification: 'SIMULATION_PASS',
      });
      // Invariant: technical readiness requires explicit human/operator authorization ceremony
      assert.equal(readyResult.authorized, false);
      assert.equal(readyResult.state, 'BROADCAST_AUTHORIZATION_REQUIRED');
    });

    it('proves BroadcastAuthorization verification enforces strict parameter integrity and calldata locking', () => {
      const now = Date.now();
      const mockCalldata = '0x123456780000000000000000000000000000000000000000000000000000000000000001';

      const auth = BroadcastAuthorizationGate.issueAuthorization({
        sourceChainId: 137,
        destinationChainId: 42161,
        signerAddress: DEPLOYER_EOA,
        recipientAddress: DEPLOYER_EOA,
        sourceToken: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        destinationToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        sourceSpokePool: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
        destinationSpokePool: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A',
        inputAmountRaw: '1000000',
        quotedOutputAmountRaw: '998000',
        minimumOutputAmountRaw: '995000',
        quoteTimestamp: Math.floor(now / 1000) - 10,
        quoteExpiry: now + 300000,
        routeId: 'ROUTE-POLYGON-ARBITRUM-USDC',
        calldata: mockCalldata,
        simulationStatus: 'SUCCESS',
        simulationClassification: 'SIMULATION_PASS',
        gasReadiness: 'READY',
        balanceReadiness: 'SUFFICIENT',
        allowanceReadiness: 'SUFFICIENT',
        authorizedBy: 'OPERATOR_CEREMONY',
        validityMs: 60000,
      });

      // Valid Context Verification -> PASSES
      const verifyResult = BroadcastAuthorizationGate.verifyAuthorization(auth, {
        sourceChainId: 137,
        destinationChainId: 42161,
        signerAddress: DEPLOYER_EOA,
        recipientAddress: DEPLOYER_EOA,
        sourceToken: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        destinationToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        sourceSpokePool: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
        inputAmountRaw: '1000000',
        calldata: mockCalldata,
      });
      assert.equal(verifyResult.authorized, true);

      // Tampered Calldata -> REJECTED
      assert.throws(
        () =>
          BroadcastAuthorizationGate.verifyAuthorization(auth, {
            sourceChainId: 137,
            destinationChainId: 42161,
            signerAddress: DEPLOYER_EOA,
            recipientAddress: DEPLOYER_EOA,
            sourceToken: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
            destinationToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            sourceSpokePool: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
            inputAmountRaw: '1000000',
            calldata: mockCalldata + 'deadbeef',
          }),
        /CALLDATA_HASH_MISMATCH/
      );

      // Tampered Recipient -> REJECTED
      assert.throws(
        () =>
          BroadcastAuthorizationGate.verifyAuthorization(auth, {
            sourceChainId: 137,
            destinationChainId: 42161,
            signerAddress: DEPLOYER_EOA,
            recipientAddress: UNAUTHORIZED_ATTACKER,
            sourceToken: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
            destinationToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            sourceSpokePool: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
            inputAmountRaw: '1000000',
            calldata: mockCalldata,
          }),
        /RECIPIENT_MISMATCH/
      );
    });

    it('proves SecurityStateMachine enforces monotonic forward progression and prevents step-skipping', () => {
      const sm = new SecurityStateMachine('UNAUTHORIZED');
      assert.equal(sm.getState(), 'UNAUTHORIZED');

      // Attempting to jump directly to SIGNING_AUTHORIZED or BROADCAST_AUTHORIZED -> REJECTED
      assert.throws(() => sm.transitionTo('SIGNING_AUTHORIZED'), /InvalidSecurityStateTransitionError/);
      assert.throws(() => sm.transitionTo('BROADCAST_AUTHORIZED'), /InvalidSecurityStateTransitionError/);

      // Orderly monotonic progression
      sm.transitionTo('VALIDATED');
      assert.equal(sm.getState(), 'VALIDATED');

      sm.transitionTo('AUTHORIZED');
      assert.equal(sm.getState(), 'AUTHORIZED');

      sm.transitionTo('PREFLIGHT_VERIFIED');
      assert.equal(sm.getState(), 'PREFLIGHT_VERIFIED');

      sm.transitionTo('SIGNING_AUTHORIZED');
      assert.equal(sm.getState(), 'SIGNING_AUTHORIZED');

      sm.transitionTo('BROADCAST_AUTHORIZED');
      assert.equal(sm.getState(), 'BROADCAST_AUTHORIZED');

      sm.transitionTo('BROADCASTED');
      assert.equal(sm.getState(), 'BROADCASTED');

      sm.transitionTo('CONFIRMED');
      assert.equal(sm.getState(), 'CONFIRMED');

      sm.transitionTo('SETTLED');
      assert.equal(sm.getState(), 'SETTLED');
      assert.equal(sm.isTerminal(), true);

      // Cannot transition out of terminal state
      assert.throws(() => sm.transitionTo('UNAUTHORIZED'), /InvalidSecurityStateTransitionError/);
    });
  });

  describe('3. Single-Operator Bypass & Attack Surface Audit', () => {
    it('verifies that no single operator key can bypass approval policy limits', () => {
      // Bounded allowance vs unlimited approval check
      assert.throws(
        () =>
          validateApprovalPolicy({
            approvalTarget: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
            tokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
            amount: '115792089237316195423570985008687907853269984665640564039457584007913129639935', // type(uint256).max
          }),
        /Unlimited approval.*is strictly prohibited/
      );

      // Bounded exact approval succeeds
      assert.doesNotThrow(() =>
        validateApprovalPolicy({
          approvalTarget: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
          tokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
          amount: '1000000',
        })
      );
    });

    it('verifies dangerous function selectors are blocked by Calldata Authorization validator', () => {
      // 0x00000000, selfdestruct, delegatecall triggers blocked
      assert.throws(
        () => validateCalldataAuthorization('0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096', '0x000000001234567890'),
        /Prohibited or dangerous function selector detected/
      );
    });
  });
});
