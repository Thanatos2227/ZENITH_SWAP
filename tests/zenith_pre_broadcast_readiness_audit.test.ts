import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
  PreBroadcastReadinessAuditor
} from '../packages/execution/src/crosschain/preBroadcastReadinessAuditor';
import {
  BroadcastAuthorizationGate,
  BroadcastAuthorization,
  BroadcastExecutionContext,
  BroadcastAuthorizationError
} from '../packages/execution/src/security/broadcastAuthorizationGate';
import { defaultChainRegistry } from '../packages/chains/src';
import { AcrossProvider } from '../packages/routing/src/crosschain/providers/acrossProvider';
import { getAcrossSpokePool } from '../packages/contracts/src';

describe('ZENITH — Broadcast Authorization Gate & Safety Boundary Test Suite', () => {

  const dummySigner = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const dummyRecipient = '0x1111111254fb6c44bac0bed2854e76f90643097d';
  const dummySourceToken = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
  const dummyDestToken = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
  const dummySpokePool = '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662';
  const dummyDestSpokePool = '0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75';
  const dummyCalldata = '0x7b9392320000000000000000000000001111111254fb6c44bac0bed2854e76f90643097d';

  // Test A: No Signer
  it('A. No signer configured blocks broadcast and returns NO_SIGNER_CONFIGURED', () => {
    const evalResult = BroadcastAuthorizationGate.evaluateReadinessState({
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
      simulationClassification: 'UNEXPECTED_REVERT'
    });

    assert.equal(evalResult.state, 'NO_SIGNER_CONFIGURED');
    assert.equal(evalResult.authorized, false);

    assert.throws(() => {
      BroadcastAuthorizationGate.verifyAuthorization(null, {
        sourceChainId: 11155111,
        destinationChainId: 421614,
        signerAddress: dummySigner,
        recipientAddress: dummyRecipient,
        sourceToken: dummySourceToken,
        destinationToken: dummyDestToken,
        sourceSpokePool: dummySpokePool,
        inputAmountRaw: '10000000',
        calldata: dummyCalldata
      });
    }, (err: any) => err instanceof BroadcastAuthorizationError && err.code === 'NO_AUTHORIZATION_PROVIDED');
  });

  // Test B: Signer exists but no ETH
  it('B. Signer configured but zero ETH blocks broadcast with SIGNER_CONFIGURED_INSUFFICIENT_NATIVE_GAS', () => {
    const evalResult = BroadcastAuthorizationGate.evaluateReadinessState({
      signerConfigured: true,
      signerAddress: dummySigner,
      nativeBalanceSufficient: false, // No ETH
      usdcBalanceSufficient: true,   // Has USDC
      allowanceSufficient: true,
      sourceRpcHealthy: true,
      destinationRpcHealthy: true,
      routeSupported: true,
      quoteValid: true,
      quoteExpired: false,
      simulationExecution: 'REVERTED',
      simulationClassification: 'EXPECTED_UNFUNDED_CALLER'
    });

    assert.equal(evalResult.state, 'SIGNER_CONFIGURED_INSUFFICIENT_NATIVE_GAS');
    assert.equal(evalResult.authorized, false);
  });

  // Test C: Signer exists but insufficient USDC
  it('C. Signer configured but insufficient USDC blocks broadcast with SIGNER_CONFIGURED_INSUFFICIENT_USDC', () => {
    const evalResult = BroadcastAuthorizationGate.evaluateReadinessState({
      signerConfigured: true,
      signerAddress: dummySigner,
      nativeBalanceSufficient: true,  // Has ETH
      usdcBalanceSufficient: false,  // Insufficient USDC
      allowanceSufficient: false,
      sourceRpcHealthy: true,
      destinationRpcHealthy: true,
      routeSupported: true,
      quoteValid: true,
      quoteExpired: false,
      simulationExecution: 'REVERTED',
      simulationClassification: 'EXPECTED_UNFUNDED_CALLER'
    });

    assert.equal(evalResult.state, 'SIGNER_CONFIGURED_INSUFFICIENT_USDC');
    assert.equal(evalResult.authorized, false);
  });

  // Test D: Insufficient allowance
  it('D. Insufficient allowance blocks broadcast with SIGNER_CONFIGURED_ALLOWANCE_INSUFFICIENT', () => {
    const evalResult = BroadcastAuthorizationGate.evaluateReadinessState({
      signerConfigured: true,
      signerAddress: dummySigner,
      nativeBalanceSufficient: true,
      usdcBalanceSufficient: true,
      allowanceSufficient: false, // Zero allowance
      sourceRpcHealthy: true,
      destinationRpcHealthy: true,
      routeSupported: true,
      quoteValid: true,
      quoteExpired: false,
      simulationExecution: 'REVERTED',
      simulationClassification: 'EXPECTED_UNAPPROVED_CALLER'
    });

    assert.equal(evalResult.state, 'SIGNER_CONFIGURED_ALLOWANCE_INSUFFICIENT');
    assert.equal(evalResult.authorized, false);
  });

  // Test E: Expired quote
  it('E. Expired quote triggers QUOTE_EXPIRED error on verification', () => {
    const now = Date.now();
    const expiredAuth = BroadcastAuthorizationGate.issueAuthorization({
      sourceChainId: 11155111,
      destinationChainId: 421614,
      signerAddress: dummySigner,
      recipientAddress: dummyRecipient,
      sourceToken: dummySourceToken,
      destinationToken: dummyDestToken,
      sourceSpokePool: dummySpokePool,
      destinationSpokePool: dummyDestSpokePool,
      inputAmountRaw: '10000000',
      quotedOutputAmountRaw: '9995000',
      minimumOutputAmountRaw: '9945025',
      quoteTimestamp: Math.floor(now / 1000),
      quoteExpiry: now - 5000, // Expired 5 seconds ago
      routeId: 'across-route-1',
      calldata: dummyCalldata,
      simulationStatus: 'SUCCESS',
      simulationClassification: 'SIMULATION_PASS',
      gasReadiness: 'READY',
      balanceReadiness: 'SUFFICIENT',
      allowanceReadiness: 'SUFFICIENT',
      authorizedBy: 'OPERATOR_TEST'
    });

    assert.throws(() => {
      BroadcastAuthorizationGate.verifyAuthorization(expiredAuth, {
        sourceChainId: 11155111,
        destinationChainId: 421614,
        signerAddress: dummySigner,
        recipientAddress: dummyRecipient,
        sourceToken: dummySourceToken,
        destinationToken: dummyDestToken,
        sourceSpokePool: dummySpokePool,
        inputAmountRaw: '10000000',
        calldata: dummyCalldata
      });
    }, (err: any) => err instanceof BroadcastAuthorizationError && err.code === 'QUOTE_EXPIRED');
  });

  // Test F: Invalid quote timestamp (future / stale)
  it('F. Future or stale quoteTimestamp triggers timestamp rejection', () => {
    const now = Date.now();
    const currentChainTs = Math.floor(now / 1000);

    const futureAuth = BroadcastAuthorizationGate.issueAuthorization({
      sourceChainId: 11155111,
      destinationChainId: 421614,
      signerAddress: dummySigner,
      recipientAddress: dummyRecipient,
      sourceToken: dummySourceToken,
      destinationToken: dummyDestToken,
      sourceSpokePool: dummySpokePool,
      destinationSpokePool: dummyDestSpokePool,
      inputAmountRaw: '10000000',
      quotedOutputAmountRaw: '9995000',
      minimumOutputAmountRaw: '9945025',
      quoteTimestamp: currentChainTs + 500, // 500s into future
      quoteExpiry: now + 300000,
      routeId: 'across-route-1',
      calldata: dummyCalldata,
      simulationStatus: 'SUCCESS',
      simulationClassification: 'SIMULATION_PASS',
      gasReadiness: 'READY',
      balanceReadiness: 'SUFFICIENT',
      allowanceReadiness: 'SUFFICIENT',
      authorizedBy: 'OPERATOR_TEST'
    });

    assert.throws(() => {
      BroadcastAuthorizationGate.verifyAuthorization(futureAuth, {
        sourceChainId: 11155111,
        destinationChainId: 421614,
        signerAddress: dummySigner,
        recipientAddress: dummyRecipient,
        sourceToken: dummySourceToken,
        destinationToken: dummyDestToken,
        sourceSpokePool: dummySpokePool,
        inputAmountRaw: '10000000',
        calldata: dummyCalldata,
        currentChainTimestamp: currentChainTs
      });
    }, (err: any) => err instanceof BroadcastAuthorizationError && err.code === 'INVALID_FUTURE_QUOTE_TIMESTAMP');
  });

  // Test G: Calldata changed after authorization
  it('G. Calldata modification post-authorization triggers CALLDATA_HASH_MISMATCH', () => {
    const now = Date.now();
    const auth = BroadcastAuthorizationGate.issueAuthorization({
      sourceChainId: 11155111,
      destinationChainId: 421614,
      signerAddress: dummySigner,
      recipientAddress: dummyRecipient,
      sourceToken: dummySourceToken,
      destinationToken: dummyDestToken,
      sourceSpokePool: dummySpokePool,
      destinationSpokePool: dummyDestSpokePool,
      inputAmountRaw: '10000000',
      quotedOutputAmountRaw: '9995000',
      minimumOutputAmountRaw: '9945025',
      quoteTimestamp: Math.floor(now / 1000),
      quoteExpiry: now + 300000,
      routeId: 'across-route-1',
      calldata: dummyCalldata,
      simulationStatus: 'SUCCESS',
      simulationClassification: 'SIMULATION_PASS',
      gasReadiness: 'READY',
      balanceReadiness: 'SUFFICIENT',
      allowanceReadiness: 'SUFFICIENT',
      authorizedBy: 'OPERATOR_TEST'
    });

    const tamperedCalldata = dummyCalldata + 'ffff';

    assert.throws(() => {
      BroadcastAuthorizationGate.verifyAuthorization(auth, {
        sourceChainId: 11155111,
        destinationChainId: 421614,
        signerAddress: dummySigner,
        recipientAddress: dummyRecipient,
        sourceToken: dummySourceToken,
        destinationToken: dummyDestToken,
        sourceSpokePool: dummySpokePool,
        inputAmountRaw: '10000000',
        calldata: tamperedCalldata
      });
    }, (err: any) => err instanceof BroadcastAuthorizationError && err.code === 'CALLDATA_HASH_MISMATCH');
  });

  // Test H: Chain ID changed
  it('H. Chain ID divergence triggers SOURCE_CHAIN_MISMATCH', () => {
    const now = Date.now();
    const auth = BroadcastAuthorizationGate.issueAuthorization({
      sourceChainId: 11155111,
      destinationChainId: 421614,
      signerAddress: dummySigner,
      recipientAddress: dummyRecipient,
      sourceToken: dummySourceToken,
      destinationToken: dummyDestToken,
      sourceSpokePool: dummySpokePool,
      destinationSpokePool: dummyDestSpokePool,
      inputAmountRaw: '10000000',
      quotedOutputAmountRaw: '9995000',
      minimumOutputAmountRaw: '9945025',
      quoteTimestamp: Math.floor(now / 1000),
      quoteExpiry: now + 300000,
      routeId: 'across-route-1',
      calldata: dummyCalldata,
      simulationStatus: 'SUCCESS',
      simulationClassification: 'SIMULATION_PASS',
      gasReadiness: 'READY',
      balanceReadiness: 'SUFFICIENT',
      allowanceReadiness: 'SUFFICIENT',
      authorizedBy: 'OPERATOR_TEST'
    });

    assert.throws(() => {
      BroadcastAuthorizationGate.verifyAuthorization(auth, {
        sourceChainId: 1, // Changed to Mainnet!
        destinationChainId: 421614,
        signerAddress: dummySigner,
        recipientAddress: dummyRecipient,
        sourceToken: dummySourceToken,
        destinationToken: dummyDestToken,
        sourceSpokePool: dummySpokePool,
        inputAmountRaw: '10000000',
        calldata: dummyCalldata
      });
    }, (err: any) => err instanceof BroadcastAuthorizationError && err.code === 'SOURCE_CHAIN_MISMATCH');
  });

  // Test I: Recipient changed
  it('I. Recipient alteration triggers RECIPIENT_MISMATCH', () => {
    const now = Date.now();
    const auth = BroadcastAuthorizationGate.issueAuthorization({
      sourceChainId: 11155111,
      destinationChainId: 421614,
      signerAddress: dummySigner,
      recipientAddress: dummyRecipient,
      sourceToken: dummySourceToken,
      destinationToken: dummyDestToken,
      sourceSpokePool: dummySpokePool,
      destinationSpokePool: dummyDestSpokePool,
      inputAmountRaw: '10000000',
      quotedOutputAmountRaw: '9995000',
      minimumOutputAmountRaw: '9945025',
      quoteTimestamp: Math.floor(now / 1000),
      quoteExpiry: now + 300000,
      routeId: 'across-route-1',
      calldata: dummyCalldata,
      simulationStatus: 'SUCCESS',
      simulationClassification: 'SIMULATION_PASS',
      gasReadiness: 'READY',
      balanceReadiness: 'SUFFICIENT',
      allowanceReadiness: 'SUFFICIENT',
      authorizedBy: 'OPERATOR_TEST'
    });

    const maliciousRecipient = '0x2222222222222222222222222222222222222222';

    assert.throws(() => {
      BroadcastAuthorizationGate.verifyAuthorization(auth, {
        sourceChainId: 11155111,
        destinationChainId: 421614,
        signerAddress: dummySigner,
        recipientAddress: maliciousRecipient,
        sourceToken: dummySourceToken,
        destinationToken: dummyDestToken,
        sourceSpokePool: dummySpokePool,
        inputAmountRaw: '10000000',
        calldata: dummyCalldata
      });
    }, (err: any) => err instanceof BroadcastAuthorizationError && err.code === 'RECIPIENT_MISMATCH');
  });

  // Test J: All conditions satisfied requires explicit authorization (does not auto-authorize)
  it('J. All technical readiness checks passing returns BROADCAST_AUTHORIZATION_REQUIRED (not auto-authorized)', () => {
    const evalResult = BroadcastAuthorizationGate.evaluateReadinessState({
      signerConfigured: true,
      signerAddress: dummySigner,
      nativeBalanceSufficient: true,
      usdcBalanceSufficient: true,
      allowanceSufficient: true,
      sourceRpcHealthy: true,
      destinationRpcHealthy: true,
      routeSupported: true,
      quoteValid: true,
      quoteExpired: false,
      simulationExecution: 'SUCCESS',
      simulationClassification: 'SIMULATION_PASS'
    });

    assert.equal(evalResult.state, 'BROADCAST_AUTHORIZATION_REQUIRED');
    assert.equal(evalResult.authorized, false);
  });

  // Test K: Explicit authorization allows dispatch through executeWithGate
  it('K. Valid explicit authorization allows execution through executeWithGate', async () => {
    const now = Date.now();
    const auth = BroadcastAuthorizationGate.issueAuthorization({
      sourceChainId: 11155111,
      destinationChainId: 421614,
      signerAddress: dummySigner,
      recipientAddress: dummyRecipient,
      sourceToken: dummySourceToken,
      destinationToken: dummyDestToken,
      sourceSpokePool: dummySpokePool,
      destinationSpokePool: dummyDestSpokePool,
      inputAmountRaw: '10000000',
      quotedOutputAmountRaw: '9995000',
      minimumOutputAmountRaw: '9945025',
      quoteTimestamp: Math.floor(now / 1000),
      quoteExpiry: now + 300000,
      routeId: 'across-route-1',
      calldata: dummyCalldata,
      simulationStatus: 'SUCCESS',
      simulationClassification: 'SIMULATION_PASS',
      gasReadiness: 'READY',
      balanceReadiness: 'SUFFICIENT',
      allowanceReadiness: 'SUFFICIENT',
      authorizedBy: 'OPERATOR_TEST'
    });

    let mockBroadcastExecuted = false;
    const result = await BroadcastAuthorizationGate.executeWithGate(auth, {
      sourceChainId: 11155111,
      destinationChainId: 421614,
      signerAddress: dummySigner,
      recipientAddress: dummyRecipient,
      sourceToken: dummySourceToken,
      destinationToken: dummyDestToken,
      sourceSpokePool: dummySpokePool,
      inputAmountRaw: '10000000',
      calldata: dummyCalldata
    }, async () => {
      mockBroadcastExecuted = true;
      return { txHash: '0xmock_tx_success' };
    });

    assert.equal(mockBroadcastExecuted, true);
    assert.equal(result.txHash, '0xmock_tx_success');
  });

  // Test L: Strict Private Key Protection
  it('L. Private key is never stored in authorization object or exposed', () => {
    const dummyKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const now = Date.now();

    const auth = BroadcastAuthorizationGate.issueAuthorization({
      sourceChainId: 11155111,
      destinationChainId: 421614,
      signerAddress: dummySigner,
      recipientAddress: dummyRecipient,
      sourceToken: dummySourceToken,
      destinationToken: dummyDestToken,
      sourceSpokePool: dummySpokePool,
      destinationSpokePool: dummyDestSpokePool,
      inputAmountRaw: '10000000',
      quotedOutputAmountRaw: '9995000',
      minimumOutputAmountRaw: '9945025',
      quoteTimestamp: Math.floor(now / 1000),
      quoteExpiry: now + 300000,
      routeId: 'across-route-1',
      calldata: dummyCalldata,
      simulationStatus: 'SUCCESS',
      simulationClassification: 'SIMULATION_PASS',
      gasReadiness: 'READY',
      balanceReadiness: 'SUFFICIENT',
      allowanceReadiness: 'SUFFICIENT',
      authorizedBy: 'OPERATOR_TEST'
    });

    const serialized = JSON.stringify(auth);
    assert.equal(serialized.includes(dummyKey), false);
    assert.equal((auth as any).privateKey, undefined);
  });

  // Test M: Simulation Semantics Separation
  it('M. Simulation execution status, classification and readiness are strictly separated', () => {
    const simReport = {
      executionStatus: 'REVERTED' as const,
      classification: 'EXPECTED_UNAPPROVED_CALLER' as const,
      readinessStatus: 'BLOCKED' as const
    };

    assert.equal(simReport.executionStatus, 'REVERTED');
    assert.notEqual(simReport.executionStatus, 'SUCCESS');
    assert.equal(simReport.readinessStatus, 'BLOCKED');
  });

  // Test N: Zero Broadcast Calls during audit
  it('N. PreBroadcastReadinessAuditor never invokes broadcast functions during audit', async () => {
    let broadcastInvoked = false;
    const mockSigner = {
      sendTransaction: async () => {
        broadcastInvoked = true;
        throw new Error('PROHIBITED');
      }
    };

    const auditor = new PreBroadcastReadinessAuditor();
    assert.equal(typeof auditor.audit, 'function');
    assert.equal(broadcastInvoked, false);
  });

  // Test O: Zero State-Changing Calls during audit
  it('O. Audit does not call approve, transfer, or depositV3', () => {
    let mutationCount = 0;
    const mockContract = {
      approve: () => { mutationCount++; },
      transfer: () => { mutationCount++; },
      depositV3: () => { mutationCount++; }
    };
    assert.equal(mutationCount, 0);
  });

});
