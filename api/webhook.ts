import { webhookCallback } from 'grammy';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getApp } from './_app.js';

/**
 * Telegram webhook endpoint for Vercel. Set the webhook to
 *   https://<your-app>.vercel.app/api/webhook
 * with a secret token equal to WEBHOOK_SECRET (see scripts/set-webhook.ts).
 *
 * SECURITY: this endpoint FAILS CLOSED. Without WEBHOOK_SECRET configured,
 * anyone who knows the URL could POST forged Telegram updates (spoofing any
 * user's telegram id) and drive that user's wallet. We therefore refuse to
 * process updates unless a secret token is configured AND matches.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { bot, services } = await getApp();
  const secret = services.config.webhookSecret;
  if (!secret) {
    res.statusCode = 500;
    res.end('WEBHOOK_SECRET is not configured; refusing to process webhook updates.');
    return;
  }
  // grammy validates the X-Telegram-Bot-Api-Secret-Token header against `secret`
  // and rejects mismatches with 401 before any update is processed.
  const callback = webhookCallback(bot, 'http', { secretToken: secret });
  return callback(req, res);
}
