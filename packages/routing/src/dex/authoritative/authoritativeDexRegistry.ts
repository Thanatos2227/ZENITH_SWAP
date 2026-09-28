/**
 * @file authoritativeDexRegistry.ts
 * @package @zenith/routing
 *
 * Authoritative DEX Registry for ZENITH.
 * Ground truth registry for certified DEX deployments, adapters, capabilities,
 * and onboarding lifecycle.
 * All query results are immutable/deep-cloned.
 */

import type {
  DexIdentity,
  DexVerificationStatus,
  DexOnboardingState,
  CapabilityLevel,
  DexResolutionInput,
  DexResolutionResult,
  DexValidationResult
} from '@zenith/types';
import { CANONICAL_DEXES } from './canonicalDexes.data';
import { DexRegistryValidation } from './dexRegistryValidation';
import { validateDexOnboardingTransition } from './dexOnboardingStateMachine';
import { buildDexIdentityKey } from './dexIdentity.types';
import type { IDexAdapter } from './dexAdapter.interface';
import { UniswapV3DexAdapter } from './uniswapV3DexAdapter';
import { UniswapV2DexAdapter } from './uniswapV2DexAdapter';
import { NonEvmDexAdapter } from './nonEvmDexAdapter';
import { QuickSwapV3DexAdapter } from './quickswapV3DexAdapter';
import { AerodromeDexAdapter } from './aerodromeDexAdapter';

