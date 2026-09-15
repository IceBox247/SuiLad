import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Update } from 'grammy/types';
import { getApp } from './_app.js';
import { logger } from '../src/logger.js';

/**
 * Telegram webhook endpoint for Vercel.
 *
 * We deliberately do NOT use grammY's stream-reading webhook adapter here:
 * Vercel's Node runtime pre-parses the JSON body, so the stream is already
 * consumed and the adapter would hang / never reply. Instead we read the update
 * from the parsed `req.body` (falling back to reading the stream locally) and
 * hand it to `bot.handleUpdate` directly.
 *
 * SECURITY: fails closed — requires WEBHOOK_SECRET and validates Telegram's
 * `X-Telegram-Bot-Api-Secret-Token` header before processing anything.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let app;
  try {
    app = await getApp();
  } catch (err) {
    // Surface config/boot errors (e.g. missing env vars) as a readable message
    // instead of an opaque FUNCTION_INVOCATION_FAILED.
    logger.error('app boot failed', { error: (err as Error).message });
    res.statusCode = 500;
    res.end(`Bot not configured: ${(err as Error).message}`);
    return;
  }
  const { bot, services } = app;

  const secret = services.config.webhookSecret;
  if (!secret) {
    res.statusCode = 500;
    res.end('WEBHOOK_SECRET is not configured; refusing to process webhook updates.');
    return;
  }
  const header = req.headers['x-telegram-bot-api-secret-token'];
  if (header !== secret) {
    res.statusCode = 401;
    res.end('unauthorized');
    return;
  }

  let update: Update | undefined;
  const parsed = (req as IncomingMessage & { body?: unknown }).body;
  if (parsed && typeof parsed === 'object') {
    update = parsed as Update;
  } else if (typeof parsed === 'string' && parsed) {
    update = JSON.parse(parsed) as Update;
  } else {
    update = await readJsonBody(req);
  }

  // Always ACK Telegram quickly; process the update, log failures.
  res.statusCode = 200;
  res.end('ok');
  if (!update) return;
  try {
    await bot.handleUpdate(update);
  } catch (err) {
    logger.error('handleUpdate failed', { error: (err as Error).message });
  }
}

function readJsonBody(req: IncomingMessage): Promise<Update | undefined> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as Update) : undefined);
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}
