import { Transaction } from '@mysten/sui/transactions';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SuiClient } from '@mysten/sui/client';
import { formatAmount } from '../util/format.js';

export const SUI_TYPE = '0x2::sui::SUI';
export const SUI_DECIMALS = 9;
/** MIST per SUI. */
export const MIST_PER_SUI = 1_000_000_000n;

export interface CoinMeta {
  coinType: string;
  decimals: number;
  symbol: string;
  name: string;
}

export interface Holding extends CoinMeta {
  balance: bigint;
  formatted: string;
}

/** Explorer base URLs per network. */
const EXPLORER: Record<string, string> = {
  mainnet: 'https://suiscan.xyz/mainnet',
  testnet: 'https://suiscan.xyz/testnet',
  devnet: 'https://suiscan.xyz/devnet',
};

/**
 * Higher-level Sui operations used by the bot. Wraps a SuiClient so the network
 * layer can be faked in tests.
 */
export class SuiService {
  private metaCache = new Map<string, CoinMeta>();

  constructor(
    private readonly client: SuiClient,
    private readonly network: string,
  ) {
    // SUI metadata is fixed; seed the cache.
    this.metaCache.set(SUI_TYPE, {
      coinType: SUI_TYPE,
      decimals: SUI_DECIMALS,
      symbol: 'SUI',
      name: 'Sui',
    });
  }

  /** Total balance of a coin type in base units. */
  async getBalance(owner: string, coinType = SUI_TYPE): Promise<bigint> {
    const res = await this.client.getBalance({ owner, coinType });
    return BigInt(res.totalBalance);
  }

  /** Resolve (and cache) coin metadata; falls back to a minimal record. */
  async getCoinMeta(coinType: string): Promise<CoinMeta> {
    const cached = this.metaCache.get(coinType);
    if (cached) return cached;
    const meta = await this.client.getCoinMetadata({ coinType });
    const resolved: CoinMeta = {
      coinType,
      decimals: meta?.decimals ?? 0,
      symbol: meta?.symbol ?? shortSymbol(coinType),
      name: meta?.name ?? shortSymbol(coinType),
    };
    this.metaCache.set(coinType, resolved);
    return resolved;
  }

  /** All non-zero holdings for an owner, decorated with metadata + formatting. */
  async getHoldings(owner: string): Promise<Holding[]> {
    const balances = await this.client.getAllBalances({ owner });
    const holdings: Holding[] = [];
    for (const b of balances) {
      const balance = BigInt(b.totalBalance);
      if (balance === 0n) continue;
      const meta = await this.getCoinMeta(b.coinType);
      holdings.push({
        ...meta,
        balance,
        formatted: formatAmount(balance, meta.decimals),
      });
    }
    // SUI first, then by descending balance.
    holdings.sort((a, b) => {
      if (a.coinType === SUI_TYPE) return -1;
      if (b.coinType === SUI_TYPE) return 1;
      return a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0;
    });
    return holdings;
  }

  /** Build & execute a transfer of a coin amount to a recipient. */
  async transfer(params: {
    signer: Ed25519Keypair;
    recipient: string;
    coinType: string;
    amount: bigint;
  }): Promise<{ digest: string }> {
    const { signer, recipient, coinType, amount } = params;
    const tx = new Transaction();
    tx.setSender(signer.toSuiAddress());
    if (coinType === SUI_TYPE) {
      const [coin] = tx.splitCoins(tx.gas, [amount]);
      tx.transferObjects([coin], recipient);
    } else {
      const coins = await this.client.getCoins({ owner: signer.toSuiAddress(), coinType });
      if (coins.data.length === 0) throw new Error(`No ${coinType} coins to transfer`);
      const primary = coins.data[0]!.coinObjectId;
      if (coins.data.length > 1) {
        tx.mergeCoins(
          tx.object(primary),
          coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
        );
      }
      const [coin] = tx.splitCoins(tx.object(primary), [amount]);
      tx.transferObjects([coin], recipient);
    }
    return this.execute(signer, tx);
  }

  /** Sign, execute, and wait for a transaction. Throws on execution failure. */
  async execute(signer: Ed25519Keypair, tx: Transaction): Promise<{ digest: string }> {
    const res = await this.client.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true, showObjectChanges: true },
    });
    const status = res.effects?.status;
    if (status && status.status !== 'success') {
      throw new Error(`Transaction failed: ${status.error ?? 'unknown error'}`);
    }
    await this.client.waitForTransaction({ digest: res.digest });
    return { digest: res.digest };
  }

  /** Sign, execute, wait, and return the full response (for object-change parsing). */
  async executeFull(signer: Ed25519Keypair, tx: Transaction) {
    const res = await this.client.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true, showObjectChanges: true, showEvents: true },
    });
    const status = res.effects?.status;
    if (status && status.status !== 'success') {
      throw new Error(`Transaction failed: ${status.error ?? 'unknown error'}`);
    }
    await this.client.waitForTransaction({ digest: res.digest });
    return res;
  }

  /**
   * Detect a leader's recent buys (SUI spent to acquire a token) by scanning
   * their outgoing transactions' balance changes. Best-effort; used by
   * copy-trading. Returns newest-first and a cursor to resume from.
   */
  async recentBuys(
    address: string,
    cursor?: string,
    limit = 10,
  ): Promise<{ buys: { coinType: string; suiSpent: bigint; digest: string }[]; nextCursor?: string }> {
    const res = await this.client.queryTransactionBlocks({
      filter: { FromAddress: address },
      options: { showBalanceChanges: true },
      order: 'descending',
      limit,
      ...(cursor ? { cursor } : {}),
    });
    const buys: { coinType: string; suiSpent: bigint; digest: string }[] = [];
    for (const tx of res.data ?? []) {
      const changes = tx.balanceChanges ?? [];
      let suiDelta = 0n;
      let tokenGained: { coinType: string; amount: bigint } | undefined;
      for (const c of changes) {
        const ownerAddr = typeof c.owner === 'object' && c.owner && 'AddressOwner' in c.owner ? c.owner.AddressOwner : undefined;
        if (ownerAddr !== address) continue;
        const amount = BigInt(c.amount);
        if (c.coinType === SUI_TYPE) suiDelta += amount;
        else if (amount > 0n) tokenGained = { coinType: c.coinType, amount };
      }
      // A buy: SUI net decreased and a non-SUI token increased.
      if (tokenGained && suiDelta < 0n) {
        buys.push({ coinType: tokenGained.coinType, suiSpent: -suiDelta, digest: tx.digest });
      }
    }
    return { buys, nextCursor: res.nextCursor ?? undefined };
  }

  txUrl(digest: string): string {
    const base = EXPLORER[this.network];
    return base ? `${base}/tx/${digest}` : digest;
  }

  addressUrl(address: string): string {
    const base = EXPLORER[this.network];
    return base ? `${base}/account/${address}` : address;
  }
}

function shortSymbol(coinType: string): string {
  const parts = coinType.split('::');
  return parts[parts.length - 1] ?? coinType;
}
