import { InlineKeyboard } from 'grammy';
import { shortenAddress } from '../util/format.js';

/** Escape text for Telegram HTML parse mode. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Monospace/code span. */
export function code(text: string): string {
  return `<code>${esc(text)}</code>`;
}

/** A clickable link. */
export function link(text: string, url: string): string {
  return `<a href="${esc(url)}">${esc(text)}</a>`;
}

export const mainMenu = () =>
  new InlineKeyboard()
    .text('💼 Wallet', 'wallet')
    .text('📊 Balances', 'balances')
    .row()
    .text('🟢 Buy', 'buy')
    .text('🔴 Sell', 'sell')
    .row()
    .text('🚀 Launch Token', 'launch')
    .row()
    .text('⚙️ Settings', 'settings')
    .text('❓ Help', 'help');

export const backMenu = () => new InlineKeyboard().text('⬅️ Back to menu', 'menu');

export const confirmCancel = (confirmData: string) =>
  new InlineKeyboard().text('✅ Confirm', confirmData).text('❌ Cancel', 'cancel');

export const walletMenu = (address: string) =>
  new InlineKeyboard()
    .url('🔎 Explorer', `https://suiscan.xyz/mainnet/account/${address}`)
    .row()
    .text('📥 Deposit', 'deposit')
    .text('📤 Send', 'send')
    .row()
    .text('🔑 Export key', 'export')
    .row()
    .text('⬅️ Back', 'menu');

/** Render an address as a shortened, copy-friendly code span. */
export function addrLabel(address: string): string {
  return `${code(address)}\n<i>${shortenAddress(address)}</i>`;
}

export const WELCOME = (address: string) =>
  [
    '🚀 <b>Welcome to SuiPad</b>',
    '',
    'Your all-in-one Telegram bot to <b>trade</b> and <b>launch</b> tokens on the Sui network.',
    '',
    'Your wallet address:',
    code(address),
    '',
    '💡 <i>Fund this address with SUI to start trading. Tap a button below.</i>',
  ].join('\n');

export const HELP = [
  '<b>SuiPad — Commands</b>',
  '',
  '/start — create/show your wallet & menu',
  '/wallet — wallet details & export',
  '/balance — show your token balances',
  '/buy <code>&lt;coinType&gt;</code> — buy a token with SUI',
  '/sell — sell a token back to SUI',
  '/price <code>&lt;coinType&gt;</code> — price a token in SUI',
  '/send — transfer SUI or a token',
  '/launch — create & deploy a new coin',
  '/positions — recent trades & launches',
  '/settings — slippage & preferences',
  '/help — this message',
  '',
  '⚠️ <b>Security</b>: SuiPad stores your key encrypted. Never share your private key. ',
  'Use a burner wallet for small amounts you can afford to lose.',
].join('\n');
