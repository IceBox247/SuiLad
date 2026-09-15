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

/** Jupiter's public (keyless) endpoint. Swap quote + build. */
const JUP = 'https://lite-api.jup.ag';

/** Minimal slice of @solana/web3.js Connection we depend on (keeps it mockable). */
export interface SolConnection {
  getBalance(pubkey: unknown): Promise<number>;
  getParsedAccountInfo(pubkey: unknown): Promise<{ value: unknown }>;
  getParsedTokenAccountsByOwner(
    owner: unknown,
    filter: { mint: unknown },
  ): Promise<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  sendRawTransaction(raw: Uint8Array, opts?: unknown): Promise<string>;
  confirmTransaction(strategy: unknown, commitment?: string): Promise<unknown>;
}

/**
 * Builds the POST body for Jupiter's /swap endpoint. Pure + exported so the
 * request shape is unit-tested without touching the network or web3 signing.
 */
export function buildSwapBody(
  quoteResponse: unknown,
  userPublicKey: string,
  opts: { feeBps?: number; feeAccount?: string } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    quoteResponse,
    userPublicKey,
    // Let Jupiter wrap/unwrap SOL so native<->SPL swaps "just work".
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    // Priority fee handled automatically (MEV-aware inclusion).
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

/**
 * Solana chain adapter. Wallets are ed25519 keypairs (base58 secret). Trading
 * is routed through Jupiter's aggregator (best price across all Solana DEXs);
 * @solana/web3.js is imported lazily so a Sui-only invocation never pays its
 * cold-start cost.
 */
export class SolanaAdapter implements ChainAdapter {
  readonly meta: ChainMeta = CHAINS.solana;
  private conn?: SolConnection;

  constructor(
    private readonly rpcUrl = 'https://api.mainnet-beta.solana.com',
    private readonly fetchImpl: typeof fetch = fetch,
    /** Optional injected connection (tests). */
    conn?: SolConnection,
  ) {
    this.conn = conn;
  }

  private async web3() {
    return import('@solana/web3.js');
  }

  private async connection(): Promise<SolConnection> {
    if (this.conn) return this.conn;
    const { Connection } = await this.web3();
    this.conn = new Connection(this.rpcUrl, 'confirmed') as unknown as SolConnection;
    return this.conn;
  }

  // --- Wallets -------------------------------------------------------------

  async createWallet(): Promise<GeneratedWallet> {
    const { Keypair } = await this.web3();
    return describe(Keypair.generate());
  }

  async importWallet(secret: string): Promise<GeneratedWallet> {
    const { Keypair } = await this.web3();
    return describe(Keypair.fromSecretKey(decodeSecret(secret)));
  }

  isValidSecret(secret: string): boolean {
    try {
      decodeSecret(secret);
      return true;
    } catch {
      return false;
    }
  }

  isValidAddress(address: string): boolean {
    try {
      const bytes = bs58.decode(address.trim());
      return bytes.length === 32;
    } catch {
      return false;
    }
  }

  // --- Reads ---------------------------------------------------------------

  async getNativeBalance(address: string): Promise<bigint> {
    const { PublicKey } = await this.web3();
    const conn = await this.connection();
    const lamports = await conn.getBalance(new PublicKey(address));
    return BigInt(Math.trunc(lamports));
  }

  async getTokenBalance(address: string, token: string): Promise<bigint> {
    const { PublicKey } = await this.web3();
    const conn = await this.connection();
    try {
      const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(address), { mint: new PublicKey(token) });
      let total = 0n;
      for (const acc of res.value) total += BigInt(acc.account.data.parsed.info.tokenAmount.amount);
      return total;
    } catch (err) {
      logger.debug('sol token balance failed', { token, e: (err as Error).message });
      return 0n;
    }
  }

  async getTokenMeta(token: string): Promise<TokenMeta> {
    const { PublicKey } = await this.web3();
    const conn = await this.connection();
    let decimals = 9;
    try {
      const info = (await conn.getParsedAccountInfo(new PublicKey(token))) as any;
      const d = info?.value?.data?.parsed?.info?.decimals;
      if (Number.isInteger(d)) decimals = d;
    } catch (err) {
      logger.debug('sol mint decimals failed', { token, e: (err as Error).message });
    }
    const short = `${token.slice(0, 4)}…${token.slice(-4)}`;
    return { address: token, symbol: short, name: short, decimals };
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
    const { Keypair, VersionedTransaction } = await this.web3();
    const conn = await this.connection();
    const keypair = Keypair.fromSecretKey(decodeSecret(secretKey));

    const res = await this.fetchImpl(`${JUP}/swap/v1/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildSwapBody(quote.raw, req.owner)),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Jupiter swap build failed (${res.status})`);
    const { swapTransaction } = (await res.json()) as { swapTransaction?: string };
    if (!swapTransaction) throw new Error('Jupiter returned no transaction');

    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
    tx.sign([keypair]);
    const raw = tx.serialize();
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
    const bh = await conn.getLatestBlockhash();
    await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed').catch(() => {});
    return { digest: sig, outAmount: quote.outAmount };
  }

  // --- Explorer ------------------------------------------------------------

  explorerTx(hash: string): string {
    return `https://solscan.io/tx/${hash}`;
  }

  explorerAddress(address: string): string {
    return `https://solscan.io/account/${address}`;
  }
}

/** Decode a Solana secret: base58 (64-byte) or a JSON byte array. */
function decodeSecret(secret: string): Uint8Array {
  const s = secret.trim();
  if (s.startsWith('[')) {
    const arr = JSON.parse(s) as number[];
    if (arr.length !== 64) throw new Error('Solana secret array must be 64 bytes');
    return Uint8Array.from(arr);
  }
  const bytes = bs58.decode(s);
  if (bytes.length !== 64) throw new Error('Solana secret must decode to 64 bytes');
  return bytes;
}

function describe(keypair: { publicKey: { toBase58(): string }; secretKey: Uint8Array }): GeneratedWallet {
  return {
    address: keypair.publicKey.toBase58(),
    secretKey: bs58.encode(keypair.secretKey),
    scheme: 'ED25519',
  };
}
