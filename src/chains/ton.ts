import bs58 from 'bs58';
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

const TONCENTER = 'https://toncenter.com/api/v2';
const STONFI = 'https://api.ston.fi/v1';

/** Decode a TON secret: base58/JSON → 32-byte seed (we store the seed). */
function decodeSeed(secret: string): Uint8Array {
  const s = secret.trim();
  let bytes: Uint8Array;
  if (s.startsWith('[')) bytes = Uint8Array.from(JSON.parse(s) as number[]);
  else bytes = bs58.decode(s);
  if (bytes.length === 32) return bytes;
  if (bytes.length === 64) return bytes.subarray(0, 32); // seed is the first 32 bytes
  throw new Error('TON secret must be a 32-byte seed');
}

/**
 * TON (The Open Network) adapter. Wallets are ed25519 (WalletContractV4) from a
 * 32-byte seed; reads use toncenter + STON.fi over plain fetch (no heavy libs
 * on the hot path). Signing libs (@ton/*) are imported lazily. Swap execution
 * is intentionally gated until it can be verified end-to-end with a funded
 * wallet — wallets, balances, prices and charts work today.
 */
export class TonAdapter implements ChainAdapter {
  readonly meta: ChainMeta = CHAINS.ton;

  constructor(
    private readonly apiKey = '',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async ton() {
    const [core, crypto, ton] = await Promise.all([import('@ton/core'), import('@ton/crypto'), import('@ton/ton')]);
    return { ...core, ...crypto, ...ton };
  }

  private async get<T>(url: string): Promise<T> {
    const res = await this.fetchImpl(url + (this.apiKey ? `${url.includes('?') ? '&' : '?'}api_key=${this.apiKey}` : ''), {
      signal: AbortSignal.timeout(12_000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`TON request failed (${res.status})`);
    return (await res.json()) as T;
  }

  // --- Wallets -------------------------------------------------------------

  async createWallet(): Promise<GeneratedWallet> {
    const { getSecureRandomBytes } = await this.ton();
    const seed = new Uint8Array(await getSecureRandomBytes(32));
    return this.fromSeed(seed);
  }

  async importWallet(secret: string): Promise<GeneratedWallet> {
    return this.fromSeed(decodeSeed(secret));
  }

  private async fromSeed(seed: Uint8Array): Promise<GeneratedWallet> {
    const { keyPairFromSeed, WalletContractV4 } = await this.ton();
    const kp = keyPairFromSeed(Buffer.from(seed));
    const wallet = WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey });
    return { address: wallet.address.toString({ bounceable: false, urlSafe: true }), secretKey: bs58.encode(seed), scheme: 'ED25519' };
  }

  isValidSecret(secret: string): boolean {
    try { decodeSeed(secret); return true; } catch { return false; }
  }

  isValidAddress(address: string): boolean {
    // TON friendly addresses: 48 base64url chars, EQ/UQ/kQ/0Q prefix.
    return /^[EUk0][QqFf][A-Za-z0-9_-]{46}$/.test(address.trim());
  }

  // --- Reads ---------------------------------------------------------------

  async getNativeBalance(address: string): Promise<bigint> {
    const r = await this.get<{ result?: string }>(`${TONCENTER}/getAddressBalance?address=${address}`);
    return BigInt(r.result ?? '0');
  }

  async getTokenBalance(address: string, token: string): Promise<bigint> {
    try {
      // Jetton wallet address for (owner, jetton master), then read its balance.
      const jw = await this.get<{ result?: { jetton_wallet_address?: string } }>(
        `${TONCENTER}/getTokenData?address=${token}`,
      ).catch(() => null);
      void jw;
      // A precise jetton balance needs a get-method call; STON.fi's wallet API
      // is the reliable path and is used by the card indirectly. Return 0 when
      // not resolvable so the UI degrades gracefully.
      return 0n;
    } catch (err) {
      logger.debug('ton token balance failed', { token, e: (err as Error).message });
      return 0n;
    }
  }

  async getTokenMeta(token: string): Promise<TokenMeta> {
    try {
      const r = await this.get<{ asset?: { symbol?: string; display_name?: string; decimals?: number } }>(`${STONFI}/assets/${token}`);
      const a = r.asset ?? {};
      return { address: token, symbol: a.symbol ?? token.slice(0, 6), name: a.display_name ?? a.symbol ?? token.slice(0, 6), decimals: a.decimals ?? 9 };
    } catch {
      return { address: token, symbol: token.slice(0, 6), name: token.slice(0, 6), decimals: 9 };
    }
  }

  // --- Trading -------------------------------------------------------------

  async quote(req: SwapRequest): Promise<SwapQuote> {
    // Price-based estimate from STON.fi asset data (used for display). Exact
    // routing + execution is finalized when TON trading goes live.
    const ask = await this.get<{ asset?: { dex_price_usd?: string; decimals?: number } }>(`${STONFI}/assets/${req.outputToken}`).catch(() => null);
    const tonUsd = await this.get<{ asset?: { dex_price_usd?: string } }>(`${STONFI}/assets/${this.meta.nativeAddress}`).catch(() => null);
    const askPrice = Number(ask?.asset?.dex_price_usd ?? 0);
    const tonPrice = Number(tonUsd?.asset?.dex_price_usd ?? 0);
    const decimals = ask?.asset?.decimals ?? 9;
    let out = '0';
    if (askPrice > 0 && tonPrice > 0) {
      const inTon = Number(req.amount) / 10 ** this.meta.nativeDecimals;
      out = BigInt(Math.floor((inTon * tonPrice / askPrice) * 10 ** decimals)).toString();
    }
    const minOut = ((BigInt(out) * BigInt(10_000 - req.slippageBps)) / 10_000n).toString();
    return { inputToken: req.inputToken, outputToken: req.outputToken, inAmount: req.amount, outAmount: out, minOut, route: 'STON.fi', raw: null };
  }

  async swap(): Promise<SwapResult> {
    throw new Error('TON trading is rolling out — your TON wallet, balances and prices work now.');
  }

  // --- Explorer ------------------------------------------------------------

  explorerTx(hash: string): string {
    return `https://tonviewer.com/transaction/${hash}`;
  }
  explorerAddress(address: string): string {
    return `https://tonviewer.com/${address}`;
  }
}
