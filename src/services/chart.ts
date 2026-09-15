import { logger } from '../logger.js';

/**
 * Builds a price-chart image URL for a Sui pool. Pulls hourly OHLCV from
 * GeckoTerminal and renders a compact sparkline PNG via QuickChart (Telegram
 * fetches the URL directly, so we never download the image ourselves).
 */
export class ChartService {
  private cache = new Map<string, { at: number; url: string | null }>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async chartUrl(pool: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.cache.get(pool);
    if (cached && now - cached.at < this.ttlMs) return cached.url;

    let url: string | null = null;
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
        if (candles.length >= 3) url = buildCandlestickUrl(candles);
      }
    } catch (err) {
      logger.debug('chart fetch failed', { pool, e: (err as Error).message });
    }
    this.cache.set(pool, { at: now, url });
    return url;
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
