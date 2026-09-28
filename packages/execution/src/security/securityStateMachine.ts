import { SecurityAuthorizationState } from '@zenith/types';
import { InvalidSecurityStateTransitionError } from '@zenith/contracts';

export const VALID_SECURITY_STATE_TRANSITIONS: Record<SecurityAuthorizationState, SecurityAuthorizationState[]> = {
  UNAUTHORIZED: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['AUTHORIZED', 'REJECTED'],
  AUTHORIZED: ['PREFLIGHT_VERIFIED', 'REJECTED'],
  PREFLIGHT_VERIFIED: ['SIGNING_AUTHORIZED', 'REJECTED'],
  SIGNING_AUTHORIZED: ['BROADCAST_AUTHORIZED', 'REJECTED'],
  BROADCAST_AUTHORIZED: ['BROADCASTED', 'REJECTED'],
  BROADCASTED: ['CONFIRMED', 'REJECTED'],
  CONFIRMED: ['SETTLED', 'REJECTED'],
  SETTLED: [],
  REJECTED: []
};

export const TERMINAL_SECURITY_STATES: Set<SecurityAuthorizationState> = new Set(['SETTLED', 'REJECTED']);

export function validateSecurityStateTransition(fromState: SecurityAuthorizationState, toState: SecurityAuthorizationState): void {
  if (fromState === toState) return;
  if (TERMINAL_SECURITY_STATES.has(fromState)) {
    throw new InvalidSecurityStateTransitionError(fromState, toState, 'SecurityStateMachine');
  }
  const allowed = VALID_SECURITY_STATE_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    throw new InvalidSecurityStateTransitionError(fromState, toState, 'SecurityStateMachine');
  }
}

export type SecurityStateChangeListener = (state: SecurityAuthorizationState, reason?: string) => void;

export class SecurityStateMachine {
  private currentState: SecurityAuthorizationState = 'UNAUTHORIZED';
  private visitedStates: Set<SecurityAuthorizationState> = new Set(['UNAUTHORIZED']);
  private listeners: Set<SecurityStateChangeListener> = new Set();
  private rejectionReason?: string;

  constructor(initialState: SecurityAuthorizationState = 'UNAUTHORIZED') {
    this.currentState = initialState;
    this.visitedStates.add(initialState);
  }

  public getState(): SecurityAuthorizationState {
    return this.currentState;
  }

  public isTerminal(): boolean {
    return TERMINAL_SECURITY_STATES.has(this.currentState);
  }

  public getRejectionReason(): string | undefined {
    return this.rejectionReason;
  }

  public hasVisited(state: SecurityAuthorizationState): boolean {
    return this.visitedStates.has(state);
  }

  public transitionTo(nextState: SecurityAuthorizationState, reason?: string): void {
    if (this.currentState === nextState) return;

    validateSecurityStateTransition(this.currentState, nextState);

    if (nextState === 'SIGNING_AUTHORIZED') {
      if (!this.visitedStates.has('VALIDATED') || !this.visitedStates.has('AUTHORIZED') || !this.visitedStates.has('PREFLIGHT_VERIFIED')) {
        throw new InvalidSecurityStateTransitionError(
          this.currentState,
          nextState,
          'Security boundary skipping violation: Cannot authorize signing without passing VALIDATED, AUTHORIZED, and PREFLIGHT_VERIFIED'
        );
      }
    }

    if (nextState === 'BROADCAST_AUTHORIZED') {
      if (!this.visitedStates.has('SIGNING_AUTHORIZED')) {
        throw new InvalidSecurityStateTransitionError(
          this.currentState,
          nextState,
          'Security boundary skipping violation: Cannot authorize broadcast without passing SIGNING_AUTHORIZED'
        );
      }
    }

    this.currentState = nextState;
    this.visitedStates.add(nextState);
    if (nextState === 'REJECTED') {
      this.rejectionReason = reason;
    }
    this.notify(reason);
  }

  public reject(reason: string): void {
    this.transitionTo('REJECTED', reason);
  }

  public subscribe(listener: SecurityStateChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.currentState, this.rejectionReason);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(reason?: string): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.currentState, reason);
      } catch (err) {
        console.error('[SecurityStateMachine] Listener error:', err);
      }
    });
  }
}
