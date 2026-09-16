import { randomUUID } from 'node:crypto';
import type { Repo } from '../storage/repo.js';
import type { SuiService } from '../sui/service.js';
import type { TradeService } from '../trade/tradeService.js';
import type { WalletService } from './walletService.js';
import type { SecurityService } from './security.js';
import type { Notifier } from './orderEngine.js';
import type { CopyConfig } from '../storage/types.js';
import { normalizeSuiAddress } from '../util/validate.js';
import { fromBaseUnits } from '../util/format.js';
import { SUI_TYPE } from '../sui/service.js';
import { logger } from '../logger.js';

/** Pure: how much SUI (MIST) to mirror for a leader's buy given follower config. */
export function mirrorAmountMist(leaderSuiSpent: bigint, ratioBps: number, maxSuiMist: bigint): bigint {
  if (ratioBps <= 0) return 0n;
  const scaled = (leaderSuiSpent * BigInt(ratioBps)) / 10_000n;
  return scaled > maxSuiMist ? maxSuiMist : scaled;
}

/**
 * Copy-trading: mirror a leader wallet's buys into followers' wallets. `tick()`
 * (cron) scans each followed leader's recent on-chain buys and replicates them
 * proportionally, capped by each follower's budget.
 */
export class CopyTradeService {
  constructor(
    private readonly repo: Repo,
    private readonly sui: SuiService,
    private readonly trade: TradeService,
    private readonly wallet: WalletService,
    private readonly security: SecurityService,
    private readonly notify: Notifier = async () => {},
  ) {}

  async follow(id: string, leaderAddress: string, ratioBps: number, maxSui: string): Promise<CopyConfig> {
    const leader = normalizeSuiAddress(leaderAddress);
    const maxSuiNum = Number(maxSui);
    if (!Number.isFinite(maxSuiNum) || maxSuiNum <= 0) throw new Error('Max SUI per copy must be a positive number.');
    const cfg: CopyConfig = {
      id: randomUUID(),
      leaderAddress: leader,
      ratioBps,
      maxSui,
      active: true,
      createdAt: new Date().toISOString(),
    };
    await this.repo.withUser(id, (u) => {
      u.copies.unshift(cfg);
    });
    await this.repo.addFollower(leader, id);
    await this.repo.setActive('copy', id, true);
    return cfg;
  }

  async unfollow(id: string, configId: string): Promise<void> {
    let leader: string | undefined;
    let stillActive = false;
    await this.repo.withUser(id, (u) => {
      const cfg = u.copies.find((c) => c.id === configId);
      if (cfg) {
        leader = cfg.leaderAddress;
        cfg.active = false;
      }
      u.copies = u.copies.filter((c) => c.id !== configId);
      stillActive = u.copies.some((c) => c.active);
    });
    if (leader) await this.repo.removeFollower(leader, id);
    if (!stillActive) await this.repo.setActive('copy', id, false);
  }

  async list(id: string): Promise<CopyConfig[]> {
    return (await this.repo.getUser(id))?.copies.filter((c) => c.active) ?? [];
  }

  /** Cron entrypoint: mirror new leader buys to followers. */
  async tick(): Promise<{ leaders: number; mirrored: number }> {
    const followerIds = await this.repo.listActive('copy');
    const leaders = new Set<string>();
    for (const fid of followerIds) {
      const u = await this.repo.getUser(fid);
      for (const c of u?.copies ?? []) if (c.active) leaders.add(c.leaderAddress);
    }

    let mirrored = 0;
    for (const leader of leaders) {
      try {
        mirrored += await this.processLeader(leader);
      } catch (err) {
        logger.warn('copy leader failed', { leader, error: (err as Error).message });
      }
    }
    return { leaders: leaders.size, mirrored };
  }

  private async processLeader(leader: string): Promise<number> {
    const lastDigest = await this.repo.getMeta(`copy:last:${leader}`);
    const { buys } = await this.sui.recentBuys(leader, undefined, 10);
    if (buys.length === 0) return 0;
    // Newest first; take only buys newer than the last processed digest.
    const fresh: typeof buys = [];
    for (const b of buys) {
      if (b.digest === lastDigest) break;
      fresh.push(b);
    }
    await this.repo.setMeta(`copy:last:${leader}`, buys[0]!.digest);
    if (fresh.length === 0) return 0;

    const followers = await this.repo.getFollowers(leader);
    let mirrored = 0;
    for (const b of fresh.reverse()) {
      for (const fid of followers) {
        if (!(await this.security.firstSeen(`copy:${fid}:${b.digest}`, 3600))) continue;
        const done = await this.mirrorFor(fid, leader, b).catch((err) => {
          logger.warn('mirror failed', { fid, error: (err as Error).message });
          return false;
        });
        if (done) mirrored += 1;
      }
    }
    return mirrored;
  }

  private async mirrorFor(
    fid: string,
    leader: string,
    buy: { coinType: string; suiSpent: bigint },
  ): Promise<boolean> {
    const u = await this.repo.getUser(fid);
    const cfg = u?.copies.find((c) => c.active && c.leaderAddress === leader);
    if (!u || !cfg) return false;
    const maxNum = Number(cfg.maxSui);
    if (!Number.isFinite(maxNum) || maxNum <= 0) return false; // guard legacy/garbage values
    const maxMist = BigInt(Math.round(maxNum * 1e9));
    const amount = mirrorAmountMist(buy.suiSpent, cfg.ratioBps, maxMist);
    if (amount <= 0n) return false;
    const signer = await this.wallet.getKeypair(fid);
    const prepared = await this.trade.prepareQuote({
      inputType: SUI_TYPE,
      outputType: buy.coinType,
      humanAmount: fromBaseUnits(amount, 9),
      slippageBps: u.settings.slippageBps,
    });
    const { digest } = await this.trade.execute({ telegramId: fid, prepared, signer, tradeKind: 'copy' });
    await this.notify(fid, `👥 Copy-trade: mirrored a buy of ${prepared.outputMeta.symbol}. Tx: ${digest}`);
    return true;
  }
}
