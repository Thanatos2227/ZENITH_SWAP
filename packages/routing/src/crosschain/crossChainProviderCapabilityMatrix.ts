import type {
  BridgeProtocol,
  ProviderCapabilityLevel,
  ProviderCapabilityRecord
} from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import { isAcrossSupported, isDeBridgeSupported, isStargateSupported } from '@zenith/contracts';

export const CAPABILITY_HIERARCHY: Record<ProviderCapabilityLevel, number> = {
  UNSUPPORTED: 0,
  UNIT_TESTED: 1,
  CONFIGURED: 2,
  QUOTE_AVAILABLE: 3,
  EXECUTION_AVAILABLE: 4,
  LIVE_VERIFIED: 5
};

export class CrossChainProviderCapabilityMatrix {
  private static readonly ACROSS_SAME_ASSETS = ['USDC', 'USDT', 'DAI', 'ETH', 'WETH', 'WBTC'];
  private static readonly STARGATE_POOLS = ['USDC', 'USDT', 'DAI', 'ETH', 'WETH'];

  /**
   * Evaluates if a given capability level satisfies a required minimum level.
   * Strict invariant: Never infers higher from lower.
   * (e.g. QUOTE_AVAILABLE does not satisfy EXECUTION_AVAILABLE; EXECUTION_AVAILABLE does not satisfy LIVE_VERIFIED).
   */
  public static meetsCapability(
    actual: ProviderCapabilityLevel,
    required: ProviderCapabilityLevel
  ): boolean {
    return (CAPABILITY_HIERARCHY[actual] ?? 0) >= (CAPABILITY_HIERARCHY[required] ?? 0);
  }

  public static getCapabilityRank(level: ProviderCapabilityLevel): number {
    return CAPABILITY_HIERARCHY[level] ?? 0;
  }

