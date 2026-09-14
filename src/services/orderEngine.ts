import { randomUUID } from 'node:crypto';
import type { Repo } from '../storage/repo.js';
import type { PriceOracle } from '../trade/priceOracle.js';
import type { TradeService } from '../trade/tradeService.js';
import type { WalletService } from './walletService.js';
import type { SecurityService } from './security.js';
import { SuiService, SUI_TYPE } from '../sui/service.js';
import { fromBaseUnits } from '../util/format.js';
import type { Order, OrderKind } from '../storage/types.js';
import { logger } from '../logger.js';

export type Notifier = (telegramId: string, message: string) => Promise<void>;

export interface CreateOrderInput {
  kind: OrderKind;
  coinType: string;
  triggerPrice?: string; // SUI per token (human)
  amountSui?: string; // for buys
  sellPercent?: number; // for sells / TP / SL
  dca?: { intervalSec: number; totalBuys: number; amountSui: string };
}

/**
 * Off-chain automation for limit / take-profit / stop-loss / DCA orders.
 * `tick()` (run by cron) scans users with active orders, prices each token, and
 * fires matching orders through the same audited swap path used for manual
 * trades. Trades execute OUTSIDE the per-user lock to avoid re-entrancy.
 */
export class OrderEngine {
  constructor(
    private readonly repo: Repo,
    private readonly oracle: PriceOracle,
    private readonly trade: TradeService,
    private readonly wallet: WalletService,
    private readonly sui: SuiService,
    private readonly security: SecurityService,
    private readonly notify: Notifier = async () => {},
  ) {}

