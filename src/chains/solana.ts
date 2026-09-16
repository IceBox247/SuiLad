import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { logger } from '../logger.js';
import { CHAINS } from './meta.js';
import type {
  ChainAdapter,
  ChainMeta,
  GeneratedWallet,
  SwapQuote,
  SwapRequest,
  SwapResult,
  TokenMeta,
} from './types.js';

/** Jupiter's public (keyless) endpoint. Swap quote + build. */
const JUP = 'https://lite-api.jup.ag';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Builds the POST body for Jupiter's /swap endpoint. Pure + exported so the
 * request shape is unit-tested without touching the network or signing.
 */
export function buildSwapBody(
  quoteResponse: unknown,
  userPublicKey: string,
  opts: { feeAccount?: string } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: 'auto',
  };
  if (opts.feeAccount) body.feeAccount = opts.feeAccount;
  return body;
}

/** Normalizes a Jupiter quote payload into our chain-neutral SwapQuote. */
export function parseJupiterQuote(json: any, req: SwapRequest): SwapQuote {
  const route = Array.isArray(json?.routePlan)
    ? json.routePlan.map((r: any) => r?.swapInfo?.label).filter(Boolean).join(' → ') || 'Jupiter'
    : 'Jupiter';
  return {
    inputToken: req.inputToken,
    outputToken: req.outputToken,
    inAmount: String(json?.inAmount ?? req.amount),
    outAmount: String(json?.outAmount ?? '0'),
    minOut: String(json?.otherAmountThreshold ?? json?.outAmount ?? '0'),
    priceImpactPct: json?.priceImpactPct != null ? Number(json.priceImpactPct) : undefined,
    route: `Jupiter (${route})`,
    raw: json,
  };
}

/** Decode a Solana secret: base58 (64-byte) or a JSON byte array → 64 bytes. */
export function decodeSecret(secret: string): Uint8Array {
  const s = secret.trim();
  let bytes: Uint8Array;
  if (s.startsWith('[')) {
    const arr = JSON.parse(s) as number[];
    bytes = Uint8Array.from(arr);
  } else {
    bytes = bs58.decode(s);
  }
  if (bytes.length === 64) return bytes;
  if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey; // seed → full key
  throw new Error('Solana secret must be 32 (seed) or 64 bytes');
}

/** compact-u16 (shortvec) decode used by Solana's wire format. */
function decodeLen(buf: Uint8Array, offset: number): { value: number; size: number } {
  let value = 0;
  let size = 0;
  for (;;) {
    const b = buf[offset + size]!;
    value |= (b & 0x7f) << (size * 7);
    size++;
    if ((b & 0x80) === 0) break;
  }
  return { value, size };
}

/**
 * Sign a serialized (unsigned) Solana transaction — legacy or v0 — with an
 * ed25519 key, placing the signature at the signer's account index. Returns the
 * fully-signed transaction, base64. Pure/exported so it can be cross-validated
 * against @solana/web3.js in tests.
 */
export function signTransaction(txBase64: string, secretKey: Uint8Array): string {
  const buf = Uint8Array.from(Buffer.from(txBase64, 'base64'));
  const sigCount = decodeLen(buf, 0);
  const sigStart = sigCount.size;
  const messageStart = sigStart + 64 * sigCount.value;
  const message = buf.subarray(messageStart);

  // Parse the message header enough to locate the signer account list.
  let o = 0;
  if ((message[0]! & 0x80) !== 0) o = 1; // versioned: skip the version prefix byte
  const numRequiredSignatures = message[o]!;
  o += 3; // numRequiredSignatures + numReadonlySigned + numReadonlyUnsigned
  const acctLen = decodeLen(message, o);
  o += acctLen.size;

  const pubkey = secretKey.subarray(32, 64); // ed25519 pubkey = last 32 bytes
  let signerIndex = -1;
  for (let i = 0; i < numRequiredSignatures; i++) {
    const key = message.subarray(o + i * 32, o + i * 32 + 32);
    if (equal(key, pubkey)) { signerIndex = i; break; }
  }
  if (signerIndex < 0) throw new Error('Signer is not a required signer of this transaction');

  const signature = nacl.sign.detached(message, secretKey);
  const out = Uint8Array.from(buf);
  out.set(signature, sigStart + 64 * signerIndex);
  return Buffer.from(out).toString('base64');
}

