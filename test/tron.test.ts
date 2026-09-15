import { describe, it, expect, vi } from 'vitest';
import { TronAdapter } from '../src/chains/tron.js';

describe('TronAdapter wallets', () => {
  it('creates and re-imports a secp256k1 wallet with a T-address', async () => {
    const a = new TronAdapter();
    const w = await a.createWallet();
    expect(w.scheme).toBe('secp256k1');
    expect(w.address.startsWith('T')).toBe(true);
    expect(w.address.length).toBe(34);
    expect(a.isValidAddress(w.address)).toBe(true);
    expect(a.isValidSecret(w.secretKey)).toBe(true);
    const w2 = await a.importWallet(w.secretKey);
    expect(w2.address).toBe(w.address);
  });

  it('validates real Tron addresses (checksum) and rejects junk', () => {
    const a = new TronAdapter();
    expect(a.isValidAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(true); // USDT contract
    expect(a.isValidAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u')).toBe(false); // bad checksum
    expect(a.isValidAddress('not-tron')).toBe(false);
    expect(a.isValidAddress('0x1234')).toBe(false);
  });
});

describe('TronAdapter reads (mocked fetch)', () => {
  it('reads native balance from TronGrid', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ balance: 1_086_935_316_091 }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const a = new TronAdapter('', fetchImpl);
    expect(await a.getNativeBalance('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(1_086_935_316_091n);
  });

  it('swap is gated until Tron trading is verified', async () => {
    const a = new TronAdapter();
    await expect(a.swap()).rejects.toThrow(/rolling out/);
  });

  it('builds tronscan explorer links', () => {
    const a = new TronAdapter();
    expect(a.explorerTx('HASH')).toBe('https://tronscan.org/#/transaction/HASH');
    expect(a.explorerAddress('ADDR')).toBe('https://tronscan.org/#/address/ADDR');
  });
});
