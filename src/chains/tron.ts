import { createHash } from 'node:crypto';
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

const TRONGRID = 'https://api.trongrid.io';

/** base58check-encode a 21-byte Tron address payload (0x41 + 20-byte body). */
function tronBase58(payloadHex: string): string {
  const payload = Buffer.from(payloadHex, 'hex');
  const checksum = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, checksum]));
}

/** Normalize a Tron/EVM private key to 0x-prefixed 64-hex. */
function normalizePk(secret: string): `0x${string}` {
  const s = secret.trim();
  const hex = s.startsWith('0x') ? s.slice(2) : s;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Tron key must be 32 bytes (64 hex chars).');
  return `0x${hex}`;
}

/**
 * Tron adapter. Tron uses secp256k1 keys (like EVM) with a base58check address;
 * we derive both with viem (imported lazily) + node crypto, and read balances
 * over TronGrid via plain fetch. Swap execution is gated behind a clear
 * 'rolling out' message until it can be verified end-to-end with a funded
 * wallet — wallets and balances work today.
 */
export class TronAdapter implements ChainAdapter {
  readonly meta: ChainMeta = CHAINS.tron;

  constructor(
    private readonly apiKey = '',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private accounts() {
    return import('viem/accounts');
  }

  /** Derive the Tron base58 address from a secp256k1 private key. */
  private async addressFromPk(pk: `0x${string}`): Promise<string> {
    const { privateKeyToAccount } = await this.accounts();
    const evm = privateKeyToAccount(pk).address.slice(2); // keccak(pubkey)[12:], 20 bytes
    return tronBase58(`41${evm}`);
  }

  // --- Wallets -------------------------------------------------------------

  async createWallet(): Promise<GeneratedWallet> {
    const { generatePrivateKey } = await this.accounts();
    const pk = generatePrivateKey();
    return { address: await this.addressFromPk(pk), secretKey: pk, scheme: 'secp256k1' };
  }

  async importWallet(secret: string): Promise<GeneratedWallet> {
    const pk = normalizePk(secret);
    return { address: await this.addressFromPk(pk), secretKey: pk, scheme: 'secp256k1' };
  }

  isValidSecret(secret: string): boolean {
    try { normalizePk(secret); return true; } catch { return false; }
  }

  isValidAddress(address: string): boolean {
    const a = address.trim();
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return false;
    try {
      const raw = bs58.decode(a);
      if (raw.length !== 25) return false;
      const body = raw.subarray(0, 21);
      const check = raw.subarray(21);
      const expect = createHash('sha256').update(createHash('sha256').update(body).digest()).digest().subarray(0, 4);
      return Buffer.from(check).equals(expect);
    } catch {
      return false;
    }
  }

  // --- Reads ---------------------------------------------------------------

  async getNativeBalance(address: string): Promise<bigint> {
    try {
      const res = await this.fetchImpl(`${TRONGRID}/wallet/getaccount`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.apiKey ? { 'TRON-PRO-API-KEY': this.apiKey } : {}) },
        body: JSON.stringify({ address, visible: true }),
        signal: AbortSignal.timeout(12_000),
      });
      const json = (await res.json()) as { balance?: number };
      return BigInt(json.balance ?? 0);
    } catch (err) {
      logger.debug('tron balance failed', { address, e: (err as Error).message });
      return 0n;
    }
  }

  async getTokenBalance(_address: string, _token: string): Promise<bigint> {
    // TRC-20 balance needs a constant-contract call; resolved when Tron trading
    // goes live. Degrade to 0 so the card still renders.
    return 0n;
  }

  async getTokenMeta(token: string): Promise<TokenMeta> {
    const short = `${token.slice(0, 4)}…${token.slice(-4)}`;
    return { address: token, symbol: short, name: short, decimals: 6 };
  }

  // --- Trading -------------------------------------------------------------

  async quote(req: SwapRequest): Promise<SwapQuote> {
    return { inputToken: req.inputToken, outputToken: req.outputToken, inAmount: req.amount, outAmount: '0', minOut: '0', route: 'SunSwap', raw: null };
  }

  async swap(): Promise<SwapResult> {
    throw new Error('Tron trading is rolling out — your Tron wallet and balances work now.');
  }

  // --- Explorer ------------------------------------------------------------

  explorerTx(hash: string): string {
    return `https://tronscan.org/#/transaction/${hash}`;
  }
  explorerAddress(address: string): string {
    return `https://tronscan.org/#/address/${address}`;
  }
}
