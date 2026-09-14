/**
 * Register (or clear) the Telegram webhook for the Vercel deployment.
 *
 *   PUBLIC_URL=https://your-app.vercel.app WEBHOOK_SECRET=... npx tsx scripts/set-webhook.ts
 *   npx tsx scripts/set-webhook.ts --delete     # switch back to long-polling
 */
import { loadConfig } from '../src/config.js';

async function main() {
  const config = loadConfig();
  const api = `https://api.telegram.org/bot${config.telegramBotToken}`;

  if (process.argv.includes('--delete')) {
    const r = await fetch(`${api}/deleteWebhook`, { method: 'POST' });
    console.log('deleteWebhook:', await r.json());
    return;
  }
  if (!config.publicUrl) throw new Error('Set PUBLIC_URL to your deployment URL (e.g. https://app.vercel.app).');

  const url = `${config.publicUrl.replace(/\/$/, '')}/api/webhook`;
  const body: Record<string, unknown> = { url, drop_pending_updates: true };
  if (config.webhookSecret) body.secret_token = config.webhookSecret;

  const r = await fetch(`${api}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log('setWebhook:', await r.json());

  // Publish the command list + Menu button.
  await fetch(`${api}/setChatMenuButton`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ menu_button: { type: 'commands' } }),
  });
  console.log('Menu button set to command list.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