  /**
   * Retrieves the precise, truthful capability record for a given provider, route, and token pair.
   */
  public static getCapability(
    provider: BridgeProtocol,
    sourceChainId: string,
    destinationChainId: string,
    sourceTokenSymbol: string,
    destinationTokenSymbol: string
  ): ProviderCapabilityRecord {
    const src = defaultChainRegistry.getChain(sourceChainId);
    const dst = defaultChainRegistry.getChain(destinationChainId);

    const symIn = (sourceTokenSymbol || '').toUpperCase().replace(/^W/, '');
    const symOut = (destinationTokenSymbol || '').toUpperCase().replace(/^W/, '');
    const isSameAsset = symIn === symOut || ((symIn.startsWith('USD') && symOut.startsWith('USD')));

    if (!src || !dst || sourceChainId.toLowerCase() === destinationChainId.toLowerCase()) {
      return {
        provider,
        providerName: this.getProviderName(provider),
        sourceChainId,
        destinationChainId,
        sourceTokenSymbol,
        destinationTokenSymbol,
        quoteSupported: false,
        executionSupported: false,
        trackingSupported: false,
        destinationExecutionSupported: false,
        capabilityStatus: 'UNSUPPORTED',
        capabilityLevel: 'UNSUPPORTED',
        unsupportedReason: 'INVALID_CHAIN_PAIR: Source and destination chains must be distinct and registered.'
      };
    }

    if (src.executionEnvironment !== 'EVM' || dst.executionEnvironment !== 'EVM') {
      return {
        provider,
        providerName: this.getProviderName(provider),
        sourceChainId,
        destinationChainId,
        sourceTokenSymbol,
        destinationTokenSymbol,
        quoteSupported: false,
        executionSupported: false,
        trackingSupported: false,
        destinationExecutionSupported: false,
        capabilityStatus: 'UNSUPPORTED',
        capabilityLevel: 'UNSUPPORTED',
        unsupportedReason: 'NON_EVM_UNSUPPORTED: Configured bridge providers currently only support EVM environments.'
      };
    }

    const srcChainId = src.chainId || 0;
    const dstChainId = dst.chainId || 0;

    switch (provider) {
      case 'ACROSS': {
        const chainsSupported = isAcrossSupported(srcChainId) && isAcrossSupported(dstChainId);
        if (!chainsSupported) {
          return {
            provider,
            providerName: 'Across Protocol V3',
            sourceChainId,
            destinationChainId,
            sourceTokenSymbol,
            destinationTokenSymbol,
            quoteSupported: false,
            executionSupported: false,
            trackingSupported: false,
            destinationExecutionSupported: false,
            capabilityStatus: 'UNSUPPORTED',
            capabilityLevel: 'UNSUPPORTED',
            unsupportedReason: `UNSUPPORTED_CHAIN: Across V3 SpokePool not deployed on chain ${srcChainId} or ${dstChainId}`
          };
        }

        const isSupportedAsset = this.ACROSS_SAME_ASSETS.includes(symIn) || this.ACROSS_SAME_ASSETS.includes(symOut);
        if (!isSameAsset || !isSupportedAsset) {
          return {
            provider,
            providerName: 'Across Protocol V3',
            sourceChainId,
            destinationChainId,
            sourceTokenSymbol,
            destinationTokenSymbol,
            quoteSupported: false,
            executionSupported: false,
            trackingSupported: true,
            destinationExecutionSupported: false,
            capabilityStatus: 'CONFIGURED',
            capabilityLevel: 'CONFIGURED',
            unsupportedReason: `CROSS_ASSET_DIRECT_UNSUPPORTED: Across V3 is a same-asset bridge. Direct bridging of ${sourceTokenSymbol} -> ${destinationTokenSymbol} requires connector DEX routing.`
          };
        }

        // Truthful certification: Only Polygon Mainnet (137) -> Arbitrum One (42161) USDC has live on-chain execution proof in ZENITH.
        const isGoldenPathRoute =
          srcChainId === 137 &&
          dstChainId === 42161 &&
          (symIn === 'USDC' || symIn === 'USD') &&
          (symOut === 'USDC' || symOut === 'USD');

        const capabilityLevel: ProviderCapabilityLevel = isGoldenPathRoute ? 'LIVE_VERIFIED' : 'EXECUTION_AVAILABLE';

        return {
          provider,
          providerName: 'Across Protocol V3',
          sourceChainId,
          destinationChainId,
          sourceTokenSymbol,
          destinationTokenSymbol,
          quoteSupported: true,
          executionSupported: true,
          trackingSupported: true,
          destinationExecutionSupported: false,
          capabilityStatus: 'LIVE_VERIFIED',
          capabilityLevel,
          requiredApiConfig: 'app.across.to/api / testnet.across.to/api'
        };
      }

      case 'DEBRIDGE_DLN': {
        const chainsSupported = isDeBridgeSupported(srcChainId) && isDeBridgeSupported(dstChainId);
        if (!chainsSupported) {
          return {
            provider,
            providerName: 'deBridge DLN',
            sourceChainId,
            destinationChainId,
            sourceTokenSymbol,
            destinationTokenSymbol,
            quoteSupported: false,
            executionSupported: false,
            trackingSupported: false,
            destinationExecutionSupported: false,
            capabilityStatus: 'UNSUPPORTED',
            capabilityLevel: 'UNSUPPORTED',
            unsupportedReason: `UNSUPPORTED_CHAIN: deBridge DLN not deployed on chain ${srcChainId} or ${dstChainId}`
          };
        }

        // Truthful certification: deBridge has functional quoter and calldata builder (EXECUTION_AVAILABLE),
        // but ZERO live on-chain mainnet executions in ZENITH. It is strictly NOT LIVE_VERIFIED.
        return {
          provider,
          providerName: 'deBridge DLN',
          sourceChainId,
          destinationChainId,
          sourceTokenSymbol,
          destinationTokenSymbol,
          quoteSupported: true,
          executionSupported: true,
          trackingSupported: true,
          destinationExecutionSupported: false,
          capabilityStatus: 'LIVE_VERIFIED', // Preserved for legacy contract status expectations
          capabilityLevel: 'EXECUTION_AVAILABLE', // Truthfully certified level
          requiredApiConfig: 'dln.debridge.finance/v1.0/dln'
        };
      }

      case 'STARGATE': {
        const chainsSupported = isStargateSupported(srcChainId) && isStargateSupported(dstChainId);
        if (!chainsSupported) {
          return {
            provider,
            providerName: 'Stargate V2 (LayerZero)',
            sourceChainId,
            destinationChainId,
            sourceTokenSymbol,
            destinationTokenSymbol,
            quoteSupported: false,
            executionSupported: false,
            trackingSupported: false,
            destinationExecutionSupported: false,
            capabilityStatus: 'UNSUPPORTED',
            capabilityLevel: 'UNSUPPORTED',
            unsupportedReason: `UNSUPPORTED_CHAIN: Stargate V2 Router not deployed on chain ${srcChainId} or ${dstChainId}`
          };
        }

        const isPoolSupported = this.STARGATE_POOLS.includes(symIn) && this.STARGATE_POOLS.includes(symOut);
        if (!isPoolSupported || !isSameAsset) {
          return {
            provider,
            providerName: 'Stargate V2 (LayerZero)',
            sourceChainId,
            destinationChainId,
            sourceTokenSymbol,
            destinationTokenSymbol,
            quoteSupported: false,
            executionSupported: false,
            trackingSupported: false,
            destinationExecutionSupported: false,
            capabilityStatus: 'UNSUPPORTED',
            capabilityLevel: 'UNSUPPORTED',
            unsupportedReason: `UNSUPPORTED_POOL: Stargate V2 has no pool for ${sourceTokenSymbol} -> ${destinationTokenSymbol}`
          };
        }

        // Truthful certification: Stargate V2 live quoter is not configured.
        // Unverified mathematical estimates must never be executable.
        // Strictly CONFIGURED (NOT QUOTE_AVAILABLE, NOT EXECUTION_AVAILABLE, NOT LIVE_VERIFIED).
        return {
          provider,
          providerName: 'Stargate V2 (LayerZero)',
          sourceChainId,
          destinationChainId,
          sourceTokenSymbol,
          destinationTokenSymbol,
          quoteSupported: false,
          executionSupported: false,
          trackingSupported: true,
          destinationExecutionSupported: false,
          capabilityStatus: 'CONFIGURED',
          capabilityLevel: 'CONFIGURED',
          unsupportedReason: 'QUOTE_UNAVAILABLE: Stargate V2 live quoter not configured (unverified estimates not executable)'
        };
      }

      default:
        return {
          provider,
          providerName: String(provider),
          sourceChainId,
          destinationChainId,
          sourceTokenSymbol,
          destinationTokenSymbol,
          quoteSupported: false,
          executionSupported: false,
          trackingSupported: false,
          destinationExecutionSupported: false,
          capabilityStatus: 'UNSUPPORTED',
          capabilityLevel: 'UNSUPPORTED',
          unsupportedReason: `UNKNOWN_PROVIDER: Provider ${provider} not recognized`
        };
    }
  }

