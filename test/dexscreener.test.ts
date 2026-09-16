import { describe, it, expect, vi } from 'vitest';
import { DexScreener } from '../src/services/dexscreener.js';

function res(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('DexScreener.bestChain', () => {
  it('picks the deepest-liquidity chain across all pairs', async () => {
    const fetchImpl = vi.fn(async () => res({ pairs: [
      { chainId: 'ethereum', pairAddress: '0xeth', liquidity: { usd: 1000 } },
      { chainId: 'base', pairAddress: '0xbase', liquidity: { usd: 50000 } },
      { chainId: 'arbitrum', pairAddress: '0xarb', liquidity: { usd: 20000 } },
    ] })) as unknown as typeof fetch;
    const d = new DexScreener(20_000, fetchImpl);
    const best = await d.bestChain('0xToken');
    expect(best?.chainId).toBe('base');
    expect(best?.pairAddress).toBe('0xbase');
  });

  it('returns null when the token is unlisted', async () => {
    const fetchImpl = vi.fn(async () => res({ pairs: [] })) as unknown as typeof fetch;
    const d = new DexScreener(20_000, fetchImpl);
    expect(await d.bestChain('0xNope')).toBeNull();
  });
});
