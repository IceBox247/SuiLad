import { InlineKeyboard } from 'grammy';
import { shortenAddress } from '../util/format.js';

/** Escape text for Telegram HTML parse mode. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function code(text: string): string {
  return `<code>${esc(text)}</code>`;
}
export function link(text: string, url: string): string {
  return `<a href="${esc(url)}">${esc(text)}</a>`;
}

/** The main dashboard keyboard — the "menu" users navigate from. */
export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🟢 Buy', 'buy')
    .text('🔴 Sell', 'sell')
    .row()
    .text('📊 Positions', 'positions')
    .text('💼 Wallet', 'wallet')
    .row()
    .text('🎯 Limit/DCA', 'orders')
    .text('👥 Copy Trade', 'copy')
    .row()
    .text('🔫 Sniper', 'sniper')
    .text('⭐ Watchlist', 'watchlist')
    .row()
    .text('🧺 Bundle Buy', 'bundle')
    .text('🚀 Launch', 'launch')
    .row()
    .text('🌉 Bridge', 'bridge')
    .text('🎁 Referrals', 'referral')
    .row()
    .text('⚙️ Settings', 'settings')
    .text('❓ Help', 'help');
}

export function backMenu(): InlineKeyboard {
  return new InlineKeyboard().text('⬅️ Back to menu', 'menu');
}

export function confirmCancel(confirmData: string): InlineKeyboard {
  return new InlineKeyboard().text('✅ Confirm', confirmData).text('❌ Cancel', 'cancel');
}

export function walletMenu(address: string, network: string): InlineKeyboard {
  const explorer = `https://suiscan.xyz/${network === 'mainnet' ? 'mainnet' : network}/account/${address}`;
  return new InlineKeyboard()
    .url('🔎 Explorer', explorer)
    .text('📤 Send', 'send')
    .row()
    .text('🧺 Sub-wallets', 'subwallets')
    .text('🔑 Export key', 'export')
    .row()
    .text('⬅️ Back', 'menu');
}

export function addrLabel(address: string): string {
  return `${code(address)}\n<i>${shortenAddress(address)}</i>`;
}

export function homeText(address: string, suiBalance: string): string {
  return [
    '🚀 <b>SuiPad</b> — trade &amp; launch on Sui',
    '',
    `💼 Wallet: ${code(address)}`,
    `💰 Balance: <b>${esc(suiBalance)} SUI</b>`,
    '',
    'Pick an action below. Tap the <b>Menu</b> button anytime for all commands.',
  ].join('\n');
}

export const HELP = [
  '<b>SuiPad — Commands</b>',
  '',
  '<b>Trading</b>',
  '/buy <code>&lt;coin&gt;</code> — buy a token with SUI',
  '/sell — sell a held token for SUI',
  '/price <code>&lt;coin&gt;</code> — live price',
  '/positions — your positions &amp; PnL',
  '',
  '<b>Automation</b>',
  '/limit — limit buy / sell',
  '/dca — dollar-cost-average buys',
  '/tp <code>&lt;coin&gt;</code> — take-profit • /sl — stop-loss',
  '/copy <code>&lt;address&gt;</code> — copy a wallet',
  '/snipe <code>&lt;coin&gt;</code> — auto-buy when live',
  '/watch <code>&lt;coin&gt;</code> — watchlist &amp; alerts',
  '',
  '<b>Advanced</b>',
  '/bundle — buy from many wallets at once',
  '/launch — launch a coin (bonding curve)',
  '/bridge — bridge across chains',
  '/referral — your referral link &amp; earnings',
  '',
  '<b>Account</b>',
  '/wallet • /settings • /start',
  '',
  '⚠️ Never share your private key. Use funds you can afford to lose.',
].join('\n');