/** Turn a raw Solana/Jupiter error into an actionable message for the user. */
export function friendlySolanaError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('0x1771') || s.includes('slippage') || s.includes('slippagetoleranceexceeded')) {
    return 'Swap failed — price moved past your slippage. Raise slippage in ⚙️ Settings (try 5–15% for volatile tokens) and retry.';
  }
  if (s.includes('insufficient') || s.includes('0x1') && s.includes('lamports')) {
    return 'Swap failed — not enough SOL to cover the trade + network fee. Top up a little SOL and retry.';
  }
  if (s.includes('blockhash') || s.includes('block height exceeded')) {
    return 'Network was busy and the transaction expired. Please try again.';
  }
  if (s.includes('simulation failed')) {
    return `Swap failed on-chain (simulation). This is usually slippage too low for a volatile token — raise it in ⚙️ Settings and retry. (${raw.slice(0, 160)})`;
  }
  return `Swap failed: ${raw.slice(0, 200)}`;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Solana chain adapter. Deliberately free of @solana/web3.js (whose
 * rpc-websockets dependency breaks Vercel's CJS bundler): keys/signing use
 * tweetnacl + bs58, and all RPC is plain JSON-RPC over fetch. Trading routes
 * through Jupiter's aggregator (best price across every Solana DEX).
 */
export class SolanaAdapter implements ChainAdapter {
  readonly meta: ChainMeta = CHAINS.solana;

  constructor(
    private readonly rpcUrl = 'https://api.mainnet-beta.solana.com',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await this.fetchImpl(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`Solana RPC ${method} failed (${res.status})`);
    const json = (await res.json()) as { result?: T; error?: { message?: string; data?: { logs?: string[] } } };
    if (json.error) {
      // Include preflight logs so callers can tell WHY a swap failed (slippage,
      // insufficient funds, …) instead of a generic "simulation failed".
      const logs = json.error.data?.logs?.join(' | ') ?? '';
      throw new Error(`Solana RPC ${method}: ${json.error.message}${logs ? ` — ${logs.slice(0, 400)}` : ''}`);
    }
    return json.result as T;
  }

  // --- Wallets -------------------------------------------------------------

  async createWallet(): Promise<GeneratedWallet> {
    const kp = nacl.sign.keyPair();
    return { address: bs58.encode(kp.publicKey), secretKey: bs58.encode(kp.secretKey), scheme: 'ED25519' };
  }

  async importWallet(secret: string): Promise<GeneratedWallet> {
    const sk = decodeSecret(secret);
    return { address: bs58.encode(sk.subarray(32, 64)), secretKey: bs58.encode(sk), scheme: 'ED25519' };
  }

  isValidSecret(secret: string): boolean {
    try { decodeSecret(secret); return true; } catch { return false; }
  }

  isValidAddress(address: string): boolean {
    try { return bs58.decode(address.trim()).length === 32; } catch { return false; }
  }

  // --- Reads ---------------------------------------------------------------

  async getNativeBalance(address: string): Promise<bigint> {
    const r = await this.rpc<{ value: number }>('getBalance', [address]);
    return BigInt(Math.trunc(r.value));
  }

  async getTokenBalance(address: string, token: string): Promise<bigint> {
    try {
      const r = await this.rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>(
        'getTokenAccountsByOwner',
        [address, { mint: token }, { encoding: 'jsonParsed' }],
      );
      let total = 0n;
      for (const acc of r.value) total += BigInt(acc.account.data.parsed.info.tokenAmount.amount);
      return total;
    } catch (err) {
      logger.debug('sol token balance failed', { token, e: (err as Error).message });
      return 0n;
    }
  }

  async getTokenMeta(token: string): Promise<TokenMeta> {
    const short = `${token.slice(0, 4)}…${token.slice(-4)}`;
    return { address: token, symbol: short, name: short, decimals: (await this.getMintInfo(token)).decimals };
  }

  /**
   * On-chain SPL mint safety info: decimals, whether minting is renounced
   * (mint authority is null) and whether freezing is revoked (freeze authority
   * is null). These are real, meaningful checks on Solana.
   */
  async getMintInfo(token: string): Promise<{ decimals: number; mintRenounced: boolean; freezeRevoked: boolean }> {
    try {
      const r = await this.rpc<{ value: { data: { parsed: { info: { decimals: number; mintAuthority: string | null; freezeAuthority: string | null } } } } }>(
        'getAccountInfo',
        [token, { encoding: 'jsonParsed' }],
      );
      const info = r?.value?.data?.parsed?.info;
      return {
        decimals: Number.isInteger(info?.decimals) ? info!.decimals : 9,
        mintRenounced: info ? info.mintAuthority == null : false,
        freezeRevoked: info ? info.freezeAuthority == null : false,
      };
    } catch (err) {
      logger.debug('sol mint info failed', { token, e: (err as Error).message });
      return { decimals: 9, mintRenounced: false, freezeRevoked: false };
    }
  }

  // --- Trading -------------------------------------------------------------

  async quote(req: SwapRequest): Promise<SwapQuote> {
    const url =
      `${JUP}/swap/v1/quote?inputMint=${req.inputToken}&outputMint=${req.outputToken}` +
      `&amount=${req.amount}&slippageBps=${req.slippageBps}&swapMode=ExactIn`;
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Jupiter quote failed (${res.status})`);
    const json: any = await res.json();
    if (!json || json.error || !json.outAmount) throw new Error(`No route: ${json?.error ?? 'unknown'}`);
    return parseJupiterQuote(json, req);
  }

  async swap(secretKey: string, quote: SwapQuote, req: SwapRequest): Promise<SwapResult> {
    const sk = decodeSecret(secretKey);
    let lastErr: Error | undefined;
    // Retry once: each attempt fetches a FRESH Jupiter transaction (new
    // blockhash), which clears transient "simulation failed" flakes from a
    // stale blockhash or a busy RPC. A genuine slippage/funds error persists
    // and is surfaced with an actionable message below.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.fetchImpl(`${JUP}/swap/v1/swap`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildSwapBody(quote.raw, req.owner)),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Jupiter swap build failed (${res.status})`);
        const { swapTransaction } = (await res.json()) as { swapTransaction?: string };
        if (!swapTransaction) throw new Error('Jupiter returned no transaction');
        const signed = signTransaction(swapTransaction, sk);
        const sig = await this.rpc<string>('sendTransaction', [signed, { encoding: 'base64', skipPreflight: false, maxRetries: 3 }]);
        await this.confirm(sig).catch(() => {});
        return { digest: sig, outAmount: quote.outAmount };
      } catch (err) {
        lastErr = err as Error;
      }
    }
    throw new Error(friendlySolanaError(lastErr?.message ?? 'swap failed'));
  }

  /**
   * Sign and broadcast a pre-built base64 Solana transaction (e.g. a LI.FI
   * bridge transactionRequest). The user is the sole required signer; any
   * pre-applied signatures from the route builder are preserved.
   */
  async sendSerialized(txBase64: string, secret: string): Promise<string> {
    const sk = decodeSecret(secret);
    const signed = signTransaction(txBase64, sk);
    const sig = await this.rpc<string>('sendTransaction', [signed, { encoding: 'base64', skipPreflight: false, maxRetries: 3 }]);
    await this.confirm(sig).catch(() => {});
    return sig;
  }

  /** Poll signature status until confirmed (best-effort, bounded). */
  private async confirm(sig: string, timeoutMs = 30_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const r = await this.rpc<{ value: ({ confirmationStatus?: string; err?: unknown } | null)[] }>(
        'getSignatureStatuses',
        [[sig], { searchTransactionHistory: false }],
      ).catch(() => null);
      const st = r?.value?.[0];
      if (st?.err) throw new Error('Transaction failed on-chain');
      if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return;
      await new Promise((r2) => setTimeout(r2, 1500));
    }
  }

  // --- Explorer ------------------------------------------------------------

  explorerTx(hash: string): string {
    return `https://solscan.io/tx/${hash}`;
  }
  explorerAddress(address: string): string {
    return `https://solscan.io/account/${address}`;
  }
}

// Referenced to keep the token-program constant meaningful for future SPL work.
void TOKEN_PROGRAM;
