import { loadConfig } from './config.js';
import { setLogLevel, logger } from './logger.js';
import { Store } from './storage/store.js';
import { createSuiClient } from './sui/client.js';
import { SuiService } from './sui/service.js';
import { WalletService } from './services/walletService.js';
import { createSwapProvider } from './trade/factory.js';
import { TradeService } from './trade/tradeService.js';
import { LaunchService } from './launch/publisher.js';
import { SessionStore } from './bot/session.js';
import { createBot, BOT_COMMANDS } from './bot/bot.js';
import type { Services } from './bot/context.js';

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  logger.info('Starting SuiPad', { network: config.network, swapProvider: config.swapProvider });

  const store = new Store(config.dataFile, { slippageBps: config.defaultSlippageBps });
  await store.init();

  const suiClient = createSuiClient(config.rpcUrl);
  const sui = new SuiService(suiClient, config.network);
  const wallet = new WalletService(store, config.walletEncryptionKey);
  const provider = createSwapProvider(config, suiClient);
  const trade = new TradeService(provider, sui, store, {
    platformFeeBps: config.platformFeeBps,
    platformFeeAddress: config.platformFeeAddress,
  });
  const launch = new LaunchService(sui, store, {
    suiCliPath: config.suiCliPath || undefined,
    coinTemplatePath: config.coinTemplatePath || undefined,
  });

  const services: Services = {
    config,
    store,
    sui,
    wallet,
    trade,
    launch,
    sessions: new SessionStore(),
    pending: new Map(),
  };

  const bot = createBot(services);
  await bot.api.setMyCommands(BOT_COMMANDS);

  const shutdown = () => {
    logger.info('Shutting down…');
    void bot.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.info('SuiPad is live. Talk to your bot on Telegram.');
  await bot.start({
    onStart: (info) => logger.info('Bot started', { username: info.username }),
  });
}

main().catch((err) => {
  logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
