import { logger } from '../logger.js';

/**
 * Maps a DexScreener `chainId` to the short chain code mevx expects in its
 * preview URL. mevx renders a real, pro-style candlestick chart (with
 * MC/Liq/Vol/TXNs overlay) as a PNG for these chains.
 */
const MEVX_CHAIN: Record<string, string> = {
  sui: 'sui',
  solana: 'sol',
  ethereum: 'eth',
  bsc: 'bsc',
  base: 'base',
  arbitrum: 'arbitrum',
  polygon: 'polygon',
  avalanche: 'avax',
  tron: 'tron',
  blast: 'blast',
  optimism: 'optimism',
};

/**
 * Builds a price-chart image URL for a token's pool. Primary source is mevx,
 * which serves a real candlestick chart PNG (Telegram fetches the URL itself).
 * We verify the URL returns an image before handing it out so a broken/404
 * preview never reaches Telegram; when mevx has no chart we fall back to a
 * candlestick rendered from GeckoTerminal OHLCV via QuickChart (still real
 * on-chain data), and only for Sui where that OHLCV feed is available.
 */
export class ChartService {
  private cache = new Map<string, { at: number; url: string | null }>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * @param pool  The pair/pool address (DexScreener `pairAddress`).
   * @param chain DexScreener `chainId` (e.g. "sui", "solana", "bsc"). Defaults
   *              to Sui for backward compatibility.
   */
  async chartUrl(pool: string, chain = 'sui'): Promise<string | null> {
    const key = `${chain}:${pool}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && now - cached.at < this.ttlMs) return cached.url;

    const url = (await this.mevxUrl(pool, chain)) ?? (chain === 'sui' ? await this.geckoCandles(pool) : null);
    this.cache.set(key, { at: now, url });
    return url;
  }

  /** Real mevx chart PNG — verified to actually resolve to an image. */
  private async mevxUrl(pool: string, chain: string): Promise<string | null> {
    const code = MEVX_CHAIN[chain];
    if (!code) return null;
    const url = `https://preview.mevx.io/preview/${pool}?chain=${code}`;
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) return url;
    } catch (err) {
      logger.debug('mevx preview check failed', { pool, chain, e: (err as Error).message });
    }
    return null;
  }

  /** Fallback: candlesticks from GeckoTerminal OHLCV rendered by QuickChart. */
  private async geckoCandles(pool: string): Promise<string | null> {
    try {
      const res = await this.fetchImpl(
        `https://api.geckoterminal.com/api/v2/networks/sui-network/pools/${pool}/ohlcv/hour?limit=48`,
        { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } },
      );
      if (res.ok) {
        const json = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
        const list = json.data?.attributes?.ohlcv_list ?? [];
        // ohlcv_list is newest-first: [ts, o, h, l, c, v]. Candles, oldest-first.
        const candles = list
          .map((r) => ({ o: r[1]!, h: r[2]!, l: r[3]!, c: r[4]! }))
          .reverse()
          .filter((k) => [k.o, k.h, k.l, k.c].every(Number.isFinite));
        if (candles.length >= 3) return buildCandlestickUrl(candles);
      }
    } catch (err) {
      logger.debug('chart fetch failed', { pool, e: (err as Error).message });
    }
    return null;
  }
}

function buildCandlestickUrl(candles: { o: number; h: number; l: number; c: number }[]): string {
  const data = candles.map((k, x) => ({ x, o: k.o, h: k.h, l: k.l, c: k.c }));
  const config = {
    type: 'candlestick',
    data: {
      datasets: [
        {
          label: '',
          data,
          color: { up: '#22c55e', down: '#ef4444', unchanged: '#8b949e' },
          borderColor: { up: '#22c55e', down: '#ef4444', unchanged: '#8b949e' },
        },
      ],
    },
    options: {
      plugins: { legend: { display: false }, title: { display: false } },
      scales: {
        x: { display: false },
        y: { ticks: { color: '#8b949e' }, grid: { color: 'rgba(139,148,158,0.12)' } },
      },
    },
  };
  const c = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?v=3&w=640&h=300&bkg=%230d1117&c=${c}`;
}
