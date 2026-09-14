import type { SuiClient } from '@mysten/sui/client';
import type { AppConfig } from '../config.js';
import type { SwapProvider } from './types.js';
import { MockSwapProvider } from './providers/mock.js';
import { CetusAggregatorProvider } from './providers/cetus.js';
import { logger } from '../logger.js';

/** Build the configured swap provider. */
export function createSwapProvider(config: AppConfig, suiClient: SuiClient): SwapProvider {
  switch (config.swapProvider) {
    case 'cetus':
      return new CetusAggregatorProvider(
        suiClient,
        config.network,
        config.swapApiBaseUrl || undefined,
      );
    case 'sevenk':
      logger.warn('SWAP_PROVIDER=sevenk is not bundled; falling back to Cetus aggregator.');
      return new CetusAggregatorProvider(suiClient, config.network);
    case 'mock':
    default:
      return new MockSwapProvider();
  }
}
