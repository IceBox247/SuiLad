import type { IncomingMessage, ServerResponse } from 'node:http';
import { getApp } from './_app.js';

/**
 * Automation tick for Vercel Cron. Runs limit/TP/SL/DCA orders, copy-trades,
 * snipes and price alerts. Configure the schedule in vercel.json and protect it
 * with CRON_SECRET (Vercel sends it as `Authorization: Bearer <CRON_SECRET>`).
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let app;
  try {
    app = await getApp();
  } catch (err) {
    res.statusCode = 500;
    res.end(`Bot not configured: ${(err as Error).message}`);
    return;
  }
  const { services, runCron } = app;
  const secret = services.config.cronSecret;
  if (secret) {
    const auth = req.headers['authorization'];
    const url = new URL(req.url ?? '', 'http://localhost');
    const provided = auth === `Bearer ${secret}` || url.searchParams.get('secret') === secret;
    if (!provided) {
      res.statusCode = 401;
      res.end('unauthorized');
      return;
    }
  }
  try {
    const summary = await runCron();
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, summary }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
  }
}