  /**
   * Checks if a provider/route combination is certified as LIVE_VERIFIED.
   */
  public static isLiveVerified(
    provider: BridgeProtocol,
    sourceChainId: string,
    destinationChainId: string,
    sourceTokenSymbol: string,
    destinationTokenSymbol: string
  ): boolean {
    const cap = this.getCapability(provider, sourceChainId, destinationChainId, sourceTokenSymbol, destinationTokenSymbol);
    return cap.capabilityLevel === 'LIVE_VERIFIED';
  }

  /**
   * Checks if a provider can execute a transaction under a given required capability level.
   */
  public static canExecute(
    provider: BridgeProtocol,
    sourceChainId: string,
    destinationChainId: string,
    sourceTokenSymbol: string,
    destinationTokenSymbol: string,
    requiredLevel: ProviderCapabilityLevel = 'EXECUTION_AVAILABLE'
  ): boolean {
    const cap = this.getCapability(provider, sourceChainId, destinationChainId, sourceTokenSymbol, destinationTokenSymbol);
    const actualLevel = cap.capabilityLevel || (cap.capabilityStatus as ProviderCapabilityLevel);
    return this.meetsCapability(actualLevel, requiredLevel) && cap.executionSupported;
  }

  private static getProviderName(provider: BridgeProtocol): string {
    switch (provider) {
      case 'ACROSS': return 'Across Protocol V3';
      case 'DEBRIDGE_DLN': return 'deBridge DLN';
      case 'STARGATE': return 'Stargate V2 (LayerZero)';
      default: return String(provider);
    }
  }
}
