import type { Bot } from 'grammy';
import type { AppConfig } from './config.js';
import { logger } from './logger.js';
import { createRepo } from './storage/index.js';
import { createSuiClient } from './sui/client.js';
import { SuiService } from './sui/service.js';
import { createSwapProvider } from './trade/factory.js';
import { PriceOracle } from './trade/priceOracle.js';
import { DexScreener } from './services/dexscreener.js';
import { ChartService } from './services/chart.js';
import { WalletService } from './services/walletService.js';
import { ReferralService } from './services/referralService.js';
import { PayoutService } from './services/payoutService.js';
import { SecurityService } from './services/security.js';
import { TradeService } from './trade/tradeService.js';
import { OrderEngine, type Notifier } from './services/orderEngine.js';
import { CopyTradeService } from './services/copyTrade.js';
import { SniperService } from './services/sniperService.js';
import { WatchlistService } from './services/watchlistService.js';
import { BundleService } from './services/bundleService.js';
import { LaunchService } from './launch/publisher.js';
import { LaunchpadClient } from './launch/launchpadClient.js';
import { BridgeService, createBridgeProvider } from './bridge/index.js';
import { SessionStore } from './bot/session.js';
import { createBot } from './bot/bot.js';
import type { BotContext, Services } from './bot/context.js';

export interface App {
  bot: Bot<BotContext>;
  services: Services;
  /** Run one pass of all automation ticks (cron). Returns a summary. */
  runCron: () => Promise<Record<string, unknown>>;
}

/**
 * Assemble the whole application from config. Shared by the long-polling CLI
 * entrypoint (src/index.ts) and the Vercel webhook/cron functions (api/*).
 */
export async function buildApp(config: AppConfig): Promise<App> {
  const repo = await createRepo(config);
  const suiClient = createSuiClient(config.rpcUrl);
  const sui = new SuiService(suiClient, config.network);
  const swap = createSwapProvider(config, suiClient);
  const oracle = new PriceOracle(swap, sui);
  const dex = new DexScreener();
  const chart = new ChartService();

  const wallet = new WalletService(repo, config.walletEncryptionKey, config.maxSubWallets);
  const referral = new ReferralService(repo, config.referralLevelBps);
  const payout = config.feeWalletSecret
    ? new PayoutService(repo, sui, config.feeWalletSecret, BigInt(Math.round(config.minReferralClaimSui * 1e9)))
    : undefined;
  const security = new SecurityService(repo, {
    rateLimitPerMin: config.rateLimitPerMin,
    maxBuySui: config.maxBuySui,
    allowedIds: config.allowedTelegramIds,
    adminIds: config.adminTelegramIds,
    enforceAllowlist: config.enforceAllowlist,
  });
  const trade = new TradeService(swap, sui, repo, referral, {
    tradingFeeBps: config.tradingFeeBps,
    displayFeeBps: config.displayFeeBps,
    feeWallet: config.feeWalletAddress,
  });

  // Notifier bridges automation → Telegram messages (wired after the bot exists).
  const holder: { send: Notifier } = { send: async () => {} };
  const notify: Notifier = (id, msg) => holder.send(id, msg);

  const orders = new OrderEngine(repo, oracle, trade, wallet, sui, security, notify);
  const copy = new CopyTradeService(repo, sui, trade, wallet, security, notify);
  const sniper = new SniperService(repo, oracle, trade, wallet, security, notify);
  const watchlist = new WatchlistService(repo, oracle, sui, notify);
  const bundle = new BundleService(wallet, trade);
  const launch = new LaunchService(sui, repo, {
    suiCliPath: config.suiCliPath || undefined,
    coinTemplatePath: config.coinTemplatePath || undefined,
  });
  const launchpad = new LaunchpadClient(suiClient, config.launchpadPackageId);
  const bridge = new BridgeService(createBridgeProvider(config));

  const services: Services = {
    config, repo, sui, oracle, dex, chart, wallet, trade, referral, payout, security,
    orders, copy, sniper, watchlist, bundle, launch, launchpad, bridge,
    sessions: new SessionStore(),
    pending: new Map(),
  };

  const bot = createBot(services);
  holder.send = async (id, msg) => {
    await bot.api.sendMessage(id, msg, { parse_mode: 'HTML' }).catch((e) => logger.warn('notify failed', { id, e: (e as Error).message }));
  };

  const runCron = async (): Promise<Record<string, unknown>> => {
    const [o, c, s, w] = await Promise.all([
      orders.tick().catch((e) => ({ error: (e as Error).message })),
      copy.tick().catch((e) => ({ error: (e as Error).message })),
      sniper.tick().catch((e) => ({ error: (e as Error).message })),
      watchlist.tick().catch((e) => ({ error: (e as Error).message })),
    ]);
    return { orders: o, copy: c, sniper: s, watchlist: w };
  };

  return { bot, services, runCron };
}
