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
export function mainMenu(activeChainLabel = 'Sui'): InlineKeyboard {
  return new InlineKeyboard()
    .text(`🌐 Chain: ${activeChainLabel}`, 'chain')
    .row()
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
    .text('💸 Cashback', 'cashback')
    .text('⚙️ Settings', 'settings')
    .row()
    .text('❓ Help', 'help')
    .text('🔄 Refresh', 'home_ref');
}

export function backMenu(): InlineKeyboard {
  return new InlineKeyboard().text('⬅️ Back to menu', 'menu');
}

/** Chain picker. `chains` is [{id,label,live}]; live=false shows "soon". */
export function chainPicker(
  chains: { id: string; label: string; live: boolean }[],
  active: string,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  chains.forEach((c, i) => {
    if (i % 2 === 0) kb.row();
    const mark = c.id === active ? '✅ ' : '';
    const soon = c.live ? '' : ' (soon)';
    kb.text(`${mark}${c.label}${soon}`, c.live ? `chain:set:${c.id}` : 'chain:soon');
  });
  kb.row().text('⬅️ Back', 'menu');
  return kb;
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
    '🚀 <b>SuiPad</b> — multi-chain trading &amp; launchpad',
    '🌊 Trading on <b>Sui</b> · tap 🌐 to switch chains (Solana live)',
    '',
    `💼 Wallet: ${code(address)}`,
    `💰 Balance: <b>${esc(suiBalance)} SUI</b>`,
    '',
    'Paste a token to trade, or pick an action below.',
  ].join('\n');
}

export const HELP = [
  '<b>SuiPad — Commands</b>',
  '',
  '🌐 <b>Multi-chain</b>: trade on Sui &amp; Solana (more chains rolling out). Tap 🌐 <b>Chain</b> on the menu to switch; each chain has its own wallet.',
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
  '/bridge — bridge across chains (guided: pick from/to/token/amount)',
  '/referral — your referral link &amp; earnings',
  '/cashback — 20% of your trading fees, rebated to you',
  '',
  '<b>Account</b>',
  '/wallet • /settings • /start',
  '',
  '⚠️ Never share your private key. Use funds you can afford to lose.',
].join('\n');
