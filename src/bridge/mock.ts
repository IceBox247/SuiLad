import { SUPPORTED_CHAINS, type BridgeProvider, type BridgeQuote, type BridgeQuoteRequest, type Chain } from './types.js';

/**
 * Deterministic bridge provider for dev/tests. Applies a flat bridge fee and a
 * fixed ETA so the full bridge flow can be exercised offline.
 */
export class MockBridgeProvider implements BridgeProvider {
  readonly name = 'mock';

  constructor(private readonly feeRate = 0.001) {}

  supports(from: Chain, to: Chain): boolean {
    return from !== to && SUPPORTED_CHAINS.includes(from) && SUPPORTED_CHAINS.includes(to);
  }

  async quote(req: BridgeQuoteRequest): Promise<BridgeQuote> {
    if (!this.supports(req.fromChain, req.toChain)) {
      throw new Error(`Bridging ${req.fromChain} → ${req.toChain} is not supported.`);
    }
    const amountIn = Number(req.amount);
    if (!(amountIn > 0)) throw new Error('Amount must be positive.');
    const out = amountIn * (1 - this.feeRate);
    return {
      provider: this.name,
      fromChain: req.fromChain,
      toChain: req.toChain,
      fromToken: req.fromToken,
      toToken: req.toToken,
      amountIn: req.amount,
      estAmountOut: out.toString(),
      feeUsd: (amountIn * this.feeRate).toFixed(4),
      etaSeconds: 120,
      raw: { simulated: true },
    };
  }
}
