import { ExecutionPlan, AuthorizationContext, SecurityBoundaryCheckResult } from '@zenith/types';
import { ZERO_ADDRESS, validateEvmAddress, validateTokenAddress, AuthorizationBoundaryBreachError, UnauthorizedExecutionError, ExecutionTargetNotAllowlistedError, ApprovalPolicyViolationError, CalldataAuthorizationError, AmountMismatchError, PlanIntegrityBreachError, SecurityPolicyViolationError, InvalidQuoteAmountError, getAcrossSpokePool, getStargateRouter, getDeBridgeSourceContract } from '@zenith/contracts';
import { defaultChainRegistry } from '@zenith/chains';
import { assertPlanIntegrity, computeExecutionPlanHash } from '../executionPlanBuilder';
import { CrossChainProviderCapabilityMatrix } from '@zenith/routing';
export const EXACT_INTEGER_REGEX = /^(0|[1-9][0-9]*)$/;
export const UINT256_MAX = (1n << 256n) - 1n;
export function toNumericChainId(chainId: string | number): number {
    if (typeof chainId === 'number')
        return chainId;
    const chain = defaultChainRegistry.getChain(chainId);
    return chain?.chainId || Number(chainId) || 1;
}
export function validateAmountFormat(amountStr: string, context = 'Amount'): bigint {
    if (typeof amountStr !== 'string' || amountStr.trim() === '') {
        throw new InvalidQuoteAmountError(String(amountStr), `${context} must be a non-empty string`);
    }
    if (amountStr.includes('.') || amountStr.includes('e') || amountStr.includes('E') || amountStr.includes('-') || amountStr.includes('+')) {
        throw new InvalidQuoteAmountError(amountStr, `${context} cannot contain decimal points, signs, or scientific notation`);
    }
    if (!EXACT_INTEGER_REGEX.test(amountStr)) {
        throw new InvalidQuoteAmountError(amountStr, `${context} must be a valid non-negative integer string without leading zeros`);
    }
    let value: bigint;
    try {
        value = BigInt(amountStr);
    }
    catch {
        throw new InvalidQuoteAmountError(amountStr, `${context} failed bigint conversion`);
    }
    if (value < 0n) {
        throw new InvalidQuoteAmountError(amountStr, `${context} cannot be negative`);
    }
    if (value > UINT256_MAX) {
        throw new InvalidQuoteAmountError(amountStr, `${context} exceeds uint256 maximum`);
    }
    return value;
}
export function validateExecutionPlanAuthorization(plan: ExecutionPlan, context?: Partial<AuthorizationContext>): SecurityBoundaryCheckResult {
    const timestamp = Date.now();
    if (!plan || typeof plan !== 'object') {
        throw new UnauthorizedExecutionError('ExecutionPlan is missing or not an object');
    }
    const seal = plan.integrityHash || plan.planHash;
    if (!seal || typeof seal !== 'string' || seal.trim() === '') {
        throw new UnauthorizedExecutionError(`ExecutionPlan "${plan.planId}" is unsealed and lacks cryptographic authorization seal`, plan.planId);
    }
    const calculatedHash = computeExecutionPlanHash(plan);
    if (calculatedHash !== seal) {
        throw new PlanIntegrityBreachError(`Plan hash mismatch: calculated "${calculatedHash}" !== sealed "${seal}"`, ['integrityHash']);
    }
    assertPlanIntegrity(plan);
    if (!plan.isExecutable) {
        throw new UnauthorizedExecutionError(`ExecutionPlan "${plan.planId}" is marked unexecutable: ${plan.unexecutableReason || 'UNEXECUTABLE'}`, plan.planId);
    }
    if (plan.expiration && plan.expiration > 0 && plan.expiration < timestamp) {
        throw new UnauthorizedExecutionError(`ExecutionPlan "${plan.planId}" has expired (Expiration: ${plan.expiration}, Current: ${timestamp})`, plan.planId);
    }
    if (plan.tokenIn?.address) {
        validateTokenAddress(plan.tokenIn.address, plan.sourceChainId, plan.tokenIn.isNative);
    }
    if (plan.tokenOut?.address) {
        validateTokenAddress(plan.tokenOut.address, plan.destinationChainId, plan.tokenOut.isNative);
    }
    validateAmountFormat(plan.expectedAmountInRaw, 'expectedAmountInRaw');
    validateAmountFormat(plan.expectedAmountOutRaw, 'expectedAmountOutRaw');
    validateAmountFormat(plan.minimumAmountOutRaw, 'minimumAmountOutRaw');
    if (BigInt(plan.minimumAmountOutRaw) > BigInt(plan.expectedAmountOutRaw)) {
        throw new AmountMismatchError(plan.expectedAmountOutRaw, plan.minimumAmountOutRaw, 'minimumAmountOutRaw cannot exceed expectedAmountOutRaw');
    }
    if (plan.selectedProvider) {
        const minCap = CrossChainProviderCapabilityMatrix.getCapabilityRank('QUOTE_AVAILABLE');
        if (minCap < 1) {
            throw new UnauthorizedExecutionError(`Provider "${plan.selectedProvider}" does not meet minimum capability rank`, plan.planId);
        }
    }
    if (context) {
        if (context.routeId && context.routeId !== plan.routeId) {
            throw new AuthorizationBoundaryBreachError('EXECUTION_PLAN', `routeId mutation: context has "${context.routeId}" but plan has "${plan.routeId}"`);
        }
        if (context.sourceChainId && context.sourceChainId !== plan.sourceChainId) {
            throw new AuthorizationBoundaryBreachError('EXECUTION_PLAN', `sourceChainId mutation: context has "${context.sourceChainId}" but plan has "${plan.sourceChainId}"`);
        }
        if (context.destinationChainId && context.destinationChainId !== plan.destinationChainId) {
            throw new AuthorizationBoundaryBreachError('EXECUTION_PLAN', `destinationChainId mutation: context has "${context.destinationChainId}" but plan has "${plan.destinationChainId}"`);
        }
        if (context.tokenInAddress && plan.tokenIn && context.tokenInAddress.toLowerCase() !== plan.tokenIn.address.toLowerCase()) {
            throw new AuthorizationBoundaryBreachError('EXECUTION_PLAN', `tokenIn mutation: context has "${context.tokenInAddress}" but plan has "${plan.tokenIn.address}"`);
        }
        if (context.tokenOutAddress && plan.tokenOut && context.tokenOutAddress.toLowerCase() !== plan.tokenOut.address.toLowerCase()) {
            throw new AuthorizationBoundaryBreachError('EXECUTION_PLAN', `tokenOut mutation: context has "${context.tokenOutAddress}" but plan has "${plan.tokenOut.address}"`);
        }
        if (context.expectedAmountInRaw && context.expectedAmountInRaw !== plan.expectedAmountInRaw) {
            throw new AuthorizationBoundaryBreachError('EXECUTION_PLAN', `amountIn mutation: context has "${context.expectedAmountInRaw}" but plan has "${plan.expectedAmountInRaw}"`);
        }
        if (context.minimumAmountOutRaw && context.minimumAmountOutRaw !== plan.minimumAmountOutRaw) {
            throw new AuthorizationBoundaryBreachError('EXECUTION_PLAN', `minimumAmountOut mutation: context has "${context.minimumAmountOutRaw}" but plan has "${plan.minimumAmountOutRaw}"`);
        }
        const planRecipient = ((plan as any).recipient || (plan as any).userWalletAddress || '').toLowerCase();
        if (context.recipientAddress && planRecipient && context.recipientAddress.toLowerCase() !== planRecipient) {
            throw new AuthorizationBoundaryBreachError('EXECUTION_PLAN', `recipient mutation: context has "${context.recipientAddress}" but plan has "${planRecipient}"`);
        }
        if (context.provider && plan.selectedProvider && context.provider.toUpperCase() !== plan.selectedProvider.toUpperCase()) {
            throw new AuthorizationBoundaryBreachError('EXECUTION_PLAN', `provider mutation: context has "${context.provider}" but plan has "${plan.selectedProvider}"`);
        }
        if (context.executionMode === 'READ_ONLY' || context.executionMode === 'PREFLIGHT_ONLY') {
            throw new AuthorizationBoundaryBreachError('EXECUTION_PLAN', `executionMode "${context.executionMode}" is non-executable and prohibited from signing/broadcast`);
        }
    }
    return {
        passed: true,
        boundary: 'EXECUTION_PLAN',
        state: 'AUTHORIZED',
        planId: plan.planId,
        timestamp
    };
}
export function validateCalldataAuthorization(target: string, calldata: string, expectedPlan?: ExecutionPlan, chainId?: string | number): void {
    if (!calldata || typeof calldata !== 'string' || !calldata.startsWith('0x') || calldata.length < 10) {
        throw new CalldataAuthorizationError('Calldata must be a non-empty 0x-prefixed hex string of at least 4 bytes (selector)', calldata?.slice(0, 10));
    }
    const selector = calldata.slice(0, 10).toLowerCase();
    const BLOCKED_SELECTORS = new Set([
        '0x00000000',
        '0xffffffff',
        '0x41c0e1b5',
        '0x35f46eb4'
    ]);
    if (BLOCKED_SELECTORS.has(selector)) {
        throw new CalldataAuthorizationError(`Prohibited or dangerous function selector detected: "${selector}" on chain ${chainId ?? 'unknown'}`, selector);
    }
    if (expectedPlan) {
        if (expectedPlan.executionTarget && target.toLowerCase() !== expectedPlan.executionTarget.toLowerCase()) {
            throw new CalldataAuthorizationError(`Execution target "${target}" does not match plan executionTarget "${expectedPlan.executionTarget}"`, selector);
        }
        if (expectedPlan.calldata && expectedPlan.calldata.toLowerCase() !== calldata.toLowerCase()) {
            throw new CalldataAuthorizationError('Calldata mismatch between authorized plan and dispatched transaction', selector);
        }
    }
}
export function validateTargetAllowlist(target: string, chainId: string | number, provider?: string): void {
    if (!target || target === ZERO_ADDRESS || target.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
        throw new ExecutionTargetNotAllowlistedError(target || 'EMPTY', chainId, 'Target address cannot be zero or empty');
    }
    validateEvmAddress(target, 'Target Allowlist Check');
    const knownEoaBlocklist = new Set([
        '0x8ba1f109551bd432803012645ac136ddd64dba72',
        '0xd2206db611d5677c8552a9dcbadf3077adb4af88',
        '0x1111111111111111111111111111111111111111'
    ]);
    if (knownEoaBlocklist.has(target.toLowerCase()) && !provider?.includes('SOLVER')) {
        throw new ExecutionTargetNotAllowlistedError(target, chainId, 'Target is a known EOA wallet address, not an authorized smart contract router/bridge');
    }
    const numericChainId = toNumericChainId(chainId);
    if (provider === 'ACROSS') {
        const expected = getAcrossSpokePool(numericChainId);
        if (expected && target.toLowerCase() !== expected.toLowerCase()) {
            throw new ExecutionTargetNotAllowlistedError(target, chainId, `Expected canonical Across SpokePool ${expected}`);
        }
    }
    else if (provider === 'STARGATE') {
        const expected = getStargateRouter(numericChainId);
        if (expected && target.toLowerCase() !== expected.toLowerCase()) {
            throw new ExecutionTargetNotAllowlistedError(target, chainId, `Expected canonical Stargate Router ${expected}`);
        }
    }
    else if (provider === 'DEBRIDGE_DLN' || provider === 'DEBRIDGE') {
        const expected = getDeBridgeSourceContract(numericChainId);
        if (expected && target.toLowerCase() !== expected.toLowerCase()) {
            throw new ExecutionTargetNotAllowlistedError(target, chainId, `Expected canonical deBridge DLN contract ${expected}`);
        }
    }
}
export function validateApprovalPolicy(params: {
    approvalTarget: string;
    tokenAddress: string;
    amount: string;
    plan?: ExecutionPlan;
    chainId?: string | number;
}): void {
    const { approvalTarget, tokenAddress, amount, plan, chainId } = params;
    if (!approvalTarget || approvalTarget === ZERO_ADDRESS || approvalTarget.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
        throw new ApprovalPolicyViolationError(approvalTarget || 'EMPTY', amount, 'Approval target address cannot be zero or empty');
    }
    validateEvmAddress(approvalTarget, 'Approval Target Address');
    validateEvmAddress(tokenAddress, 'Token Contract Address');
    if (chainId) {
        validateTokenAddress(tokenAddress, String(chainId), false);
    }
    const numAmount = validateAmountFormat(amount, 'Approval Amount');
    if (numAmount === UINT256_MAX) {
        throw new ApprovalPolicyViolationError(approvalTarget, amount, 'Unlimited approval (type(uint256).max) is strictly prohibited by security policy. Must be exact bounded allowance.');
    }
    if (numAmount === 0n) {
        throw new ApprovalPolicyViolationError(approvalTarget, amount, 'Approval amount cannot be zero');
    }
    if (plan) {
        if (plan.approvalTarget && approvalTarget.toLowerCase() !== plan.approvalTarget.toLowerCase()) {
            throw new ApprovalPolicyViolationError(approvalTarget, amount, `Approval target "${approvalTarget}" does not match plan authorized approvalTarget "${plan.approvalTarget}"`);
        }
        if (plan.tokenIn && tokenAddress.toLowerCase() !== plan.tokenIn.address.toLowerCase()) {
            throw new ApprovalPolicyViolationError(approvalTarget, amount, `Approval token "${tokenAddress}" does not match plan source tokenIn "${plan.tokenIn.address}"`);
        }
        if (chainId && plan.sourceChainId && String(chainId) !== String(plan.sourceChainId)) {
            throw new ApprovalPolicyViolationError(approvalTarget, amount, `Approval chain "${chainId}" does not match plan sourceChainId "${plan.sourceChainId}"`);
        }
        const maxAllowed = BigInt(plan.expectedAmountInRaw);
        if (numAmount > maxAllowed * 2n) {
            throw new ApprovalPolicyViolationError(approvalTarget, amount, `Approval amount exceeds plan budget safety ceiling (${numAmount} > ${maxAllowed * 2n})`);
        }
    }
}
export function validatePreflightBroadcastContinuity(preflightTx: {
    to: string;
    data: string;
    value: bigint | string;
    chainId?: string | number;
    from?: string;
}, broadcastTx: {
    to: string;
    data: string;
    value: bigint | string;
    chainId?: string | number;
    from?: string;
}): void {
    if (preflightTx.to.toLowerCase() !== broadcastTx.to.toLowerCase()) {
        throw new AuthorizationBoundaryBreachError('PRE_FLIGHT_BROADCAST', `Target address mutated between preflight (${preflightTx.to}) and broadcast (${broadcastTx.to})`);
    }
    if (preflightTx.data.toLowerCase() !== broadcastTx.data.toLowerCase()) {
        throw new AuthorizationBoundaryBreachError('PRE_FLIGHT_BROADCAST', 'Calldata mutated between preflight simulation and broadcast');
    }
    if (BigInt(preflightTx.value) !== BigInt(broadcastTx.value)) {
        throw new AuthorizationBoundaryBreachError('PRE_FLIGHT_BROADCAST', `Transaction value mutated between preflight (${preflightTx.value}) and broadcast (${broadcastTx.value})`);
    }
    if (preflightTx.chainId && broadcastTx.chainId && String(preflightTx.chainId) !== String(broadcastTx.chainId)) {
        throw new AuthorizationBoundaryBreachError('PRE_FLIGHT_BROADCAST', `ChainId mutated between preflight (${preflightTx.chainId}) and broadcast (${broadcastTx.chainId})`);
    }
    if (preflightTx.from && broadcastTx.from && preflightTx.from.toLowerCase() !== broadcastTx.from.toLowerCase()) {
        throw new AuthorizationBoundaryBreachError('PRE_FLIGHT_BROADCAST', `Sender address mutated between preflight (${preflightTx.from}) and broadcast (${broadcastTx.from})`);
    }
}
export function validateSigningPayload(plan: ExecutionPlan, tx: {
    to: string;
    data: string;
    value: bigint | string;
}): void {
    if (plan.executionTarget && tx.to.toLowerCase() !== plan.executionTarget.toLowerCase()) {
        throw new AuthorizationBoundaryBreachError('SIGNING_AUTHORIZATION', `Signing payload destination "${tx.to}" does not match plan executionTarget "${plan.executionTarget}"`);
    }
    if (plan.calldata && tx.data.toLowerCase() !== plan.calldata.toLowerCase()) {
        throw new AuthorizationBoundaryBreachError('SIGNING_AUTHORIZATION', 'Signing payload calldata does not match authorized plan calldata');
    }
}
export function assertSanitizedSecurityTelemetry(telemetry: Record<string, any>): void {
    const serialized = JSON.stringify(telemetry);
    const PRIVATE_KEY_PATTERN = /0x[0-9a-fA-F]{64}/g;
    const matches = serialized.match(PRIVATE_KEY_PATTERN);
    if (matches) {
        for (const match of matches) {
            if (!serialized.includes(`"txHash":"${match}"`) &&
                !serialized.includes(`"planHash":"${match.slice(2)}"`) &&
                !serialized.includes(`"integrityHash":"${match.slice(2)}"`)) {
                throw new SecurityPolicyViolationError('Security telemetry leak detected: potential raw 64-character private key found in telemetry payload', [match]);
            }
        }
    }
    const FORBIDDEN_WORDS = ['privatekey', 'mnemonic', 'seedphrase', 'secret_key', 'api_key_secret', 'bearer '];
    const lower = serialized.toLowerCase();
    for (const word of FORBIDDEN_WORDS) {
        if (lower.includes(word)) {
            throw new SecurityPolicyViolationError(`Security telemetry leak detected: sensitive identifier "${word}" found in telemetry payload`, [word]);
        }
    }
}