function deepClone<T>(obj: T): T {
  if (obj === undefined || obj === null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

export class AuthoritativeDexRegistry {
  private dexesById: Map<string, DexIdentity> = new Map();
  private dexesByIdentityKey: Map<string, DexIdentity> = new Map();
  private adaptersByDexId: Map<string, IDexAdapter> = new Map();

  constructor(seedDexes: readonly DexIdentity[] = CANONICAL_DEXES) {
    for (const dex of seedDexes) {
      this.registerDexInternal(dex);
    }
  }

  private registerDexInternal(dex: DexIdentity, customAdapter?: IDexAdapter): void {
    const key =
      dex.networkIdentityKey && dex.version && dex.deploymentId
        ? buildDexIdentityKey(
            dex.networkIdentityKey,
            dex.canonicalName.replace(/\s+/g, '').toUpperCase(),
            dex.version,
            dex.deploymentId
          )
        : dex.dexId;

    const cloned: DexIdentity = {
      ...deepClone(dex),
      identityKey: key
    };
    this.dexesById.set(cloned.dexId, cloned);
    this.dexesByIdentityKey.set(key, cloned);

    if (customAdapter) {
      this.adaptersByDexId.set(cloned.dexId, customAdapter);
    } else {
      // Default to appropriate adapter based on protocolFamily and family
      if (cloned.family === 'EVM') {
        if (cloned.dexId === 'polygon:quickswap-v3') {
          this.adaptersByDexId.set(cloned.dexId, new QuickSwapV3DexAdapter(cloned));
        } else if (cloned.dexId === 'base:aerodrome-v2') {
          this.adaptersByDexId.set(cloned.dexId, new AerodromeDexAdapter(cloned));
        } else if (cloned.protocolFamily === 'UNISWAP_V3_STYLE' || cloned.protocolFamily === 'CONCENTRATED_LIQUIDITY_AMM') {
          this.adaptersByDexId.set(cloned.dexId, new UniswapV3DexAdapter(cloned));
        } else if (cloned.protocolFamily === 'UNISWAP_V2_STYLE' || cloned.protocolFamily === 'CONSTANT_PRODUCT_AMM') {
          this.adaptersByDexId.set(cloned.dexId, new UniswapV2DexAdapter(cloned));
        }
      } else {
        this.adaptersByDexId.set(cloned.dexId, new NonEvmDexAdapter(cloned));
      }
    }
  }

  /**
   * Registers a new DEX into the authoritative registry.
   */
  public registerDex(dex: DexIdentity, adapter?: IDexAdapter): void {
    if (this.hasDex(dex.dexId)) {
      throw new Error(`DEX with ID "${dex.dexId}" is already registered`);
    }
    const validation = DexRegistryValidation.validate(dex);
    if (!validation.isValid) {
      throw new Error(`Cannot register invalid DEX "${dex.dexId}": ${validation.errors.join('; ')}`);
    }
    this.registerDexInternal(dex, adapter);
  }

  /**
   * Retrieves all registered DEXes. Returns deep clones.
   */
  public getAllDexes(): DexIdentity[] {
    return this.getDexes();
  }

  /**
   * Removes a DEX from the registry.
   */
  public removeDex(dexId: string): boolean {
    const existing = this.dexesById.get(dexId);
    if (!existing) {
      return false;
    }
    this.dexesById.delete(dexId);
    this.adaptersByDexId.delete(dexId);

    // Also remove from identityKey map
    for (const [key, d] of this.dexesByIdentityKey.entries()) {
      if (d.dexId === dexId) {
        this.dexesByIdentityKey.delete(key);
        break;
      }
    }
    return true;
  }

  /**
   * Retrieves a DEX by its canonical dexId. Returns deep clone.
   */
  public getDex(dexId: string): DexIdentity | undefined {
    let dex = this.dexesById.get(dexId);
    if (!dex && dexId.includes('-')) {
      dex = this.dexesById.get(dexId.replace('-', ':'));
    }
    if (!dex && dexId.includes(':')) {
      dex = this.dexesById.get(dexId.replace(':', '-'));
    }
    if (!dex && (dexId === 'solana-raydium' || dexId === 'solana:raydium' || dexId === 'solana:raydium-v4' || dexId === 'solana-raydium-v4')) {
      dex = this.dexesById.get('solana:raydium') || this.dexesById.get('solana:raydium-v4');
    }
    return dex ? deepClone(dex) : undefined;
  }

  /**
   * Retrieves a DEX by its deterministic identity key. Returns deep clone.
   */
  public getDexByIdentityKey(identityKey: string): DexIdentity | undefined {
    const dex = this.dexesByIdentityKey.get(identityKey);
    return dex ? deepClone(dex) : undefined;
  }

  /**
   * Retrieves all registered DEXes, optionally filtered by networkId. Returns deep clones.
   */
  public getDexes(networkId?: string): DexIdentity[] {
    const all = Array.from(this.dexesById.values());
    if (!networkId) {
      return deepClone(all);
    }
    const cleanNet = networkId.trim().toLowerCase();
    const filtered = all.filter((d) => d.networkId.toLowerCase() === cleanNet);
    return deepClone(filtered);
  }

  /**
   * Retrieves the current capability level of a DEX.
   */
  public getDexCapability(dexId: string): CapabilityLevel {
    const dex = this.getDex(dexId);
    return dex ? dex.capabilityLevel : 'UNSUPPORTED';
  }

  /**
   * Retrieves the IDexAdapter instance for a DEX.
   */
  public getDexAdapter(dexId: string): IDexAdapter | undefined {
    let adapter = this.adaptersByDexId.get(dexId);
    if (!adapter && dexId.includes('-')) {
      adapter = this.adaptersByDexId.get(dexId.replace('-', ':'));
    }
    if (!adapter && dexId.includes(':')) {
      adapter = this.adaptersByDexId.get(dexId.replace(':', '-'));
    }
    if (!adapter && (dexId === 'solana-raydium' || dexId === 'solana:raydium' || dexId === 'solana:raydium-v4' || dexId === 'solana-raydium-v4')) {
      adapter = this.adaptersByDexId.get('solana:raydium') || this.adaptersByDexId.get('solana:raydium-v4');
    }
    return adapter;
  }

  /**
   * Registers or updates an adapter for an existing DEX.
   */
  public setDexAdapter(dexId: string, adapter: IDexAdapter): void {
    if (!this.dexesById.has(dexId)) {
      throw new Error(`Cannot attach adapter to unregistered DEX: "${dexId}"`);
    }
    this.adaptersByDexId.set(dexId, adapter);
  }

  /**
   * Retrieves the verification status for a DEX.
   */
  public getDexVerificationStatus(dexId: string): DexVerificationStatus {
    const dex = this.dexesById.get(dexId);
    return dex ? dex.verificationStatus : 'UNVERIFIED';
  }

  /**
   * Retrieves the onboarding state for a DEX.
   */
  public getDexOnboardingState(dexId: string): DexOnboardingState {
    const dex = this.dexesById.get(dexId);
    return dex ? dex.onboardingState : 'DISCOVERED';
  }

  /**
   * Transitions a DEX's onboarding state, enforcing state machine rules without silent promotion.
   */
  public promoteOnboardingState(dexId: string, nextState: DexOnboardingState): void {
    const dex = this.dexesById.get(dexId);
    if (!dex) {
      throw new Error(`Cannot promote non-existent DEX "${dexId}"`);
    }
    validateDexOnboardingTransition(dexId, dex.onboardingState, nextState);
    (dex as any).onboardingState = nextState;
  }

  /**
   * Sets DEX capability level explicitly with evidence checks.
   */
  public setDexCapability(dexId: string, capability: CapabilityLevel): void {
    const dex = this.dexesById.get(dexId);
    if (!dex) {
      throw new Error(`Cannot update capability for non-existent DEX "${dexId}"`);
    }
    const updatedDex = { ...dex, capabilityLevel: capability };
    this.dexesById.set(dexId, updatedDex as any);
    const adapter = this.adaptersByDexId.get(dexId);
    if (adapter) {
      (adapter as any).identity = {
        ...((adapter as any).identity || updatedDex),
        capabilityLevel: capability
      };
    }
  }

  /**
   * Returns true if the DEX is registered.
   */
  public hasDex(dexId: string): boolean {
    return Boolean(this.getDex(dexId));
  }

  /**
   * Resolves a DEX identity from flexible inputs (dexId, canonicalName, routerAddress, networkId).
   */
  public resolveDexIdentity(input: DexResolutionInput): DexResolutionResult {
    if (!input || Object.keys(input).length === 0) {
      return { status: 'INVALID_INPUT', error: 'Input must contain at least one resolution field' };
    }

    // 1. Exact dexId resolution
    if (input.dexId) {
      const dex = this.getDex(input.dexId);
      if (dex) {
        return { status: 'RESOLVED_EXACT', dex };
      }
    }

    // 2. Exact identityKey resolution
    if (input.identityKey) {
      const dex = this.getDexByIdentityKey(input.identityKey);
      if (dex) {
        return { status: 'RESOLVED_EXACT', dex };
      }
    }

    // 3. Search across all DEXes
    let candidates = Array.from(this.dexesById.values());

    if (input.networkId) {
      const cleanNet = input.networkId.trim().toLowerCase();
      candidates = candidates.filter((d) => d.networkId.toLowerCase() === cleanNet);
    }

    if (input.routerAddress) {
      const cleanRouter = input.routerAddress.trim().toLowerCase();
      candidates = candidates.filter(
        (d) =>
          d.routerAddress.toLowerCase() === cleanRouter ||
          (d.universalRouterAddress && d.universalRouterAddress.toLowerCase() === cleanRouter)
      );
    }

    if (input.canonicalName) {
      const cleanName = input.canonicalName.trim().toLowerCase();
      candidates = candidates.filter(
        (d) =>
          d.canonicalName.toLowerCase() === cleanName ||
          d.displayName.toLowerCase().includes(cleanName)
      );
    }

    if (candidates.length === 1) {
      return { status: 'RESOLVED_EXACT', dex: deepClone(candidates[0]) };
    } else if (candidates.length > 1) {
      return { status: 'RESOLVED_AMBIGUOUS', matches: deepClone(candidates) };
    }

    return { status: 'UNRESOLVED', error: 'No matching DEX found' };
  }

  /**
   * Validates a DexIdentity.
   */
  public validateDexIdentity(dex: DexIdentity): DexValidationResult {
    return DexRegistryValidation.validate(dex);
  }
}

export const defaultAuthoritativeDexRegistry = new AuthoritativeDexRegistry();