  async create(id: string, input: CreateOrderInput): Promise<Order> {
    const order: Order = {
      id: randomUUID(),
      kind: input.kind,
      coinType: input.coinType,
      triggerPrice: input.triggerPrice,
      amountSui: input.amountSui,
      sellPercent: input.sellPercent,
      dca: input.dca
        ? {
            intervalSec: input.dca.intervalSec,
            totalBuys: input.dca.totalBuys,
            completed: 0,
            amountSui: input.dca.amountSui,
            nextRunAt: new Date().toISOString(),
          }
        : undefined,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    await this.repo.withUser(id, (u) => {
      u.orders.unshift(order);
    });
    await this.repo.setActive('orders', id, true);
    return order;
  }

  async cancel(id: string, orderId: string): Promise<boolean> {
    let removed = false;
    let stillActive = false;
    await this.repo.withUser(id, (u) => {
      const o = u.orders.find((x) => x.id === orderId);
      if (o && o.status === 'active') {
        o.status = 'cancelled';
        removed = true;
      }
      stillActive = u.orders.some((x) => x.status === 'active');
    });
    if (!stillActive) await this.repo.setActive('orders', id, false);
    return removed;
  }

  async list(id: string): Promise<Order[]> {
    return (await this.repo.getUser(id))?.orders.filter((o) => o.status === 'active') ?? [];
  }

  /** Cron entrypoint: evaluate all users with active orders. */
  async tick(): Promise<{ scanned: number; fired: number }> {
    const ids = await this.repo.listActive('orders');
    let fired = 0;
    for (const id of ids) {
      try {
        fired += await this.tickUser(id);
      } catch (err) {
        logger.warn('order tick failed', { id, error: (err as Error).message });
      }
    }
    return { scanned: ids.length, fired };
  }

  private async tickUser(id: string): Promise<number> {
    const user = await this.repo.getUser(id);
    if (!user) {
      await this.repo.setActive('orders', id, false);
      return 0;
    }
    const active = user.orders.filter((o) => o.status === 'active');
    if (active.length === 0) {
      await this.repo.setActive('orders', id, false);
      return 0;
    }

    const now = Date.now();
    const priceCache = new Map<string, bigint>();
    let fired = 0;

    for (const order of active) {
      const shouldFire = await this.evaluate(order, priceCache, now);
      if (!shouldFire) continue;
      // Idempotency guard across overlapping cron runs.
      if (!(await this.security.firstSeen(`order:${id}:${order.id}:${order.dca?.completed ?? 0}`, 55))) continue;
      await this.fire(id, order).catch(async (err) => {
        await this.markFailed(id, order.id, (err as Error).message);
      });
      fired += 1;
    }
    return fired;
  }

  private async evaluate(order: Order, cache: Map<string, bigint>, now: number): Promise<boolean> {
    if (order.kind === 'dca') {
      const d = order.dca;
      if (!d) return false;
      return d.completed < d.totalBuys && new Date(d.nextRunAt).getTime() <= now;
    }
    if (!order.triggerPrice) return false;
    let price = cache.get(order.coinType);
    if (price === undefined) {
      try {
        price = await this.oracle.priceX18(order.coinType);
      } catch {
        return false; // no route right now
      }
      cache.set(order.coinType, price);
    }
    const trigger = (await import('../trade/priceOracle.js')).PriceOracle.toX18(order.triggerPrice);
    switch (order.kind) {
      case 'limit_buy':
      case 'stop_loss':
        return price <= trigger;
      case 'limit_sell':
      case 'take_profit':
        return price >= trigger;
      default:
        return false;
    }
  }

  private async fire(id: string, order: Order): Promise<void> {
    const signer = await this.wallet.getKeypair(id);
    if (order.kind === 'limit_buy' || order.kind === 'dca') {
      const amountSui = order.kind === 'dca' ? order.dca!.amountSui : order.amountSui!;
      const prepared = await this.trade.prepareQuote({
        inputType: SUI_TYPE,
        outputType: order.coinType,
        humanAmount: amountSui,
        slippageBps: (await this.repo.getUser(id))!.settings.slippageBps,
      });
      const { digest } = await this.trade.execute({
        telegramId: id,
        prepared,
        signer,
        tradeKind: order.kind === 'dca' ? 'dca' : 'order',
      });
      await this.repo.withUser(id, (u) => {
        const o = u.orders.find((x) => x.id === order.id);
        if (!o) return;
        o.lastRunAt = new Date().toISOString();
        if (o.kind === 'dca' && o.dca) {
          o.dca.completed += 1;
          o.dca.nextRunAt = new Date(Date.now() + o.dca.intervalSec * 1000).toISOString();
          if (o.dca.completed >= o.dca.totalBuys) o.status = 'done';
        } else {
          o.status = 'done';
        }
      });
      await this.notify(id, `✅ ${labelOf(order.kind)} filled for ${prepared.outputMeta.symbol}. Tx: ${digest}`);
    } else {
      // sell % of holdings
      const user = await this.repo.getUser(id);
      const pos = user?.positions.find((p) => p.coinType === order.coinType);
      const meta = await this.sui.getCoinMeta(order.coinType);
      const held = pos ? BigInt(pos.amount) : await this.sui.getBalance(user!.address, order.coinType);
      const pct = BigInt(Math.min(100, Math.max(1, order.sellPercent ?? 100)));
      const sellBase = (held * pct) / 100n;
      if (sellBase <= 0n) {
        await this.markDone(id, order.id);
        return;
      }
      const prepared = await this.trade.prepareQuote({
        inputType: order.coinType,
        outputType: SUI_TYPE,
        humanAmount: fromBaseUnits(sellBase, meta.decimals),
        slippageBps: user!.settings.slippageBps,
      });
      const { digest } = await this.trade.execute({ telegramId: id, prepared, signer, tradeKind: 'order' });
      await this.markDone(id, order.id);
      await this.notify(id, `✅ ${labelOf(order.kind)} filled: sold ${order.sellPercent}% of ${meta.symbol}. Tx: ${digest}`);
    }
  }

  private async markDone(id: string, orderId: string): Promise<void> {
    await this.repo.withUser(id, (u) => {
      const o = u.orders.find((x) => x.id === orderId);
      if (o) {
        o.status = 'done';
        o.lastRunAt = new Date().toISOString();
      }
    });
  }

  private async markFailed(id: string, orderId: string, error: string): Promise<void> {
    await this.repo.withUser(id, (u) => {
      const o = u.orders.find((x) => x.id === orderId);
      if (o) {
        o.status = 'failed';
        o.error = error;
        o.lastRunAt = new Date().toISOString();
      }
    });
    await this.notify(id, `⚠️ An automated order failed: ${error}`).catch(() => {});
  }
}

function labelOf(kind: OrderKind): string {
  return {
    limit_buy: 'Limit buy',
    limit_sell: 'Limit sell',
    take_profit: 'Take-profit',
    stop_loss: 'Stop-loss',
    dca: 'DCA buy',
  }[kind];
}
