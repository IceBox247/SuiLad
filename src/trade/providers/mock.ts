import { Transaction } from '@mysten/sui/transactions';
import type { BuildSwapParams, Quote, QuoteRequest, SwapProvider } from '../types.js';
import { applySlippage } from '../quote.js';
import { SUI_TYPE } from '../../sui/service.js';

/**
 * Offline, deterministic swap provider for development and tests.
 *
 * Pricing is driven by a rate table mapping `"<inType>-><outType>"` to a
 * [outNumerator, inDenominator] ratio expressed in base units. Unknown pairs
 * default to 1:1. It does NOT perform real swaps: `buildTransaction` produces a
 * self-transfer of the input amount so the execution plumbing can be exercised
 * end-to-end on a real network without moving value to a third party.
 */
export class MockSwapProvider implements SwapProvider {
  readonly name = 'mock';

  constructor(private readonly rates: Record<string, [bigint, bigint]> = {}) {}

  async quote(req: QuoteRequest): Promise<Quote> {
    const key = `${req.inputType}->${req.outputType}`;
    const [num, den] = this.rates[key] ?? [1n, 1n];
    const amountOut = (req.amountIn * num) / den;
    const minAmountOut = applySlippage(amountOut, req.slippageBps);
    return {
      inputType: req.inputType,
      outputType: req.outputType,
      amountIn: req.amountIn,
      amountOut,
      minAmountOut,
      slippageBps: req.slippageBps,
      priceImpact: '0',
      routeLabel: 'MOCK',
      raw: { key },
    };
  }

  async buildTransaction(params: BuildSwapParams): Promise<Transaction> {
    const { quote, sender } = params;
    const tx = new Transaction();
    tx.setSender(sender);
    // Self-transfer as a safe stand-in for a real swap.
    if (quote.inputType === SUI_TYPE) {
      const [coin] = tx.splitCoins(tx.gas, [quote.amountIn]);
      tx.transferObjects([coin], sender);
    } else {
      // For non-SUI, just transfer a zero-value marker to self via gas.
      const [coin] = tx.splitCoins(tx.gas, [0n]);
      tx.transferObjects([coin], sender);
    }
    return tx;
  }
}
