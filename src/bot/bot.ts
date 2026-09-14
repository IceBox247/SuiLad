import { Bot } from 'grammy';
import type { BotContext, Services } from './context.js';
import { registerHandlers } from './handlers.js';
import { logger } from '../logger.js';

/** Build the grammY bot: attach services, enforce safety middleware, register handlers. */
export function createBot(services: Services): Bot<BotContext> {
  const bot = new Bot<BotContext>(services.config.telegramBotToken);

  // Attach services.
  bot.use(async (ctx, next) => {
    (ctx as BotContext).services = services;
    await next();
  });

  // Safety middleware: allowlist, bans, and rate limiting.
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id ? String(ctx.from.id) : '';
    if (!id) return; // ignore channel posts etc.
    try {
      if (!services.security.isAllowed(id)) {
        await ctx.reply('⛔ You are not authorized to use this bot.').catch(() => {});
        return;
      }
      if (await services.security.isBanned(id)) {
        await ctx.reply('⛔ Your access is temporarily restricted.').catch(() => {});
        return;
      }
      await services.security.enforceRate(id, 'update');
    } catch (err) {
      await ctx.reply(`⚠️ ${(err as Error).message}`).catch(() => {});
      return;
    }
    await next();
  });

  registerHandlers(bot);

  bot.catch((err) => {
    logger.error('bot error', { error: err.message, update: err.ctx?.update?.update_id });
  });

  return bot;
}

/** The command list shown in Telegram's UI / Menu button. */
export const BOT_COMMANDS = [
  { command: 'start', description: 'Open the menu / create wallet' },
  { command: 'buy', description: 'Buy a token with SUI' },
  { command: 'sell', description: 'Sell a token for SUI' },
  { command: 'positions', description: 'Positions & PnL' },
  { command: 'price', description: 'Live token price' },
  { command: 'limit', description: 'Limit / TP / SL orders' },
  { command: 'dca', description: 'Dollar-cost-average buys' },
  { command: 'copy', description: 'Copy-trade a wallet' },
  { command: 'snipe', description: 'Snipe a new token' },
  { command: 'watch', description: 'Watchlist & alerts' },
  { command: 'bundle', description: 'Buy from many wallets' },
  { command: 'launch', description: 'Launch a coin' },
  { command: 'bridge', description: 'Bridge across chains' },
  { command: 'referral', description: 'Referral link & earnings' },
  { command: 'wallet', description: 'Wallet & export key' },
  { command: 'settings', description: 'Slippage & preferences' },
  { command: 'help', description: 'Show help' },
];

/** Register commands and enable the Menu button (shows the command list). */
export async function configureBotUI(bot: Bot<BotContext>): Promise<void> {
  await bot.api.setMyCommands(BOT_COMMANDS);
  await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } }).catch(() => {});
}
