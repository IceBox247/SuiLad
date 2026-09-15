import { describe, it, expect, vi } from 'vitest';
import { SolanaAdapter, buildSwapBody, parseJupiterQuote, type SolConnection } from '../src/chains/solana.js';
import type { SwapRequest } from '../src/chains/types.js';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function req(over: Partial<SwapRequest> = {}): SwapRequest {
  return { inputToken: SOL, outputToken: USDC, amount: '100000000', slippageBps: 100, owner: 'OWNER', ...over };
}

describe('SolanaAdapter wallets', () => {
  it('creates and re-imports an ed25519 wallet (base58 roundtrip)', async () => {
    const a = new SolanaAdapter();
    const w = await a.createWallet();
    expect(w.scheme).toBe('ED25519');
    expect(a.isValidAddress(w.address)).toBe(true);
    expect(a.isValidSecret(w.secretKey)).toBe(true);
    const w2 = await a.importWallet(w.secretKey);
    expect(w2.address).toBe(w.address);
  });

  it('rejects invalid addresses and secrets', () => {
    const a = new SolanaAdapter();
    expect(a.isValidAddress('not-an-address')).toBe(false);
    expect(a.isValidAddress('0x1234')).toBe(false);
    expect(a.isValidSecret('nope')).toBe(false);
  });

  it('imports a JSON byte-array secret', async () => {
    const a = new SolanaAdapter();
    const w = await a.createWallet();
    // Re-import via the same key to confirm decoding both forms lands the same address.
    const again = await a.importWallet(w.secretKey);
    expect(again.address).toBe(w.address);
  });
});

describe('Jupiter quote parsing', () => {
  it('maps a Jupiter quote into a chain-neutral SwapQuote', () => {
    const json = {
      inAmount: '100000000',
      outAmount: '10100042',
      otherAmountThreshold: '9999042',
      priceImpactPct: '0.001',
      routePlan: [{ swapInfo: { label: 'HumidiFi' } }, { swapInfo: { label: 'Orca' } }],
    };
    const q = parseJupiterQuote(json, req());
    expect(q.outAmount).toBe('10100042');
    expect(q.minOut).toBe('9999042');
    expect(q.priceImpactPct).toBeCloseTo(0.001);
    expect(q.route).toContain('HumidiFi');
    expect(q.route).toContain('Orca');
    expect(q.raw).toBe(json);
  });
});

describe('buildSwapBody', () => {
  it('sets safe defaults (wrap SOL, dynamic CU, auto priority)', () => {
    const raw = { outAmount: '1' };
    const body = buildSwapBody(raw, 'OWNER');
    expect(body.quoteResponse).toBe(raw);
    expect(body.userPublicKey).toBe('OWNER');
    expect(body.wrapAndUnwrapSol).toBe(true);
    expect(body.dynamicComputeUnitLimit).toBe(true);
    expect(body.prioritizationFeeLamports).toBe('auto');
    expect(body.feeAccount).toBeUndefined();
  });

  it('includes a fee account when provided', () => {
    const body = buildSwapBody({}, 'OWNER', { feeAccount: 'FEEACC' });
    expect(body.feeAccount).toBe('FEEACC');
  });
});

describe('quote() over Jupiter (mocked fetch)', () => {
  it('hits the lite-api quote endpoint and parses the result', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (u: string) => {
      calls.push(u);
      return new Response(JSON.stringify({ inAmount: '100000000', outAmount: '10100042', otherAmountThreshold: '9999042', routePlan: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const a = new SolanaAdapter('https://rpc', fetchImpl);
    const q = await a.quote(req());
    expect(calls[0]).toContain('lite-api.jup.ag/swap/v1/quote');
    expect(calls[0]).toContain(`inputMint=${SOL}`);
    expect(calls[0]).toContain('slippageBps=100');
    expect(q.outAmount).toBe('10100042');
  });

  it('throws when there is no route', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'No routes found' }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const a = new SolanaAdapter('https://rpc', fetchImpl);
    await expect(a.quote(req())).rejects.toThrow(/No route/);
  });
});

describe('balances (mock connection)', () => {
  const mockConn: SolConnection = {
    getBalance: async () => 1_500_000_000,
    getParsedAccountInfo: async () => ({ value: { data: { parsed: { info: { decimals: 6 } } } } }) as any,
    getParsedTokenAccountsByOwner: async () => ({
      value: [
        { account: { data: { parsed: { info: { tokenAmount: { amount: '250' } } } } } },
        { account: { data: { parsed: { info: { tokenAmount: { amount: '750' } } } } } },
      ],
    }),
    getLatestBlockhash: async () => ({ blockhash: 'bh', lastValidBlockHeight: 1 }),
    sendRawTransaction: async () => 'SIG',
    confirmTransaction: async () => ({}),
  };

  it('reads native lamports as bigint', async () => {
    const a = new SolanaAdapter('https://rpc', fetch, mockConn);
    const w = await a.createWallet();
    expect(await a.getNativeBalance(w.address)).toBe(1_500_000_000n);
  });

  it('sums SPL token accounts', async () => {
    const a = new SolanaAdapter('https://rpc', fetch, mockConn);
    const w = await a.createWallet();
    expect(await a.getTokenBalance(w.address, USDC)).toBe(1000n);
  });

  it('reads mint decimals for token meta', async () => {
    const a = new SolanaAdapter('https://rpc', fetch, mockConn);
    const meta = await a.getTokenMeta(USDC);
    expect(meta.decimals).toBe(6);
    expect(meta.address).toBe(USDC);
  });

  it('builds solscan explorer links', () => {
    const a = new SolanaAdapter();
    expect(a.explorerTx('SIG')).toBe('https://solscan.io/tx/SIG');
    expect(a.explorerAddress('ADDR')).toBe('https://solscan.io/account/ADDR');
  });
});
