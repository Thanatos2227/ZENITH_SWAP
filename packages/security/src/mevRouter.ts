import { MEVProtectionLevel } from '@zenith/types';

export interface MEVRouteConfig {
  protectionLevel: MEVProtectionLevel;
  rpcEndpoint: string;
  isPrivateMempool: boolean;
  frontrunningProtection: boolean;
  sandwichProtection: boolean;
  revertProtection: boolean;
  disclaimer?: string;
}

export class MEVRouter {
  public resolveMEVRoute(chainId: string, preferredLevel: MEVProtectionLevel): MEVRouteConfig {
    const normChain = chainId.toLowerCase();

    if (normChain === 'ethereum' || normChain === '1') {
      if (preferredLevel === 'FLASHBOTS_PRIVATE') {
        return {
          protectionLevel: 'FLASHBOTS_PRIVATE',
          rpcEndpoint: 'https://rpc.flashbots.net/fast',
          isPrivateMempool: true,
          frontrunningProtection: true,
          sandwichProtection: true,
          revertProtection: true
        };
      }
      if (preferredLevel === 'RPC_STEALTH') {
        return {
          protectionLevel: 'RPC_STEALTH',
          rpcEndpoint: 'https://protect.blocknative.com',
          isPrivateMempool: true,
          frontrunningProtection: true,
          sandwichProtection: true,
          revertProtection: false
        };
      }
    }

    const hasSequencerProtection = ['arbitrum', 'base', 'optimism'].includes(normChain);

    return {
      protectionLevel: 'NONE',
      rpcEndpoint: '',
      isPrivateMempool: false,
      frontrunningProtection: hasSequencerProtection,
      sandwichProtection: hasSequencerProtection,
      revertProtection: false,
      disclaimer: hasSequencerProtection
        ? 'Network utilizes a FIFO Sequencer for frontrunning defense (No private mempool bundle required).'
        : undefined
    };
  }
}

export const defaultMEVRouter = new MEVRouter();
