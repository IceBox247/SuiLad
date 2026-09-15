import { describe, it, expect, vi } from 'vitest';
import { EvmAdapter, parseLifiQuote } from '../src/chains/evm.js';
import type { SwapRequest } from '../src/chains/types.js';

const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';

function req(over: Partial<SwapRequest> = {}): SwapRequest {
  return { inputToken: NATIVE, outputToken: USDT_BSC, amount: '1000000000000000000', slippageBps: 100, owner: '0x0000000000000000000000000000000000000001', ...over };
}

describe('EvmAdapter wallets', () => {
  it('creates and re-imports a secp256k1 wallet', async () => {
    const a = new EvmAdapter('bsc', 'https://rpc', 'https://bscscan.com');
    const w = await a.createWallet();
    expect(w.scheme).toBe('secp256k1');
    expect(a.isValidAddress(w.address)).toBe(true);
    expect(a.isValidSecret(w.secretKey)).toBe(true);
    const w2 = await a.importWallet(w.secretKey);
    expect(w2.address).toBe(w.address);
  });

  it('accepts a 0x-less hex key and rejects junk', async () => {
    const a = new EvmAdapter('ethereum', 'https://rpc', 'https://etherscan.io');
    const w = await a.createWallet();
    const bare = w.secretKey.slice(2);
    expect(a.isValidSecret(bare)).toBe(true);
    expect((await a.importWallet(bare)).address).toBe(w.address);
    expect(a.isValidSecret('0x1234')).toBe(false);
    expect(a.isValidAddress('0xnothex')).toBe(false);
  });

  it('rejects a non-EVM chain', () => {
    expect(() => new EvmAdapter('sui' as any, 'https://rpc', 'x')).toThrow(/not an EVM chain/);
  });

  it('builds chain-correct explorer links', () => {
    const a = new EvmAdapter('base', 'https://rpc', 'https://basescan.org');
    expect(a.explorerTx('0xabc')).toBe('https://basescan.org/tx/0xabc');
    expect(a.explorerAddress('0xdef')).toBe('https://basescan.org/address/0xdef');
  });
});

describe('LI.FI quote parsing', () => {
  it('maps a LI.FI quote into a chain-neutral SwapQuote', () => {
    const json = {
      tool: 'bitget',
      estimate: { fromAmount: '1000000000000000000', toAmount: '720000000', toAmountMin: '712000000', approvalAddress: '0xROUTER' },
      transactionRequest: { to: '0xROUTER', data: '0xdead', value: '0xde0b6b3a7640000' },
    };
    const q = parseLifiQuote(json, req());
    expect(q.outAmount).toBe('720000000');
    expect(q.minOut).toBe('712000000');
    expect(q.route).toContain('bitget');
    expect(q.raw).toBe(json);
  });
});

describe('quote() over LI.FI (mocked fetch)', () => {
  it('requests a same-chain route and parses it', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (u: string) => {
      calls.push(u);
      return new Response(JSON.stringify({
        tool: 'paraswap',
        estimate: { toAmount: '720000000', toAmountMin: '712000000' },
        transactionRequest: { to: '0xROUTER', data: '0x', value: '0x0' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const a = new EvmAdapter('bsc', 'https://rpc', 'https://bscscan.com', fetchImpl);
    const q = await a.quote(req());
    expect(calls[0]).toContain('li.quest/v1/quote');
    expect(calls[0]).toContain('fromChain=56');
    expect(calls[0]).toContain('toChain=56');
    // Native sentinel is normalized to the zero address for LI.FI.
    expect(calls[0]).toContain('fromToken=0x0000000000000000000000000000000000000000');
    expect(q.outAmount).toBe('720000000');
  });

  it('throws when LI.FI has no route', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'no route' }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const a = new EvmAdapter('polygon', 'https://rpc', 'https://polygonscan.com', fetchImpl);
    await expect(a.quote(req())).rejects.toThrow(/No route/);
  });
});
