import { randomBytes } from 'node:crypto';
import type { KvBackend } from './backend.js';
import {
  IDX,
  defaultReferral,
  defaultSettings,
  type UserRecord,
} from './types.js';

const CAP = 200; // max history entries kept per list

export interface CreateUserInput {
  address: string;
  encryptedSecretKey: string;
  keyScheme: string;
  referrerId?: string;
}

/**
 * Per-user repository over a KV backend. Every mutation runs under a per-user
 * lock so concurrent updates (webhook + cron) can't clobber each other or a
 * user's balances — critical for fund safety under serverless concurrency.
 */
export class Repo {
  constructor(
    private readonly kv: KvBackend,
    private readonly defaultSlippageBps: number,
  ) {}

  async getUser(id: string): Promise<UserRecord | undefined> {
    const raw = await this.kv.get(IDX.user(id));
    return raw ? (JSON.parse(raw) as UserRecord) : undefined;
  }

  async hasUser(id: string): Promise<boolean> {
    return (await this.kv.get(IDX.user(id))) !== null;
  }

  async resolveRefCode(code: string): Promise<string | undefined> {
    const id = await this.kv.get(IDX.refCode(code.trim().toUpperCase()));
    return id ?? undefined;
  }

  /** Create a user if absent, assigning a unique referral code. Idempotent. */
  async createUser(id: string, input: CreateUserInput): Promise<UserRecord> {
    const existing = await this.getUser(id);
    if (existing) return existing;
    const code = await this.mintReferralCode();
    const now = new Date().toISOString();
    const record: UserRecord = {
      telegramId: id,
      address: input.address,
      encryptedSecretKey: input.encryptedSecretKey,
      keyScheme: input.keyScheme,
      settings: defaultSettings(this.defaultSlippageBps),
      referral: defaultReferral(code, input.referrerId),
      subWallets: [],
      positions: [],
      orders: [],
      copies: [],
      snipes: [],
      watchlist: [],
      trades: [],
      launches: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.kv.set(IDX.user(id), JSON.stringify(record));
    await this.kv.set(IDX.refCode(code), id);
    return record;
  }

  /** Replace a user's stored key material (wallet import), keeping other data. */
  async setWallet(
    id: string,
    data: { address: string; encryptedSecretKey: string; keyScheme: string },
  ): Promise<UserRecord> {
    return this.withUser(id, (u) => {
      u.address = data.address;
      u.encryptedSecretKey = data.encryptedSecretKey;
      u.keyScheme = data.keyScheme;
    });
  }

  /**
   * Load a user under a lock, apply `mutator`, persist, and return the record.
   * Throws if the user does not exist or the lock cannot be acquired.
   */
  async withUser(id: string, mutator: (u: UserRecord) => void | Promise<void>): Promise<UserRecord> {
    return this.withLock(IDX.user(id), async () => {
      const u = await this.getUser(id);
      if (!u) throw new Error('No wallet yet. Use /start to create one.');
      await mutator(u);
      u.updatedAt = new Date().toISOString();
      trimHistory(u);
      await this.kv.set(IDX.user(id), JSON.stringify(u));
      return u;
    });
  }

  /** Run `fn` while holding a per-key lock; retries briefly, then errors. */
  async withLock<T>(key: string, fn: () => Promise<T>, ttlMs = 8000): Promise<T> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const release = await this.kv.acquireLock(key, ttlMs);
      if (release) {
        try {
          return await fn();
        } finally {
          await release().catch(() => {});
        }
      }
      await sleep(40 + attempt * 20);
    }
    throw new Error('The wallet is busy processing another action. Please try again in a moment.');
  }

  // --- indexes for cron scans -------------------------------------------------

  async setActive(kind: 'orders' | 'copy' | 'snipe' | 'alerts', id: string, active: boolean): Promise<void> {
    const key = { orders: IDX.ordersActive, copy: IDX.copyActive, snipe: IDX.snipeActive, alerts: IDX.alertsActive }[kind];
    if (active) await this.kv.sadd(key, id);
    else await this.kv.srem(key, id);
  }

  async listActive(kind: 'orders' | 'copy' | 'snipe' | 'alerts'): Promise<string[]> {
    const key = { orders: IDX.ordersActive, copy: IDX.copyActive, snipe: IDX.snipeActive, alerts: IDX.alertsActive }[kind];
    return this.kv.smembers(key);
  }

  async addFollower(leaderAddress: string, followerId: string): Promise<void> {
    await this.kv.sadd(IDX.leaderFollowers(leaderAddress), followerId);
  }
  async removeFollower(leaderAddress: string, followerId: string): Promise<void> {
    await this.kv.srem(IDX.leaderFollowers(leaderAddress), followerId);
  }
  async getFollowers(leaderAddress: string): Promise<string[]> {
    return this.kv.smembers(IDX.leaderFollowers(leaderAddress));
  }

  /** Rate-limit helper: returns the count within the window. */
  async bumpRate(key: string, windowSeconds: number): Promise<number> {
    return this.kv.incrWindow(`rate:${key}`, windowSeconds);
  }

  /** Small global key/value scratch space (cursors, counters). */
  async getMeta(key: string): Promise<string | undefined> {
    return (await this.kv.get(`meta:${key}`)) ?? undefined;
  }
  async setMeta(key: string, value: string): Promise<void> {
    await this.kv.set(`meta:${key}`, value);
  }

  private async mintReferralCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
      if ((await this.kv.get(IDX.refCode(code))) === null) return code;
    }
    // Extremely unlikely; fall back to a longer code.
    return randomBytes(8).toString('hex').toUpperCase();
  }
}

function trimHistory(u: UserRecord): void {
  if (u.trades.length > CAP) u.trades = u.trades.slice(0, CAP);
  if (u.launches.length > CAP) u.launches = u.launches.slice(0, CAP);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
