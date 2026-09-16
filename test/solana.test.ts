import { describe, it, expect, vi } from 'vitest';
import { SolanaAdapter, buildSwapBody, parseJupiterQuote, signTransaction, decodeSecret, friendlySolanaError } from '../src/chains/solana.js';
import type { SwapRequest } from '../src/chains/types.js';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function req(over: Partial<SwapRequest> = {}): SwapRequest {
  return { inputToken: SOL, outputToken: USDC, amount: '100000000', slippageBps: 100, owner: 'OWNER', ...over };
}

/** A fake Solana JSON-RPC over fetch, keyed by method. */
function rpcFetch(results: Record<string, unknown>): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const result = results[body.method];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
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
    expect(a.isValidSecret('nope')).toBe(false);
  });
});

describe('Jupiter quote parsing', () => {
  it('maps a Jupiter quote into a chain-neutral SwapQuote', () => {
    const json = { inAmount: '100000000', outAmount: '10100042', otherAmountThreshold: '9999042', priceImpactPct: '0.001', routePlan: [{ swapInfo: { label: 'HumidiFi' } }, { swapInfo: { label: 'Orca' } }] };
    const q = parseJupiterQuote(json, req());
    expect(q.outAmount).toBe('10100042');
    expect(q.minOut).toBe('9999042');
    expect(q.route).toContain('HumidiFi');
    expect(q.raw).toBe(json);
  });
});

describe('friendlySolanaError', () => {
  it('maps slippage errors to a raise-slippage hint', () => {
    expect(friendlySolanaError('custom program error: 0x1771')).toMatch(/slippage/i);
    expect(friendlySolanaError('Program log: Error: SlippageToleranceExceeded')).toMatch(/slippage/i);
  });
  it('maps a generic simulation failure to a slippage hint', () => {
    expect(friendlySolanaError('Transaction simulation failed')).toMatch(/slippage/i);
  });
  it('maps blockhash errors to a retry hint', () => {
    expect(friendlySolanaError('Blockhash not found')).toMatch(/try again/i);
  });
});

describe('buildSwapBody', () => {
  it('sets safe defaults', () => {
    const body = buildSwapBody({ outAmount: '1' }, 'OWNER');
    expect(body.wrapAndUnwrapSol).toBe(true);
    expect(body.dynamicComputeUnitLimit).toBe(true);
    expect(body.prioritizationFeeLamports).toBe('auto');
    expect(body.feeAccount).toBeUndefined();
  });
});

describe('quote() over Jupiter (mocked fetch)', () => {
  it('hits the lite-api quote endpoint and parses the result', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (u: string) => {
      calls.push(u);
      return new Response(JSON.stringify({ inAmount: '100000000', outAmount: '10100042', otherAmountThreshold: '9999042', routePlan: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const a = new SolanaAdapter('https://rpc', fetchImpl);
    const q = await a.quote(req());
    expect(calls[0]).toContain('lite-api.jup.ag/swap/v1/quote');
    expect(calls[0]).toContain(`inputMint=${SOL}`);
    expect(q.outAmount).toBe('10100042');
  });

  it('throws when there is no route', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'No routes found' }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const a = new SolanaAdapter('https://rpc', fetchImpl);
    await expect(a.quote(req())).rejects.toThrow(/No route/);
  });
});

describe('balances via JSON-RPC (mocked fetch)', () => {
  it('reads native lamports as bigint', async () => {
    const a = new SolanaAdapter('https://rpc', rpcFetch({ getBalance: { value: 1_500_000_000 } }));
    expect(await a.getNativeBalance('ADDR')).toBe(1_500_000_000n);
  });

  it('sums SPL token accounts', async () => {
    const a = new SolanaAdapter('https://rpc', rpcFetch({
      getTokenAccountsByOwner: { value: [
        { account: { data: { parsed: { info: { tokenAmount: { amount: '250' } } } } } },
        { account: { data: { parsed: { info: { tokenAmount: { amount: '750' } } } } } },
      ] },
    }));
    expect(await a.getTokenBalance('ADDR', USDC)).toBe(1000n);
  });

  it('reads mint decimals for token meta', async () => {
    const a = new SolanaAdapter('https://rpc', rpcFetch({ getAccountInfo: { value: { data: { parsed: { info: { decimals: 6, mintAuthority: null, freezeAuthority: null } } } } } }));
    const meta = await a.getTokenMeta(USDC);
    expect(meta.decimals).toBe(6);
  });

  it('reports real mint safety (renounced / freeze revoked)', async () => {
    const renounced = new SolanaAdapter('https://rpc', rpcFetch({ getAccountInfo: { value: { data: { parsed: { info: { decimals: 6, mintAuthority: null, freezeAuthority: null } } } } } }));
    expect(await renounced.getMintInfo(USDC)).toEqual({ decimals: 6, mintRenounced: true, freezeRevoked: true });
    const controlled = new SolanaAdapter('https://rpc', rpcFetch({ getAccountInfo: { value: { data: { parsed: { info: { decimals: 6, mintAuthority: 'SomeAuth', freezeAuthority: 'SomeAuth' } } } } } }));
    expect(await controlled.getMintInfo(USDC)).toEqual({ decimals: 6, mintRenounced: false, freezeRevoked: false });
  });

  it('builds solscan explorer links', () => {
    const a = new SolanaAdapter();
    expect(a.explorerTx('SIG')).toBe('https://solscan.io/tx/SIG');
    expect(a.explorerAddress('ADDR')).toBe('https://solscan.io/account/ADDR');
  });
});

describe('signTransaction cross-validated against @solana/web3.js', () => {
  it('produces the exact signature web3.js would for a v0 transaction', async () => {
    const web3 = await import('@solana/web3.js');
    const { Keypair, VersionedTransaction, TransactionMessage, SystemProgram, PublicKey } = web3;
    const payer = Keypair.generate();
    const to = Keypair.generate();
    const blockhash = '11111111111111111111111111111111'; // 32-byte base58 placeholder
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to.publicKey, lamports: 1000 })],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    const unsignedB64 = Buffer.from(tx.serialize()).toString('base64');

    // Our pure signer.
    const mineB64 = signTransaction(unsignedB64, payer.secretKey);

    // web3.js reference.
    tx.sign([payer]);
    const refB64 = Buffer.from(tx.serialize()).toString('base64');

    expect(mineB64).toBe(refB64);
    // And it verifies against the message.
    const nacl = (await import('tweetnacl')).default;
    const mine = Uint8Array.from(Buffer.from(mineB64, 'base64'));
    const sig = mine.subarray(1, 65);
    const message = mine.subarray(1 + 64);
    expect(nacl.sign.detached.verify(message, sig, payer.publicKey.toBytes())).toBe(true);
    void PublicKey;
  });

  it('decodeSecret accepts 64-byte and 32-byte seeds', async () => {
    const nacl = (await import('tweetnacl')).default;
    const kp = nacl.sign.keyPair();
    expect(decodeSecret((await new SolanaAdapter().createWallet()).secretKey).length).toBe(64);
    const seed = kp.secretKey.subarray(0, 32);
    const bs58 = (await import('bs58')).default;
    expect(decodeSecret(bs58.encode(seed)).length).toBe(64);
  });
});
