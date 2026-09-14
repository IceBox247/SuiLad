import type { Repo } from '../storage/repo.js';
import type { UserRecord } from '../storage/types.js';
import { referralShares } from '../trade/fees.js';

export interface ReferralCredit {
  level: number; // 1..5
  uplineId: string;
  amountMist: bigint;
}

export interface ReferralSummary {
  code: string;
  referrerId?: string;
  unclaimedMist: bigint;
  totalEarnedMist: bigint;
  levelCounts: number[];
}

/**
 * 5-level referral engine. Referral earnings are an off-chain ledger credited
 * from the platform fee each time a downline user trades. Level shares default
 * to 20% / 5% / 2% / 2% / 1% of the fee (configurable).
 */
export class ReferralService {
  constructor(
    private readonly repo: Repo,
    private readonly levelBps: number[],
  ) {}

  /** Walk up the referral chain (max 5) from a user, returning [L1..Ln] ids. */
  private async uplineChain(userId: string): Promise<string[]> {
    const chain: string[] = [];
    let currentId: string | undefined = userId;
    const seen = new Set<string>([userId]);
    for (let level = 0; level < 5; level++) {
      const user: UserRecord | undefined = currentId ? await this.repo.getUser(currentId) : undefined;
      const upline: string | undefined = user?.referral.referrerId;
      if (!upline || seen.has(upline)) break;
      chain.push(upline);
      seen.add(upline);
      currentId = upline;
    }
    return chain;
  }

  /** Increment downline counts up the chain for a newly-attributed user. */
  async registerDownline(newUserId: string): Promise<void> {
    const chain = await this.uplineChain(newUserId);
    for (let i = 0; i < chain.length; i++) {
      await this.repo.withUser(chain[i]!, (u) => {
        u.referral.levelCounts[i] = (u.referral.levelCounts[i] ?? 0) + 1;
      });
    }
  }

  /** Credit a collected fee (MIST) to the payer's up-to-5 uplines. */
  async creditFees(feePayerId: string, feeMist: bigint): Promise<ReferralCredit[]> {
    if (feeMist <= 0n) return [];
    const chain = await this.uplineChain(feePayerId);
    if (chain.length === 0) return [];
    const shares = referralShares(feeMist, this.levelBps);
    const credits: ReferralCredit[] = [];
    for (let i = 0; i < chain.length; i++) {
      const amount = shares[i] ?? 0n;
      if (amount <= 0n) continue;
      await this.repo.withUser(chain[i]!, (u) => {
        u.referral.unclaimedMist = (BigInt(u.referral.unclaimedMist) + amount).toString();
        u.referral.totalEarnedMist = (BigInt(u.referral.totalEarnedMist) + amount).toString();
      });
      credits.push({ level: i + 1, uplineId: chain[i]!, amountMist: amount });
    }
    return credits;
  }

  /** Zero out unclaimed earnings and return the amount (for on-chain payout). */
  async claim(userId: string): Promise<bigint> {
    let claimed = 0n;
    await this.repo.withUser(userId, (u) => {
      claimed = BigInt(u.referral.unclaimedMist);
      u.referral.unclaimedMist = '0';
    });
    return claimed;
  }

  async summary(userId: string): Promise<ReferralSummary | undefined> {
    const u = await this.repo.getUser(userId);
    if (!u) return undefined;
    return {
      code: u.referral.code,
      referrerId: u.referral.referrerId,
      unclaimedMist: BigInt(u.referral.unclaimedMist),
      totalEarnedMist: BigInt(u.referral.totalEarnedMist),
      levelCounts: u.referral.levelCounts,
    };
  }
}
