import { describe, it, expect, vi } from 'vitest';
import { ChartService } from '../src/services/chart.js';

function imgRes(): Response {
  return new Response('PNGDATA', { status: 200, headers: { 'content-type': 'image/png' } });
}
function notFound(): Response {
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
}

describe('ChartService', () => {
  it('returns the mevx preview URL when mevx has a real chart (Sui)', async () => {
    const fetchImpl = vi.fn(async () => imgRes()) as unknown as typeof fetch;
    const chart = new ChartService(60_000, fetchImpl);
    const url = await chart.chartUrl('0xPOOL', 'sui');
    expect(url).toBe('https://preview.mevx.io/preview/0xPOOL?chain=sui');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps chain ids to mevx short codes (solana -> sol)', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (u: string) => {
      calls.push(u);
      return imgRes();
    }) as unknown as typeof fetch;
    const chart = new ChartService(60_000, fetchImpl);
    const url = await chart.chartUrl('PAIR', 'solana');
    expect(url).toBe('https://preview.mevx.io/preview/PAIR?chain=sol');
    expect(calls[0]).toContain('chain=sol');
  });

  it('falls back to a QuickChart candlestick from real OHLCV when mevx 404s (Sui)', async () => {
    const ohlcv = {
      data: { attributes: { ohlcv_list: [
        [3, 1, 1.2, 0.9, 1.1, 100],
        [2, 1.1, 1.3, 1.0, 1.2, 120],
        [1, 1.2, 1.25, 1.05, 1.15, 90],
      ] } },
    };
    const fetchImpl = vi.fn(async (u: string) => {
      if (u.includes('mevx.io')) return notFound();
      if (u.includes('geckoterminal')) return new Response(JSON.stringify(ohlcv), { status: 200, headers: { 'content-type': 'application/json' } });
      return notFound();
    }) as unknown as typeof fetch;
    const chart = new ChartService(60_000, fetchImpl);
    const url = await chart.chartUrl('0xPOOL', 'sui');
    expect(url).toContain('quickchart.io/chart');
    expect(url).toContain('candlestick');
  });

  it('returns null (no fallback) for a non-Sui chain mevx does not cover', async () => {
    const fetchImpl = vi.fn(async () => notFound()) as unknown as typeof fetch;
    const chart = new ChartService(60_000, fetchImpl);
    const url = await chart.chartUrl('0xPOOL', 'ethereum');
    expect(url).toBeNull();
  });

  it('caches results within the TTL', async () => {
    const fetchImpl = vi.fn(async () => imgRes()) as unknown as typeof fetch;
    const chart = new ChartService(60_000, fetchImpl);
    await chart.chartUrl('POOL', 'sui');
    await chart.chartUrl('POOL', 'sui');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
