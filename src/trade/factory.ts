import type { SuiClient } from '@mysten/sui/client';
import type { AppConfig } from '../config.js';
import type { SwapProvider } from './types.js';
import { MockSwapProvider } from './providers/mock.js';
import { CetusAggregatorProvider } from './providers/cetus.js';

/** Build the configured swap provider. */
export function createSwapProvider(config: AppConfig, suiClient: SuiClient): SwapProvider {
  if (config.swapProvider === 'cetus') {
    return new CetusAggregatorProvider(suiClient, config.network, config.swapApiBaseUrl || undefined);
  }
  return new MockSwapProvider();
}
