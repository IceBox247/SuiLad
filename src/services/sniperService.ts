import { randomUUID } from 'node:crypto';
import type { Repo } from '../storage/repo.js';
import type { PriceOracle } from '../trade/priceOracle.js';
import type { TradeService } from '../trade/tradeService.js';
import type { WalletService } from './walletService.js';
import type { SecurityService } from './security.js';
import type { Notifier } from './orderEngine.js';
import type { SnipeConfig } from '../storage/types.js';
import { SUI_TYPE } from '../sui/service.js';
import { logger } from '../logger.js';

/**
 * Sniper: auto-buy a token the moment it becomes tradeable (a route with
 * liquidity appears). `tick()` (cron) probes each armed snipe's price and fires
 * a buy as soon as routing succeeds.
 */
export class SniperService {
  constructor(
    private readonly repo: Repo,
    private readonly oracle: PriceOracle,
    private readonly trade: TradeService,
    private readonly wallet: WalletService,
    private readonly security: SecurityService,
    private readonly notify: Notifier = async () => {},
  ) {}

  async arm(id: string, input: { coinType: string; amountSui: string; maxSlippageBps: number }): Promise<SnipeConfig> {
    const cfg: SnipeConfig = {
      id: randomUUID(),
      coinType: input.coinType,
      amountSui: input.amountSui,
      maxSlippageBps: input.maxSlippageBps,
      active: true,
      createdAt: new Date().toISOString(),
    };
    await this.repo.withUser(id, (u) => {
      u.snipes.unshift(cfg);
    });
    await this.repo.setActive('snipe', id, true);
    return cfg;
  }

  async disarm(id: string, snipeId: string): Promise<void> {
    let stillActive = false;
    await this.repo.withUser(id, (u) => {
      u.snipes = u.snipes.filter((s) => s.id !== snipeId);
      stillActive = u.snipes.some((s) => s.active);
    });
    if (!stillActive) await this.repo.setActive('snipe', id, false);
  }

  async list(id: string): Promise<SnipeConfig[]> {
    return (await this.repo.getUser(id))?.snipes.filter((s) => s.active) ?? [];
  }

  async tick(): Promise<{ scanned: number; fired: number }> {
    const ids = await this.repo.listActive('snipe');
    let fired = 0;
    for (const id of ids) {
      try {
        fired += await this.tickUser(id);
      } catch (err) {
        logger.warn('snipe tick failed', { id, error: (err as Error).message });
      }
    }
    return { scanned: ids.length, fired };
  }

  private async tickUser(id: string): Promise<number> {
    const u = await this.repo.getUser(id);
    const active = u?.snipes.filter((s) => s.active && s.coinType) ?? [];
    if (active.length === 0) {
      await this.repo.setActive('snipe', id, false);
      return 0;
    }
    let fired = 0;
    for (const snipe of active) {
      // A route existing (no throw) means the token is tradeable.
      try {
        await this.oracle.priceX18(snipe.coinType!, { fresh: true });
      } catch {
        continue; // not tradeable yet
      }
      if (!(await this.security.firstSeen(`snipe:${id}:${snipe.id}`, 3600))) continue;
      try {
        const signer = await this.wallet.getKeypair(id);
        const prepared = await this.trade.prepareQuote({
          inputType: SUI_TYPE,
          outputType: snipe.coinType!,
          humanAmount: snipe.amountSui,
          slippageBps: snipe.maxSlippageBps,
        });
        const { digest } = await this.trade.execute({ telegramId: id, prepared, signer, tradeKind: 'snipe' });
        await this.repo.withUser(id, (uu) => {
          const s = uu.snipes.find((x) => x.id === snipe.id);
          if (s) s.active = false;
        });
        await this.notify(id, `🎯 Sniped ${prepared.outputMeta.symbol}! Tx: ${digest}`);
        fired += 1;
      } catch (err) {
        await this.notify(id, `⚠️ Snipe failed: ${(err as Error).message}`).catch(() => {});
      }
    }
    return fired;
  }
}
