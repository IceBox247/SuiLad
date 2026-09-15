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
        // ohlcv_list is newest-first: [ts, o, h, l, c, v]. Use closes, oldest-first.
        const closes = list.map((r) => r[4]!).reverse().filter((n) => Number.isFinite(n));
        if (closes.length >= 3) url = buildQuickChartUrl(closes);
      }
    } catch (err) {
      logger.debug('chart fetch failed', { pool, e: (err as Error).message });
    }
    this.cache.set(pool, { at: now, url });
    return url;
  }
}

function buildQuickChartUrl(closes: number[]): string {
  const up = closes[closes.length - 1]! >= closes[0]!;
  const color = up ? '#22c55e' : '#ef4444';
  const config = {
    type: 'line',
    data: {
      labels: closes.map(() => ''),
      datasets: [
        {
          data: closes,
          borderColor: color,
          backgroundColor: up ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.35,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  };
  const c = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?w=640&h=280&bkg=%230d1117&c=${c}`;
}
