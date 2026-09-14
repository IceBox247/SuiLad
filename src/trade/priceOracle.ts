import type { SwapProvider } from './types.js';
import { SuiService, SUI_TYPE } from '../sui/service.js';

const X18 = 10n ** 18n;

interface CacheEntry {
  priceX18: bigint;
  at: number;
}

/**
 * Prices a token in SUI using the routing provider. Price is expressed as
 * SUI-per-token in 18-dp fixed point (bigint) for exact order comparisons.
 * Results are cached briefly to keep the bot responsive under load.
 */
export class PriceOracle {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly provider: SwapProvider,
    private readonly sui: SuiService,
    private readonly ttlMs = 10_000,
    private readonly probeSui = 1, // notional SUI used to probe price
  ) {}

  /** SUI-per-token price in 18-dp fixed point. Throws if there is no route. */
  async priceX18(coinType: string, opts: { fresh?: boolean } = {}): Promise<bigint> {
    if (coinType === SUI_TYPE) return X18;
    const now = Date.now();
    const cached = this.cache.get(coinType);
    if (!opts.fresh && cached && now - cached.at < this.ttlMs) return cached.priceX18;

    const meta = await this.sui.getCoinMeta(coinType);
    const oneSui = BigInt(this.probeSui) * 10n ** 9n;
    const quote = await this.provider.quote({
      inputType: SUI_TYPE,
      outputType: coinType,
      amountIn: oneSui,
      slippageBps: 100,
    });
    const tokensOut = quote.amountOut; // base units of token for probeSui SUI
    if (tokensOut <= 0n) throw new Error('No price (no liquidity).');
    // price(SUI per token, X18) = probeSui * 10^dec * 1e18 / tokensOut
    const priceX18 = (BigInt(this.probeSui) * 10n ** BigInt(meta.decimals) * X18) / tokensOut;
    this.cache.set(coinType, { priceX18, at: now });
    return priceX18;
  }

  /** Convenience: price as a human number (SUI per token). */
  async priceNumber(coinType: string): Promise<number> {
    const p = await this.priceX18(coinType);
    return Number(p) / 1e18;
  }

  /** Parse a human SUI-per-token price into X18. */
  static toX18(price: string | number): bigint {
    const s = typeof price === 'number' ? price.toFixed(18) : price;
    const [int = '0', frac = ''] = s.split('.');
    const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
    return BigInt(int) * X18 + BigInt(fracPadded || '0');
  }

  static fromX18(x18: bigint): number {
    return Number(x18) / 1e18;
  }
}
