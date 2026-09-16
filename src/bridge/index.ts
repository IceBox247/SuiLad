import type { AppConfig } from '../config.js';
import { AggregatorBridgeProvider } from './http.js';
import { LifiBridgeProvider } from './lifi.js';
import { MockBridgeProvider } from './mock.js';
import type { BridgeProvider, BridgeQuote, BridgeQuoteRequest } from './types.js';

export * from './types.js';
export { MockBridgeProvider } from './mock.js';
export { LifiBridgeProvider, parseLifiBridgeQuote } from './lifi.js';
export { AggregatorBridgeProvider, parseBridgeQuote } from './http.js';

const DEFAULT_BASE: Record<string, string> = {
  mayan: 'https://price-api.mayan.finance/v3',
  debridge: 'https://dln.debridge.finance/v1.0/dln',
};

export function createBridgeProvider(config: AppConfig): BridgeProvider {
  if (config.bridgeProvider === 'mock') return new MockBridgeProvider();
  if (config.bridgeProvider === 'lifi') return new LifiBridgeProvider();
  const base = config.bridgeApiBaseUrl || DEFAULT_BASE[config.bridgeProvider]!;
  return new AggregatorBridgeProvider(config.bridgeProvider, base);
}

/** Thin service wrapper for quoting bridges (execution handled by the provider/relayer). */
export class BridgeService {
  constructor(private readonly provider: BridgeProvider) {}

  get providerName(): string {
    return this.provider.name;
  }

  supports(req: Pick<BridgeQuoteRequest, 'fromChain' | 'toChain'>): boolean {
    return this.provider.supports(req.fromChain, req.toChain);
  }

  async quote(req: BridgeQuoteRequest): Promise<BridgeQuote> {
    return this.provider.quote(req);
  }
}
