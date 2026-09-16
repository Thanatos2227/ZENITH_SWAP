import { getUniswapV3Router } from '../protocols/uniswap';
import { getAerodromeRouter } from '../protocols/aerodrome';
import { getVelodromeRouter } from '../protocols/velodrome';
import { getCamelotRouter } from '../protocols/camelot';
import { getQuickSwapRouter } from '../protocols/quickswap';
import { getPancakeSwapRouter } from '../protocols/pancakeswap';
import { getTraderJoeRouter } from '../protocols/traderjoe';
import { getZenithV1Router } from '../protocols/zenithV1';
import { getZenithV2Router } from '../protocols/zenithV2';
import { getZenithV3Router } from '../protocols/zenithV3';
import { getAcrossSpokePool, isAcrossSupported } from '../protocols/across';
import { getStargateRouter, isStargateSupported } from '../protocols/stargate';
import { getDeBridgeSourceContract, isDeBridgeSupported } from '../protocols/debridge';
import { getPermit2Address, isPermit2Supported } from '../protocols/permit2';
import { ConfigurationError, UnsupportedProtocolError } from '../errors';

export const EVM_WRAPPED_NATIVE_TOKENS: Record<number, string> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  10: '0x4200000000000000000000000000000000000006',
  56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  8453: '0x4200000000000000000000000000000000000006',
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  43114: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  59144: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
  534352: '0x5300000000000000000000000000000000000004',
  81457: '0x4300000000000000000000000000000000000004',
  34443: '0x4200000000000000000000000000000000000006',
  324: '0x5AEa5775959fBC2557Cc878966da0dd3ba3ACd7D',
  1101: '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9',
  42220: '0x471EcE3750Da237f93B8E339c536989b8978a438',
  100: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d'
};

export class EVMContractRegistry {
  public static getPrimaryRouter(chainId: number): string {
    switch (chainId) {
      case 8453:
        return getAerodromeRouter(chainId);
      case 10:
        return getVelodromeRouter(chainId);
      case 42161:
        return getCamelotRouter(chainId);
      case 137:
        return getQuickSwapRouter(chainId);
      case 56:
        return getPancakeSwapRouter(chainId);
      case 43114:
        return getTraderJoeRouter(chainId);
      default:
        return getUniswapV3Router(chainId);
    }
  }

  public static getRouterForProtocol(protocol: string, chainId: number): string {
    switch (protocol.toUpperCase()) {
      case 'ZENITH_V1': {
        const r = getZenithV1Router(chainId);
        if (!r) throw new UnsupportedProtocolError(protocol, chainId);
        return r;
      }
      case 'ZENITH_V2': {
        const r = getZenithV2Router(chainId);
        if (!r) throw new UnsupportedProtocolError(protocol, chainId);
        return r;
      }
      case 'ZENITH_V3': {
        const r = getZenithV3Router(chainId);
        if (!r) throw new UnsupportedProtocolError(protocol, chainId);
        return r;
      }
      case 'UNISWAP_V3':
      case 'UNISWAP_V2':
      case 'UNISWAP_V4':
        return getUniswapV3Router(chainId);
      case 'AERODROME':
        return getAerodromeRouter(chainId);
      case 'VELODROME':
        return getVelodromeRouter(chainId);
      case 'CAMELOT':
        return getCamelotRouter(chainId);
      case 'QUICKSWAP':
        return getQuickSwapRouter(chainId);
      case 'PANCAKESWAP':
        return getPancakeSwapRouter(chainId);
      case 'TRADER_JOE':
        return getTraderJoeRouter(chainId);
      default:
        throw new UnsupportedProtocolError(protocol, chainId);
    }
  }

  public static getWrappedNative(chainId: number): string {
    const wrapped = EVM_WRAPPED_NATIVE_TOKENS[chainId];
    if (!wrapped) {
      throw new ConfigurationError(
        `Wrapped native asset address is not configured for chain ID ${chainId}`,
        'WRAPPED_NATIVE_UNAVAILABLE'
      );
    }
    return wrapped;
  }

  public static getPermit2(chainId: number): string {
    return getPermit2Address(chainId);
  }

  public static isPermit2Supported(chainId: number): boolean {
    return isPermit2Supported(chainId);
  }

  public static getAcrossSpokePool(chainId: number): string {
    return getAcrossSpokePool(chainId);
  }

  public static isAcrossSupported(chainId: number): boolean {
    return isAcrossSupported(chainId);
  }

  public static getStargateRouter(chainId: number): string {
    return getStargateRouter(chainId);
  }

  public static isStargateSupported(chainId: number): boolean {
    return isStargateSupported(chainId);
  }

  public static getDeBridgeContract(chainId: number): string {
    return getDeBridgeSourceContract(chainId);
  }

  public static isDeBridgeSupported(chainId: number): boolean {
    return isDeBridgeSupported(chainId);
  }
}
