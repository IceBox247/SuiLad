import type { Repo } from '../storage/repo.js';

export interface SecurityOptions {
  rateLimitPerMin: number;
  maxBuySui: number; // 0 = no cap
  allowedIds: string[]; // empty = open
  adminIds: string[];
  /**
   * Only restrict to `allowedIds` when this is true. Defaults to false so the
   * bot is public by default — a leftover ALLOWED_TELEGRAM_IDS value can never
   * silently lock everyone out. Set ENFORCE_ALLOWLIST=true to make it private.
   */
  enforceAllowlist: boolean;
}

/**
 * Anti-abuse & fund-safety controls: per-user rate limiting, spend caps,
 * allowlist/admin checks, idempotency guards and bans. Backed by the KV layer
 * so limits hold across serverless invocations.
 */
export class SecurityService {
  constructor(
    private readonly repo: Repo,
    private readonly opts: SecurityOptions,
  ) {}

  isAllowed(id: string): boolean {
    if (!this.opts.enforceAllowlist) return true; // public by default
    return this.opts.allowedIds.length === 0 || this.opts.allowedIds.includes(id);
  }

  isAdmin(id: string): boolean {
    return this.opts.adminIds.includes(id);
  }

  /** Throttle an action per user. Throws a friendly error when exceeded. */
  async enforceRate(id: string, action: string, perMin = this.opts.rateLimitPerMin): Promise<void> {
    const count = await this.repo.bumpRate(`${action}:${id}`, 60);
    if (count > perMin) {
      throw new Error('You are going too fast. Please wait a moment and try again.');
    }
  }

  /** Idempotency: returns true only the first time a key is seen within ttl. */
  async firstSeen(key: string, ttlSeconds = 300): Promise<boolean> {
    return (await this.repo.bumpRate(`idem:${key}`, ttlSeconds)) === 1;
  }

  /** Reject buys that exceed the per-transaction SUI cap (0 = unlimited). */
  assertBuyWithinCap(sui: number): void {
    if (this.opts.maxBuySui > 0 && sui > this.opts.maxBuySui) {
      throw new Error(`Buy exceeds the per-trade cap of ${this.opts.maxBuySui} SUI.`);
    }
  }

  async isBanned(id: string): Promise<boolean> {
    const u = await this.repo.getUser(id);
    if (!u?.bannedUntil) return false;
    return new Date(u.bannedUntil).getTime() > Date.now();
  }

  async ban(id: string, until: Date): Promise<void> {
    await this.repo.withUser(id, (u) => {
      u.bannedUntil = until.toISOString();
    });
  }

  async unban(id: string): Promise<void> {
    await this.repo.withUser(id, (u) => {
      delete u.bannedUntil;
    });
  }
}
