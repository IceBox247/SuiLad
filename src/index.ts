import { loadConfig } from './config.js';
import { setLogLevel, logger } from './logger.js';
import { buildApp } from './app.js';
import { configureBotUI } from './bot/bot.js';

/**
 * Long-polling entrypoint (for local dev / a persistent server). On Vercel the
 * bot runs via api/webhook.ts + api/cron.ts instead.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  logger.info('Starting SuiPad', { network: config.network, swapProvider: config.swapProvider, storage: config.storageBackend });

  const { bot, runCron } = await buildApp(config);
  await configureBotUI(bot);

  // Local automation loop (Vercel uses cron instead).
  const cronInterval = setInterval(() => {
    void runCron().then((r) => logger.debug('cron tick', r)).catch((e) => logger.warn('cron error', { e: (e as Error).message }));
  }, 30_000);

  const shutdown = () => {
    logger.info('Shutting down…');
    clearInterval(cronInterval);
    void bot.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.info('SuiPad is live (long-polling).');
  await bot.start({ onStart: (info) => logger.info('Bot started', { username: info.username }) });
}

main().catch((err) => {
  logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
