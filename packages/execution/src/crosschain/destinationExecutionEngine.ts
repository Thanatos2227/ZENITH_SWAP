import {
  DestinationExecutionRequest,
  DestinationExecutionPlan,
  DestinationExecutionResult,
  DestinationVerification,
  DestinationExecutionCapabilities
} from '@zenith/types';
import {
  CompositeExecutionUnavailableError,
  DestinationExecutionUnavailableError
} from '@zenith/contracts';
import { DestinationExecutionProvider } from './destinationExecutionProvider';
import { defaultSolverEngine } from './solverEngine';
import { CrossChainStateRepository } from '../persistence/repository';

export class DestinationExecutionEngine {
  private providers: Map<string, DestinationExecutionProvider> = new Map();
  private repository?: CrossChainStateRepository;

  constructor(
    defaultProvider: DestinationExecutionProvider = defaultSolverEngine,
    repository?: CrossChainStateRepository
  ) {
    this.registerProvider(defaultProvider);
    if (repository) {
      this.setRepository(repository);
    }
  }

  public registerProvider(provider: DestinationExecutionProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: string): DestinationExecutionProvider | undefined {
    return this.providers.get(id);
  }

  public setRepository(repository: CrossChainStateRepository): void {
    this.repository = repository;
    for (const p of this.providers.values()) {
      if (typeof (p as any).setRepository === 'function') {
        (p as any).setRepository(repository);
      }
    }
  }

  public getRepository(): CrossChainStateRepository | undefined {
    return this.repository;
  }

  public async getCombinedCapabilities(): Promise<DestinationExecutionCapabilities> {
    const supportedChains = new Set<string>();
    const supportedProtocols = new Set<any>();
    const supportedModes = new Set<any>();

    for (const p of this.providers.values()) {
      const caps = await p.getCapabilities();
      caps.supportedChains.forEach((c) => supportedChains.add(c));
      caps.supportedProtocols.forEach((pr) => supportedProtocols.add(pr));
      caps.supportedModes.forEach((m) => supportedModes.add(m));
    }

    return {
      supportedChains: Array.from(supportedChains),
      supportedProtocols: Array.from(supportedProtocols),
      supportedModes: Array.from(supportedModes),
      maxSlippageBps: 500
    };
  }

  public async prepareExecution(
    request: DestinationExecutionRequest
  ): Promise<DestinationExecutionPlan> {
    // Determine provider: use specific solverId if requested, else use first active provider
    let provider: DestinationExecutionProvider | undefined;
    if (request.solverId) {
      provider = this.providers.get(request.solverId);
    }
    if (!provider) {
      provider = Array.from(this.providers.values())[0];
    }

    if (!provider) {
      throw new CompositeExecutionUnavailableError(
        'No destination execution provider or solver is available.'
      );
    }

    return provider.prepareDestinationExecution(request);
  }

  public async executeDestinationSwap(params: {
    plan: DestinationExecutionPlan;
    signer?: any;
    provider?: any;
  }): Promise<DestinationExecutionResult> {
    const { plan, signer, provider } = params;

    if (plan.mode === 'UNSUPPORTED') {
      throw new DestinationExecutionUnavailableError(
        plan.tokenOut.symbol,
        plan.destinationChainId
      );
    }

    const execProvider = Array.from(this.providers.values())[0];
    if (!execProvider) {
      throw new CompositeExecutionUnavailableError('No destination execution provider available');
    }

    return execProvider.submitDestinationExecution(plan, signer, provider);
  }

  public async verifySettlement(params: {
    executionId: string;
    expectedRecipient: string;
    expectedToken: string;
    minAmount: bigint;
  }): Promise<DestinationVerification> {
    const execProvider = Array.from(this.providers.values())[0];
    if (!execProvider) {
      return {
        isVerified: false,
        recipient: params.expectedRecipient,
        expectedToken: params.expectedToken,
        expectedMinAmount: params.minAmount,
        reason: 'No execution provider registered for verification'
      };
    }

    return execProvider.verifyDestinationExecution(
      params.executionId,
      params.expectedRecipient,
      params.expectedToken,
      params.minAmount
    );
  }
}

export const defaultDestinationExecutionEngine = new DestinationExecutionEngine();
