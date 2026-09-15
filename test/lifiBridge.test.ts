import { describe, it, expect, vi } from 'vitest';
import { LifiBridgeProvider, parseLifiBridgeQuote } from '../src/bridge/lifi.js';
import type { BridgeQuoteRequest } from '../src/bridge/types.js';

function req(over: Partial<BridgeQuoteRequest> = {}): BridgeQuoteRequest {
  return { fromChain: 'polygon', toChain: 'arbitrum', fromToken: 'USDC', toToken: 'USDC', amount: '25000000', toAddress: '0xdead', ...over };
}

describe('LifiBridgeProvider.supports', () => {
  it('supports cross-chain EVM/Solana routes, not same-chain or Sui', () => {
    const p = new LifiBridgeProvider();
    expect(p.supports('polygon', 'arbitrum')).toBe(true);
    expect(p.supports('ethereum', 'solana')).toBe(true);
    expect(p.supports('polygon', 'polygon')).toBe(false);
    expect(p.supports('sui', 'polygon')).toBe(false);
  });
});

describe('parseLifiBridgeQuote', () => {
  it('extracts output, summed fee (USD) and ETA', () => {
    const json = {
      estimate: {
        toAmount: '24937500',
        toAmountMin: '24800000',
        executionDuration: 1080,
        feeCosts: [{ amountUSD: '0.05' }],
        gasCosts: [{ amountUSD: '0.03' }],
      },
    };
    const q = parseLifiBridgeQuote(json, req());
    expect(q.provider).toBe('lifi');
    expect(q.estAmountOut).toBe('24937500');
    expect(q.feeUsd).toBe('0.08');
    expect(q.etaSeconds).toBe(1080);
  });

  it('throws when the quote has no output amount', () => {
    expect(() => parseLifiBridgeQuote({ estimate: {} }, req())).toThrow(/output amount/);
  });
});

describe('LifiBridgeProvider.quote (mocked fetch)', () => {
  it('resolves token symbols then requests a cross-chain route', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (u: string) => {
      calls.push(u);
      if (u.includes('/token?')) return ok({ address: '0xTOKEN' });
      return ok({ estimate: { toAmount: '24937500', executionDuration: 900, feeCosts: [], gasCosts: [] } });
    }) as any;
    const p = new LifiBridgeProvider(fetchImpl);
    const q = await p.quote(req());
    expect(calls.some((c) => c.includes('/token?chain=POL'))).toBe(true);
    expect(calls.some((c) => c.includes('/quote?fromChain=POL&toChain=ARB'))).toBe(true);
    expect(q.estAmountOut).toBe('24937500');
  });

  it('rejects an unsupported route before calling the network', async () => {
    const fetchImpl = vi.fn(async () => ok({})) as any;
    const p = new LifiBridgeProvider(fetchImpl);
    await expect(p.quote(req({ fromChain: 'sui' }))).rejects.toThrow(/isn't supported/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
