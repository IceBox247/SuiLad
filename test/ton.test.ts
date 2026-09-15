import { describe, it, expect, vi } from 'vitest';
import { TonAdapter } from '../src/chains/ton.js';

describe('TonAdapter wallets', () => {
  it('creates and re-imports a wallet from a seed', async () => {
    const a = new TonAdapter();
    const w = await a.createWallet();
    expect(w.scheme).toBe('ED25519');
    expect(a.isValidAddress(w.address)).toBe(true);
    expect(a.isValidSecret(w.secretKey)).toBe(true);
    const w2 = await a.importWallet(w.secretKey);
    expect(w2.address).toBe(w.address);
  });

  it('validates friendly TON addresses and rejects junk', () => {
    const a = new TonAdapter();
    expect(a.isValidAddress('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N')).toBe(true);
    expect(a.isValidAddress('UQCUzPOWqD5HwmOYQ3p-lQIFCRY3cNp7drgLV4Eztz65-Mx2')).toBe(true);
    expect(a.isValidAddress('not-a-ton-address')).toBe(false);
    expect(a.isValidAddress('0x1234')).toBe(false);
  });
});

describe('TonAdapter reads (mocked fetch)', () => {
  it('reads native balance from toncenter', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: '2500000000' }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const a = new TonAdapter('', fetchImpl);
    expect(await a.getNativeBalance('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N')).toBe(2_500_000_000n);
  });

  it('reads token metadata from STON.fi assets', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ asset: { symbol: 'USDT', display_name: 'Tether', decimals: 6 } }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const a = new TonAdapter('', fetchImpl);
    const meta = await a.getTokenMeta('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs');
    expect(meta.symbol).toBe('USDT');
    expect(meta.decimals).toBe(6);
  });

  it('estimates a quote from STON.fi prices', async () => {
    // TON $5, USDT $1 → 1 TON ≈ 5 USDT.
    const fetchImpl = vi.fn(async (u: string) => {
      const price = u.includes('EQCxE6') ? { dex_price_usd: '1', decimals: 6 } : { dex_price_usd: '5' };
      return new Response(JSON.stringify({ asset: price }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const a = new TonAdapter('', fetchImpl);
    const q = await a.quote({ inputToken: 'ton', outputToken: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', amount: '1000000000', slippageBps: 100, owner: 'x' });
    expect(Number(q.outAmount) / 1e6).toBeCloseTo(5, 1);
  });

  it('swap is gated until TON trading is verified', async () => {
    const a = new TonAdapter();
    await expect(a.swap()).rejects.toThrow(/rolling out/);
  });

  it('builds tonviewer explorer links', () => {
    const a = new TonAdapter();
    expect(a.explorerTx('HASH')).toBe('https://tonviewer.com/transaction/HASH');
    expect(a.explorerAddress('ADDR')).toBe('https://tonviewer.com/ADDR');
  });
});
