import type { Repo } from '../storage/repo.js';

export interface CashbackSummary {
  unclaimedMist: bigint;
  totalMist: bigint;
  rateBps: number;
}

/**
 * Cashback: rebates a share (default 20%) of each user's OWN trading fee back
 * to them — the standard "trade and earn" perk on Telegram trading bots. It's
 * an off-chain ledger credited on every trade and paid out on claim, entirely
 * separate from the 5-level referral program.
 */
export class CashbackService {
  constructor(
    private readonly repo: Repo,
    private readonly rateBps: number,
  ) {}

  /** Credit the trader's cashback from the fee they just paid (MIST). */
  async credit(userId: string, feeMist: bigint): Promise<bigint> {
    if (feeMist <= 0n || this.rateBps <= 0) return 0n;
    const amount = (feeMist * BigInt(this.rateBps)) / 10_000n;
    if (amount <= 0n) return 0n;
    await this.repo.withUser(userId, (u) => {
      const cb = u.cashback ?? { unclaimedMist: '0', totalMist: '0' };
      cb.unclaimedMist = (BigInt(cb.unclaimedMist) + amount).toString();
      cb.totalMist = (BigInt(cb.totalMist) + amount).toString();
      u.cashback = cb;
    });
    return amount;
  }

  async summary(userId: string): Promise<CashbackSummary> {
    const u = await this.repo.getUser(userId);
    const cb = u?.cashback ?? { unclaimedMist: '0', totalMist: '0' };
    return { unclaimedMist: BigInt(cb.unclaimedMist), totalMist: BigInt(cb.totalMist), rateBps: this.rateBps };
  }
}
