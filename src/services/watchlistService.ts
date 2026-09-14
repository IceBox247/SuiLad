import type { Repo } from '../storage/repo.js';
import type { PriceOracle } from '../trade/priceOracle.js';
import type { SuiService } from '../sui/service.js';
import type { Notifier } from './orderEngine.js';
import type { WatchItem } from '../storage/types.js';
import { PriceOracle as Oracle } from '../trade/priceOracle.js';
import { logger } from '../logger.js';

/**
 * Watchlist with optional price alerts. `tick()` (cron) checks each armed alert
 * and notifies the user when a token's SUI price crosses the target, then clears
 * that alert.
 */
export class WatchlistService {
  constructor(
    private readonly repo: Repo,
    private readonly oracle: PriceOracle,
    private readonly sui: SuiService,
    private readonly notify: Notifier = async () => {},
  ) {}

  async add(id: string, coinType: string, alertPrice?: string, direction?: 'above' | 'below'): Promise<WatchItem> {
    const meta = await this.sui.getCoinMeta(coinType);
    const item: WatchItem = {
      coinType,
      symbol: meta.symbol,
      alertPrice,
      direction,
      addedAt: new Date().toISOString(),
    };
    await this.repo.withUser(id, (u) => {
      u.watchlist = u.watchlist.filter((w) => w.coinType !== coinType);
      u.watchlist.unshift(item);
    });
    await this.refreshActive(id);
    return item;
  }

  async remove(id: string, coinType: string): Promise<void> {
    await this.repo.withUser(id, (u) => {
      u.watchlist = u.watchlist.filter((w) => w.coinType !== coinType);
    });
    await this.refreshActive(id);
  }

  async list(id: string): Promise<WatchItem[]> {
    return (await this.repo.getUser(id))?.watchlist ?? [];
  }

  private async refreshActive(id: string): Promise<void> {
    const u = await this.repo.getUser(id);
    const hasAlerts = (u?.watchlist ?? []).some((w) => w.alertPrice);
    await this.repo.setActive('alerts', id, hasAlerts);
  }

  async tick(): Promise<{ scanned: number; alerts: number }> {
    const ids = await this.repo.listActive('alerts');
    let alerts = 0;
    for (const id of ids) {
      try {
        alerts += await this.tickUser(id);
      } catch (err) {
        logger.warn('watchlist tick failed', { id, error: (err as Error).message });
      }
    }
    return { scanned: ids.length, alerts };
  }

  private async tickUser(id: string): Promise<number> {
    const u = await this.repo.getUser(id);
    const items = (u?.watchlist ?? []).filter((w) => w.alertPrice);
    if (items.length === 0) {
      await this.repo.setActive('alerts', id, false);
      return 0;
    }
    let count = 0;
    for (const item of items) {
      let price: bigint;
      try {
        price = await this.oracle.priceX18(item.coinType);
      } catch {
        continue;
      }
      const target = Oracle.toX18(item.alertPrice!);
      const crossed = item.direction === 'below' ? price <= target : price >= target;
      if (!crossed) continue;
      await this.notify(
        id,
        `🔔 ${item.symbol} price alert: now ${Oracle.fromX18(price).toPrecision(6)} SUI ` +
          `(${item.direction ?? 'above'} ${item.alertPrice}).`,
      );
      // Clear the alert once fired.
      await this.repo.withUser(id, (uu) => {
        const w = uu.watchlist.find((x) => x.coinType === item.coinType);
        if (w) {
          delete w.alertPrice;
          delete w.direction;
        }
      });
      count += 1;
    }
    await this.refreshActive(id);
    return count;
  }
}
