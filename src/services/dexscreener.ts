import { logger } from '../logger.js';

export interface TokenInfo {
  symbol: string;
  name: string;
  priceUsd: number;
  priceNative: number; // in SUI
  mcUsd: number; // market cap (or FDV fallback)
  liquidityUsd: number;
  volume24: number;
  change1h: number;
  change6h: number;
  change24h: number;
  /** SUI amount pooled on the quote side of the pair. */
  pooledSui: number;
  buys24: number;
  sells24: number;
  dexId: string;
  url: string;
  pairAddress: string;
  /** DexScreener chain id (e.g. "sui", "solana", "bsc") — drives chart lookup. */
  chainId: string;
}

interface DsPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number };
  priceChange?: { h1?: number; h6?: number; h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  fdv?: number;
  marketCap?: number;
}

/**
 * Fetches rich token market data (price, market cap, liquidity, volume, price
 * change) from the public DexScreener API. Cached briefly to stay responsive.
 */
export class DexScreener {
  private cache = new Map<string, { at: number; data: TokenInfo | null }>();

  constructor(
    private readonly ttlMs = 20_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async token(coinType: string): Promise<TokenInfo | null> {
    const now = Date.now();
    const cached = this.cache.get(coinType);
    if (cached && now - cached.at < this.ttlMs) return cached.data;

    let data: TokenInfo | null = null;
    try {
      const res = await this.fetchImpl(`https://api.dexscreener.com/latest/dex/tokens/${coinType}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const json = (await res.json()) as { pairs?: DsPair[] };
        const suiPairs = (json.pairs ?? []).filter((p) => p.chainId === 'sui');
        // Pick the deepest-liquidity pair as the reference.
        const best = suiPairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
        if (best) data = normalize(best);
      }
    } catch (err) {
      logger.debug('dexscreener fetch failed', { coinType, e: (err as Error).message });
    }
    this.cache.set(coinType, { at: now, data });
    return data;
  }
}

function normalize(p: DsPair): TokenInfo {
  return {
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    priceUsd: Number(p.priceUsd ?? 0),
    priceNative: Number(p.priceNative ?? 0),
    mcUsd: p.marketCap ?? p.fdv ?? 0,
    liquidityUsd: p.liquidity?.usd ?? 0,
    volume24: p.volume?.h24 ?? 0,
    change1h: p.priceChange?.h1 ?? 0,
    change6h: p.priceChange?.h6 ?? 0,
    change24h: p.priceChange?.h24 ?? 0,
    pooledSui: p.liquidity?.quote ?? 0,
    buys24: p.txns?.h24?.buys ?? 0,
    sells24: p.txns?.h24?.sells ?? 0,
    dexId: p.dexId,
    url: p.url,
    pairAddress: p.pairAddress,
    chainId: p.chainId,
  };
}

/** Compact USD formatter: 1234 -> $1.23K, 2_300_000 -> $2.3M. */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

/** Signed percent with arrow: 12.3 -> "🟢 +12.3%", -4 -> "🔴 -4%". */
export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const arrow = n >= 0 ? '🟢 +' : '🔴 ';
  return `${arrow}${n.toFixed(1)}%`;
}
