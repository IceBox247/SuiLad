import { Bot } from 'grammy';
import type { BotContext, Services } from './context.js';
import { registerHandlers } from './handlers.js';
import { logger } from '../logger.js';

/** Build the grammY bot: attach services, enforce the allowlist, register handlers. */
export function createBot(services: Services): Bot<BotContext> {
  const bot = new Bot<BotContext>(services.config.telegramBotToken);

  // Attach services to every context.
  bot.use(async (ctx, next) => {
    (ctx as BotContext).services = services;
    await next();
  });

  // Optional allowlist.
  const allowed = services.config.allowedTelegramIds;
  if (allowed.length > 0) {
    bot.use(async (ctx, next) => {
      const from = ctx.from?.id ? String(ctx.from.id) : '';
      if (!allowed.includes(from)) {
        await ctx.reply('⛔ You are not authorized to use this bot.').catch(() => {});
        return;
      }
      await next();
    });
  }

  registerHandlers(bot);

  bot.catch((err) => {
    logger.error('bot error', { error: err.message, update: err.ctx?.update?.update_id });
  });

  return bot;
}

/** The command list shown in Telegram's UI. */
export const BOT_COMMANDS = [
  { command: 'start', description: 'Create/show your wallet & menu' },
  { command: 'wallet', description: 'Wallet details & export' },
  { command: 'balance', description: 'Show your token balances' },
  { command: 'buy', description: 'Buy a token with SUI' },
  { command: 'sell', description: 'Sell a token for SUI' },
  { command: 'price', description: 'Price a token in SUI' },
  { command: 'send', description: 'Send SUI to an address' },
  { command: 'launch', description: 'Launch a new coin' },
  { command: 'positions', description: 'Recent trades & launches' },
  { command: 'settings', description: 'Slippage & preferences' },
  { command: 'help', description: 'Show help' },
];
