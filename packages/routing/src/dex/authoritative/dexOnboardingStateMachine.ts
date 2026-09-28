/**
 * @file dexOnboardingStateMachine.ts
 * @package @zenith/routing
 *
 * Deterministic Onboarding State Machine for Authoritative DEXes.
 * Enforces explicit sequential transitions:
 * DISCOVERED -> CONFIGURED -> IDENTITY_VERIFIED -> POOL_DISCOVERY_VERIFIED -> QUOTE_VERIFIED -> EXECUTION_ENABLED -> LIVE_VERIFIED
 * Administrative states: DISABLED, DEPRECATED.
 * Strictly prevents silent promotion.
 */

import type { DexOnboardingState } from '@zenith/types';
import { DexOnboardingTransitionError } from '@zenith/contracts';

export const VALID_ONBOARDING_TRANSITIONS: Record<DexOnboardingState, readonly DexOnboardingState[]> = {
  DISCOVERED: ['CONFIGURED', 'DISABLED', 'DEPRECATED'],
  CONFIGURED: ['IDENTITY_VERIFIED', 'DISABLED', 'DEPRECATED'],
  IDENTITY_VERIFIED: ['POOL_DISCOVERY_VERIFIED', 'DISABLED', 'DEPRECATED'],
  POOL_DISCOVERY_VERIFIED: ['QUOTE_VERIFIED', 'DISABLED', 'DEPRECATED'],
  QUOTE_VERIFIED: ['EXECUTION_ENABLED', 'DISABLED', 'DEPRECATED'],
  EXECUTION_ENABLED: ['LIVE_VERIFIED', 'DISABLED', 'DEPRECATED'],
  LIVE_VERIFIED: ['DEPRECATED', 'DISABLED'],
  DISABLED: ['CONFIGURED', 'DEPRECATED'],
  DEPRECATED: ['DISABLED']
};

/**
 * Checks whether transitioning from `fromState` to `toState` is allowed.
 */
export function isValidDexOnboardingTransition(
  fromState: DexOnboardingState,
  toState: DexOnboardingState
): boolean {
  if (fromState === toState) {
    return true; // No-op transition
  }
  const allowed = VALID_ONBOARDING_TRANSITIONS[fromState];
  if (!allowed) {
    return false;
  }
  return allowed.includes(toState);
}

/**
 * Validates onboarding transition, throwing DexOnboardingTransitionError if illegal.
 */
export function validateDexOnboardingTransition(
  dexId: string,
  fromState: DexOnboardingState,
  toState: DexOnboardingState
): void {
  if (!isValidDexOnboardingTransition(fromState, toState)) {
    throw new DexOnboardingTransitionError(
      dexId,
      fromState,
      toState,
      `State transition from "${fromState}" to "${toState}" violates the authoritative onboarding state machine. Valid next states from "${fromState}": [${VALID_ONBOARDING_TRANSITIONS[fromState]?.join(', ') || 'NONE'}]`
    );
  }
}

export class DexOnboardingStateMachine {
  public static canTransition(from: DexOnboardingState, to: DexOnboardingState): boolean {
    return isValidDexOnboardingTransition(from, to);
  }

  public static transition(
    from: DexOnboardingState,
    to: DexOnboardingState,
    _reason?: string
  ): DexOnboardingState {
    this.assertValidTransition(from, to);
    return to;
  }

  public static assertValidTransition(from: DexOnboardingState, to: DexOnboardingState): void {
    validateDexOnboardingTransition('DEX', from, to);
  }

  public static getValidTransitions(from: DexOnboardingState): readonly DexOnboardingState[] {
    return VALID_ONBOARDING_TRANSITIONS[from] || [];
  }
}

