import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from './context.js';
import { HELP, addrLabel, backMenu, chainPicker, code, confirmCancel, esc, homeText, link, mainMenu, walletMenu } from './ui.js';
import { CHAINS, ALL_CHAINS } from '../chains/meta.js';
import type { ChainId } from '../chains/types.js';
import { SUI_TYPE } from '../sui/service.js';
import { isValidCoinType, isValidSuiAddress, isPositiveAmount, normalizeSuiAddress } from '../util/validate.js';
import { isValidSecretKey } from '../sui/wallet.js';
import { formatAmount, fromBaseUnits, shortenAddress, toBaseUnits } from '../util/format.js';
import { formatUsd, formatPct } from '../services/dexscreener.js';
import type { PreparedQuote } from '../trade/tradeService.js';
import type { LaunchParams } from '../launch/types.js';
import { PriceOracle } from '../trade/priceOracle.js';

const tgId = (ctx: BotContext): string => String(ctx.from?.id ?? '');

function guard(fn: (ctx: BotContext) => Promise<void>) {
  return async (ctx: BotContext) => {
    try {
      await fn(ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`⚠️ ${esc(msg)}`, { parse_mode: 'HTML' }).catch(() => {});
    }
  };
}

async function ensureWallet(ctx: BotContext): Promise<string> {
  const id = tgId(ctx);
  if (!(await ctx.services.wallet.hasWallet(id))) await ctx.services.wallet.create(id);
  return id;
}

async function home(ctx: BotContext, edit = false): Promise<void> {
  const id = await ensureWallet(ctx);
  const chain = await ctx.services.multiWallet.getActiveChain(id);
  const meta = CHAINS[chain];

  let text: string;
  if (chain === 'sui') {
    const address = (await ctx.services.wallet.getAddress(id))!;
    const bal = await ctx.services.sui.getBalance(address, SUI_TYPE).catch(() => 0n);
    text = homeText(address, formatAmount(bal, 9));
  } else {
    const adapter = ctx.services.adapters[chain]!;
    const address = await ctx.services.multiWallet.ensureWallet(id, chain);
    const bal = await adapter.getNativeBalance(address).catch(() => 0n);
    text = [
      `${meta.icon} <b>SuiPad</b> — trading on <b>${esc(meta.name)}</b>`,
      '',
      `💼 Wallet: ${code(address)}`,
      `💰 Balance: <b>${esc(formatAmount(bal, meta.nativeDecimals))} ${esc(meta.nativeSymbol)}</b>`,
      '',
      `Paste a token address to trade on ${esc(meta.name)}. Tap 🌐 to switch chains.`,
    ].join('\n');
  }

  const opts = { parse_mode: 'HTML' as const, reply_markup: mainMenu(meta.name), link_preview_options: { is_disabled: true } };
  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, opts).catch((e) => {
      if (!/message is not modified/i.test((e as Error).message)) throw e;
    });
    return;
  }
  await ctx.reply(text, opts);
}

// --- Chain selector ---------------------------------------------------------

const LIVE_CHAINS: ChainId[] = ['sui', 'solana', 'ethereum', 'base', 'arbitrum', 'polygon', 'bsc', 'arc'];

async function showChainPicker(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const active = await ctx.services.multiWallet.getActiveChain(id);
  const chains = ALL_CHAINS.map((c) => ({ id: c, label: `${CHAINS[c].icon} ${CHAINS[c].name}`, live: LIVE_CHAINS.includes(c) }));
  const text = [
    '🌐 <b>Choose a chain</b>',
    '',
    `Currently trading on: <b>${esc(CHAINS[active].name)}</b>`,
    '',
    'Live: <b>Sui · Solana · Ethereum · Base · Arbitrum · Polygon · BNB · Arc</b>.',
    'Stable · TON · Tron: wallets &amp; balances live, trading rolling out.',
  ].join('\n');
  const kb = chainPicker(chains, active);
  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }).catch(async () => {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

async function setChain(ctx: BotContext, chain: ChainId): Promise<void> {
  const id = await ensureWallet(ctx);
  await ctx.services.multiWallet.setActiveChain(id, chain);
  if (chain !== 'sui') await ctx.services.multiWallet.ensureWallet(id, chain);
  await home(ctx, true);
}

// --- Wallet / positions / settings -----------------------------------------

async function showWallet(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const chain = await ctx.services.multiWallet.getActiveChain(id);
  if (chain !== 'sui') {
    const meta = CHAINS[chain];
    const adapter = ctx.services.adapters[chain]!;
    const address = await ctx.services.multiWallet.ensureWallet(id, chain);
    const bal = await adapter.getNativeBalance(address).catch(() => 0n);
    const kb = new InlineKeyboard()
      .url('🔎 Explorer', adapter.explorerAddress(address))
      .text('🔑 Export key', `export:${chain}`)
      .row()
      .text('🌐 Switch chain', 'chain').text('⬅️ Back', 'menu');
    await ctx.reply(
      [`${meta.icon} <b>Your ${esc(meta.name)} Wallet</b>`, '', addrLabel(address), '', `Balance: <b>${esc(formatAmount(bal, meta.nativeDecimals))} ${esc(meta.nativeSymbol)}</b>`].join('\n'),
      { parse_mode: 'HTML', reply_markup: kb },
    );
    return;
  }
  const address = (await ctx.services.wallet.getAddress(id))!;
  const bal = await ctx.services.sui.getBalance(address, SUI_TYPE).catch(() => 0n);
  await ctx.reply(
    ['💼 <b>Your Wallet</b>', '', addrLabel(address), '', `Balance: <b>${esc(formatAmount(bal, 9))} SUI</b>`].join('\n'),
    { parse_mode: 'HTML', reply_markup: walletMenu(address, ctx.services.config.network) },
  );
}

async function showPositions(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const chain = await ctx.services.multiWallet.getActiveChain(id);
  if (chain !== 'sui') {
    await showChainPositions(ctx, chain);
    return;
  }
  const address = (await ctx.services.wallet.getAddress(id))!;
  const holdings = await ctx.services.sui.getHoldings(address).catch(() => []);
  const u = await ctx.services.repo.getUser(id);
  const lines: string[] = ['📊 <b>Positions</b>', ''];
  const kb = new InlineKeyboard();
  // Non-SUI tokens become tappable buttons that open the full token card.
  const tokens = holdings.filter((h) => h.coinType !== SUI_TYPE);
  await ctx.services.repo.setMeta(`toklist:${id}`, JSON.stringify(tokens.map((t) => t.coinType))).catch(() => {});

  if (holdings.length === 0) lines.push('<i>No balances yet. Fund your wallet with SUI.</i>');
  for (const h of holdings) {
    const pos = u?.positions.find((p) => p.coinType === h.coinType);
    const pnl = pos && BigInt(pos.realizedPnlMist) !== 0n ? ` • PnL ${formatAmount(BigInt(pos.realizedPnlMist), 9)} SUI` : '';
    lines.push(`• <b>${esc(h.symbol)}</b>: ${esc(h.formatted)}${esc(pnl)}`);
  }
  if (tokens.length > 0) lines.push('', '👇 Tap a token for full details, chart & trade:');
  tokens.forEach((t, i) => {
    if (i % 2 === 0) kb.row();
    kb.text(`${t.symbol} • ${t.formatted}`, `tok:${i}`);
  });
  kb.row().text('🔄 Refresh', 'positions').text('⬅️ Menu', 'menu');
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

/** Positions view for a non-Sui chain: tracked holdings + realized PnL. */
async function showChainPositions(ctx: BotContext, chain: ChainId): Promise<void> {
  const id = tgId(ctx);
  const meta = CHAINS[chain];
  const adapter = ctx.services.adapters[chain]!;
  const address = await ctx.services.multiWallet.ensureWallet(id, chain);
  const u = await ctx.services.repo.getUser(id);
  const nativeBal = await adapter.getNativeBalance(address).catch(() => 0n);
  const positions = Object.entries(u?.chainPositions ?? {})
    .filter(([k]) => k.startsWith(`${chain}:`))
    .map(([, p]) => p)
    .filter((p) => BigInt(p.amount) > 0n || Number(p.realizedUsd) !== 0);

  const lines: string[] = [`📊 <b>Positions — ${esc(meta.name)}</b>`, '', `💵 <b>Balance:</b> ${esc(formatAmount(nativeBal, meta.nativeDecimals))} ${esc(meta.nativeSymbol)}`, ''];
  if (positions.length === 0) lines.push('<i>No tracked positions yet. Paste a token to trade.</i>');
  const kb = new InlineKeyboard();
  for (const p of positions) {
    const realized = Number(p.realizedUsd);
    const rl = Math.abs(realized) > 1e-6 ? ` • realized ${realized >= 0 ? '+' : '-'}$${Math.abs(realized).toPrecision(3)}` : '';
    lines.push(`• <b>${esc(p.symbol)}</b>: ${esc(formatAmount(BigInt(p.amount), p.decimals))}${esc(rl)}`);
  }
  positions.forEach((p, i) => {
    if (i % 2 === 0) kb.row();
    kb.text(`${p.symbol}`, `xt:${p.token}`);
  });
  kb.row().text('🔄 Refresh', 'positions').text('⬅️ Menu', 'menu');
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

async function showSettings(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const u = (await ctx.services.repo.getUser(id))!;
  const autoBuy = u.settings.autoBuy;
  const kb = new InlineKeyboard()
    .text(`⚡ Auto-Buy: ${autoBuy ? 'ON' : 'OFF'}`, 'toggle_autobuy')
    .text(`Auto-Buy amt: ${esc(u.settings.autoBuySui ?? '1')} SUI`, 'set_autobuy')
    .row()
    .text(`Slippage: ${u.settings.slippageBps / 100}%`, 'set_slippage')
    .text(`MEV: ${u.settings.mevProtection ? 'ON' : 'OFF'}`, 'toggle_mev')
    .row()
    .text('⬅️ Back', 'menu');
  await ctx.reply(
    [
      '⚙️ <b>Settings</b>',
      '',
      `⚡ Auto-Buy: <b>${autoBuy ? 'ON' : 'OFF'}</b>${autoBuy ? ` — pasting a token instantly buys <b>${esc(u.settings.autoBuySui ?? '1')} SUI</b>` : ''}`,
      `Slippage: <b>${u.settings.slippageBps / 100}%</b>`,
      `MEV protection: <b>${u.settings.mevProtection ? 'on' : 'off'}</b>`,
      `Network: <b>${esc(ctx.services.config.network)}</b>`,
      `Trading fee: <b>${ctx.services.config.displayFeeBps / 100}%</b>`,
      '',
      autoBuy
        ? '⚠️ With Auto-Buy ON, pasting any coin type spends real SUI immediately.'
        : '💡 Turn Auto-Buy ON for instant snipes: paste a token → it buys your set amount.',
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: kb },
  );
}

async function showReferral(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const summary = await ctx.services.referral.summary(id);
  const botUser = ctx.me?.username ?? 'YourBot';
  const url = `https://t.me/${botUser}?start=${summary?.code ?? ''}`;
  const levels = ctx.services.config.referralLevelBps.map((b) => `${b / 100}%`).join(' / ');
  await ctx.reply(
    [
      '🎁 <b>Referrals</b>',
      '',
      `Your link:\n${code(url)}`,
      '',
      `Unclaimed: <b>${formatAmount(summary?.unclaimedMist ?? 0n, 9)} SUI</b>`,
      `Lifetime: <b>${formatAmount(summary?.totalEarnedMist ?? 0n, 9)} SUI</b>`,
      `Downline: ${summary?.levelCounts.join(' / ') ?? '0'} (L1–L5)`,
      '',
      `You earn ${levels} of the platform fee across 5 levels.`,
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💸 Claim', 'ref_claim').row().text('⬅️ Back', 'menu') },
  );
}

async function showCashback(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const s = await ctx.services.cashback.summary(id);
  const minClaim = ctx.services.config.minReferralClaimSui;
  const canClaim = ctx.services.payout && Number(formatAmount(s.unclaimedMist, 9)) >= minClaim;
  const kb = new InlineKeyboard();
  if (ctx.services.payout) kb.text('💸 Claim', 'cashback_claim').row();
  kb.text('⬅️ Back', 'menu');
  await ctx.reply(
    [
      '💸 <b>Cashback</b>',
      '',
      `You get <b>${s.rateBps / 100}% of every trading fee</b> you pay back as cashback — automatically, on every trade.`,
      '',
      `Unclaimed: <b>${formatAmount(s.unclaimedMist, 9)} SUI</b>`,
      `Lifetime: <b>${formatAmount(s.totalMist, 9)} SUI</b>`,
      '',
      ctx.services.payout
        ? canClaim
          ? '✅ Tap Claim to receive your cashback on-chain.'
          : `Minimum to claim: <b>${minClaim} SUI</b>. Keep trading to earn more.`
        : 'ℹ️ Cashback accrues now; on-chain claims enable once the operator configures payouts.',
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: kb },
  );
}

async function showSubwallets(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const wallets = await ctx.services.wallet.allWallets(id);
  const lines = ['🧺 <b>Sub-wallets</b> (for bundling)', ''];
  for (const w of wallets) lines.push(`• <b>${esc(w.label)}</b>: ${code(w.address)}`);
  const kb = new InlineKeyboard().text('➕ Add sub-wallet', 'subwallet_add').row().text('⬅️ Back', 'wallet');
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

// --- Buy / sell -------------------------------------------------------------

/** Quick-buy amount presets (SUI). */
const QUICK_BUY_SUI = ['0.5', '1', '2', '5'];

/**
 * Build the "avg entry + unrealized PnL since hold" lines for a tracked
 * position, denominated in the native quote token. `priceNative` is the current
 * price in native units per token; `heldBase` is the on-chain balance. Returns
 * [] when there's nothing tracked to compare against.
 */
function pnlLines(
  pos: import('../storage/types.js').Position | undefined,
  heldBase: bigint,
  priceNative: number,
  decimals: number,
  nativeSymbol: string,
  nativeDecimals: number,
): string[] {
  if (!pos || BigInt(pos.amount) <= 0n || priceNative <= 0) return [];
  const amountTokens = Number(BigInt(pos.amount)) / 10 ** decimals;
  const costNative = Number(BigInt(pos.costMist)) / 10 ** nativeDecimals;
  if (amountTokens <= 0 || costNative <= 0) return [];
  const avgEntry = costNative / amountTokens;
  const curValue = priceNative * amountTokens;
  const pnl = curValue - costNative;
  const pnlPct = (curValue / costNative - 1) * 100;
  const up = pnl >= 0;
  const sign = up ? '+' : '';
  const arrow = up ? '🟢' : '🔴';
  const lines = [
    `🎯 <b>Avg Entry:</b>  ${avgEntry.toPrecision(4)} ${nativeSymbol}`,
    `${arrow} <b>PnL:</b>  ${sign}${pnl.toPrecision(3)} ${nativeSymbol}  (${sign}${pnlPct.toFixed(1)}%)`,
  ];
  const realized = Number(BigInt(pos.realizedPnlMist)) / 10 ** nativeDecimals;
  if (Math.abs(realized) > 1e-9) {
    lines.push(`💰 <b>Realized:</b>  ${realized >= 0 ? '+' : ''}${realized.toPrecision(3)} ${nativeSymbol}`);
  }
  return lines;
}

/**
 * Render a rich token card (chart image + price, market cap, liquidity, volume,
 * price change, holdings) with quick-buy buttons. `edit=true` updates the
 * existing message in place (used by Refresh) instead of posting a new one.
 */
async function promptBuyAmount(ctx: BotContext, coinType: string, edit = false): Promise<void> {
  const id = tgId(ctx);
  // Remember which token this user is looking at (survives serverless cold
  // starts, so the quick-buy buttons work), and set up the custom-amount flow.
  ctx.services.sessions.set(id, { flow: 'buy_amount', data: { coinType } });
  await ctx.services.repo.setMeta(`buytok:${id}`, coinType).catch(() => {});

  const [meta, address, info, user] = await Promise.all([
    ctx.services.sui.getCoinMeta(coinType),
    ctx.services.wallet.getAddress(id),
    ctx.services.dex.token(coinType).catch(() => null),
    ctx.services.repo.getUser(id),
  ]);
  const autoBuyOn = user?.settings.autoBuy ?? false;
  const autoBuyAmt = user?.settings.autoBuySui ?? '1';
  const [priceNum, suiBal, held, chartUrl] = await Promise.all([
    ctx.services.oracle.priceNumber(coinType).catch(() => null),
    ctx.services.sui.getBalance(address!, SUI_TYPE).catch(() => 0n),
    ctx.services.sui.getBalance(address!, coinType).catch(() => 0n),
    info?.pairAddress ? ctx.services.chart.chartUrl(info.pairAddress, info.chainId).catch(() => null) : Promise.resolve(null),
  ]);

  const priceSui = info?.priceNative || priceNum || 0;
  const lines: string[] = [`🪙 <b>${esc(info?.name ?? meta.name)}</b>  •  <b>$${esc(info?.symbol ?? meta.symbol)}</b>`, ''];

  if (info) {
    const pooled = info.pooledSui.toLocaleString('en-US', { maximumFractionDigits: 0 });
    lines.push(
      `💰 <b>Price:</b>  $${info.priceUsd.toPrecision(4)}  ·  ${priceSui.toPrecision(4)} SUI`,
      `💡 <b>Market Cap:</b>  ${formatUsd(info.mcUsd)}`,
      `💧 <b>Liquidity:</b>  ${formatUsd(info.liquidityUsd)}`,
      `🌊 <b>Pooled:</b>  ${pooled} SUI`,
      `📊 <b>Volume 24h:</b>  ${formatUsd(info.volume24)}`,
      `🏦 <b>DEX:</b>  ${esc(info.dexId)}`,
      `🔁 <b>Txns 24h:</b>  ${info.buys24} 🟢  /  ${info.sells24} 🔴`,
      '',
      `📈 <b>1h</b> ${formatPct(info.change1h)}`,
      `📉 <b>6h</b> ${formatPct(info.change6h)}`,
      `🕐 <b>24h</b> ${formatPct(info.change24h)}`,
    );
  } else {
    lines.push(
      priceSui > 0 ? `💰 <b>Price:</b>  ${priceSui.toPrecision(6)} SUI` : '💰 <b>Price:</b>  <i>no pool / liquidity yet</i>',
      '<i>No market data yet — very new or not on a DEX.</i>',
    );
  }

  lines.push('', `📋 <b>CA</b> (tap to copy)`, code(coinType));
  if (info?.pairAddress) lines.push('', `🏊 <b>LP:</b>  ${code(shortenAddress(info.pairAddress, 8, 6))}`);
  lines.push('');
  if (held > 0n) {
    lines.push(`👜 <b>Holding:</b>  ${esc(formatAmount(held, meta.decimals))} ${esc(meta.symbol)}`);
    const pos = user?.positions.find((p) => p.coinType === coinType);
    for (const l of pnlLines(pos, held, priceSui, meta.decimals, 'SUI', 9)) lines.push(l);
  }
  lines.push(`💵 <b>Balance:</b>  ${esc(formatAmount(suiBal, 9))} SUI`, '', '👇 <b>Tap an amount to buy</b>, or type a custom amount:');
  const text = lines.join('\n');

  const net = ctx.services.config.network === 'mainnet' ? 'mainnet' : ctx.services.config.network;
  const suiscan = `https://suiscan.xyz/${net}/coin/${coinType}`;
  const xSearch = `https://x.com/search?q=${encodeURIComponent('$' + (info?.symbol ?? meta.symbol))}`;

  const kb = new InlineKeyboard();
  kb.text(`🟢 ${QUICK_BUY_SUI[0]} SUI`, `qb:${QUICK_BUY_SUI[0]}`).text(`🟢 ${QUICK_BUY_SUI[1]} SUI`, `qb:${QUICK_BUY_SUI[1]}`).row();
  kb.text(`🟢 ${QUICK_BUY_SUI[2]} SUI`, `qb:${QUICK_BUY_SUI[2]}`).text(`🟢 ${QUICK_BUY_SUI[3]} SUI`, `qb:${QUICK_BUY_SUI[3]}`).row();
  kb.text('✏️ Buy X', 'qb:x').text('🔴 Sell', 'qb:sell').row();
  kb.text('🎯 Limit', 'qb:lim').text(`⚙️ Slippage ${(user?.settings.slippageBps ?? ctx.services.config.defaultSlippageBps) / 100}%`, 'set_slippage').row();
  kb.text(`⚡ Auto-Buy: ${autoBuyOn ? `ON (${autoBuyAmt})` : 'OFF'}`, 'qb:auto').row();
  kb.url('📊 Chart', info?.url ?? suiscan).url('🔎 Suiscan', suiscan).url('𝕏 Search', xSearch).row();
  kb.text('🔄 Refresh', 'qb:ref').text('⬅️ Menu', 'menu');

  await renderCard(ctx, { text, kb, chartUrl, edit });
}

/**
 * Send the card as a chart photo (with caption) when an image is available,
 * else as text. On `edit`, update the existing message in place (Refresh) —
 * never post a new one. Ignores the harmless "message is not modified" error.
 */
async function renderCard(
  ctx: BotContext,
  opts: { text: string; kb: InlineKeyboard; chartUrl: string | null; edit: boolean },
): Promise<void> {
  const { text, kb, chartUrl, edit } = opts;
  try {
    if (edit) {
      const msg = ctx.callbackQuery?.message;
      const isPhoto = Boolean(msg && 'photo' in msg && msg.photo);
      if (chartUrl && isPhoto) {
        await ctx.editMessageMedia(
          { type: 'photo', media: chartUrl, caption: text, parse_mode: 'HTML' },
          { reply_markup: kb },
        );
      } else if (isPhoto) {
        await ctx.editMessageCaption({ caption: text, parse_mode: 'HTML', reply_markup: kb });
      } else {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });
      }
      return;
    }
    if (chartUrl) {
      await ctx.replyWithPhoto(chartUrl, { caption: text, parse_mode: 'HTML', reply_markup: kb });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });
    }
  } catch (err) {
    const m = (err as Error).message ?? '';
    if (/message is not modified/i.test(m)) return;
    // Editing can fail if the message type changed; fall back to a fresh card.
    if (edit) {
      if (chartUrl) await ctx.replyWithPhoto(chartUrl, { caption: text, parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
      else await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } }).catch(() => {});
      return;
    }
    throw err;
  }
}

/** Execute an instant quick-buy of the user's current token for `amountSui`. */
async function quickBuy(ctx: BotContext, amountSui: string): Promise<void> {
  const id = tgId(ctx);
  const coinType = (await ctx.services.repo.getMeta(`buytok:${id}`)) ?? '';
  if (!coinType) {
    await ctx.reply('That token expired. Paste the coin type again.', { reply_markup: backMenu() });
    return;
  }
  ctx.services.security.assertBuyWithinCap(Number(amountSui));
  const u = (await ctx.services.repo.getUser(id))!;
  await ctx.reply(`⏳ Buying <b>${esc(amountSui)} SUI</b>…`, { parse_mode: 'HTML' });
  const prepared = await ctx.services.trade.prepareQuote({
    inputType: SUI_TYPE,
    outputType: coinType,
    humanAmount: amountSui,
    slippageBps: u.settings.slippageBps,
  });
  const signer = await ctx.services.wallet.getKeypair(id);
  const { digest } = await ctx.services.trade.execute({ telegramId: id, prepared, signer });
  await ctx.reply(
    `✅ Bought <b>~${esc(prepared.display.amountOut)} ${esc(prepared.outputMeta.symbol)}</b> for ${esc(amountSui)} SUI\n${link('View transaction', ctx.services.sui.txUrl(digest))}`,
    { parse_mode: 'HTML', reply_markup: mainMenu() },
  );
}

// --- Generic non-Sui chain trading (Solana, EVM, …) -------------------------

/** Native quick-buy presets per chain (in native token units). */
const QUICK_PRESETS: Partial<Record<ChainId, string[]>> = {
  solana: ['0.1', '0.5', '1', '5'],
  ethereum: ['0.01', '0.05', '0.1', '0.5'],
  base: ['0.01', '0.05', '0.1', '0.5'],
  arbitrum: ['0.01', '0.05', '0.1', '0.5'],
  polygon: ['5', '25', '100', '500'],
  bsc: ['0.05', '0.1', '0.5', '1'],
  tron: ['20', '100', '500', '1000'],
  ton: ['1', '5', '25', '100'],
  arc: ['5', '10', '25', '100'],
  stable: ['5', '10', '25', '100'],
};

/** USD-denominated PnL lines for a non-Sui position at the given live USD price. */
function chainPnlLines(cp: import('../storage/types.js').ChainPosition, priceUsd: number): string[] {
  const lines: string[] = [];
  const amount = Number(BigInt(cp.amount)) / 10 ** cp.decimals;
  const cost = Number(cp.costUsd);
  if (amount > 0 && cost > 0 && priceUsd > 0) {
    const avgEntry = cost / amount;
    const curValue = priceUsd * amount;
    const pnl = curValue - cost;
    const pct = (curValue / cost - 1) * 100;
    const up = pnl >= 0;
    const s = up ? '+' : '';
    lines.push(
      `🎯 <b>Avg Entry:</b>  $${avgEntry.toPrecision(4)}`,
      `${up ? '🟢' : '🔴'} <b>PnL:</b>  ${s}$${Math.abs(pnl).toPrecision(3)}  (${s}${pct.toFixed(1)}%)`,
    );
  }
  const realized = Number(cp.realizedUsd);
  if (Math.abs(realized) > 0.000001) lines.push(`💰 <b>Realized:</b>  ${realized >= 0 ? '+' : '-'}$${Math.abs(realized).toPrecision(3)}`);
  return lines;
}

/** Resolve the active non-Sui chain context, or null when on Sui. */
async function activeNonSui(ctx: BotContext): Promise<{ chain: ChainId; adapter: import('../chains/types.js').ChainAdapter; meta: typeof CHAINS[ChainId] } | null> {
  const chain = await ctx.services.multiWallet.getActiveChain(tgId(ctx));
  const adapter = ctx.services.adapters[chain];
  if (chain === 'sui' || !adapter) return null;
  return { chain, adapter, meta: CHAINS[chain] };
}

/** True when `text` is a valid token address on `chain`. */
function isChainToken(ctx: BotContext, text: string, chain: ChainId): boolean {
  const a = ctx.services.adapters[chain];
  if (!a) return false;
  if (chain === 'solana' && (text.includes('::') || text.startsWith('0x'))) return false;
  return a.isValidAddress(text);
}

/** Gas headroom to keep in base units so a native-in buy can still pay fees. */
function gasBuffer(meta: typeof CHAINS[ChainId]): bigint {
  if (meta.family === 'solana') return 5_000_000n; // 0.005 SOL
  // Stablecoin-gas chains (Arc/Stable): keep ~0.05 of the base token for two txs.
  if (meta.nativeErc20) return 10n ** BigInt(meta.nativeDecimals) / 20n;
  return 10n ** BigInt(meta.nativeDecimals) / 500n; // ~0.2% of one native token
}

/** Rich token card for any non-Sui chain: real mevx chart + native quick-buy. */
async function chainCard(ctx: BotContext, token: string, edit = false): Promise<void> {
  const id = tgId(ctx);
  const cc = await activeNonSui(ctx);
  if (!cc) return;
  const { chain, adapter, meta } = cc;
  await ctx.services.repo.setMeta(`xtok:${id}`, `${chain}\n${token}`).catch(() => {});

  const address = await ctx.services.multiWallet.ensureWallet(id, chain);
  const [info, tokMeta, nativeBal, held] = await Promise.all([
    ctx.services.dex.token(token, meta.dexScreenerChain).catch(() => null),
    adapter.getTokenMeta(token).catch(() => ({ address: token, symbol: token.slice(0, 6), name: token.slice(0, 6), decimals: 18 })),
    adapter.getNativeBalance(address).catch(() => 0n),
    adapter.getTokenBalance(address, token).catch(() => 0n),
  ]);
  const chartUrl = info?.pairAddress ? await ctx.services.chart.chartUrl(info.pairAddress, meta.dexScreenerChain).catch(() => null) : null;

  const sym = info?.symbol ?? tokMeta.symbol;
  const lines: string[] = [`${meta.icon} <b>${esc(info?.name ?? tokMeta.name)}</b>  •  <b>$${esc(sym)}</b>`, `<i>on ${esc(meta.name)}</i>`, ''];
  if (info) {
    lines.push(
      `💰 <b>Price:</b>  $${info.priceUsd.toPrecision(4)}`,
      `💡 <b>Market Cap:</b>  ${formatUsd(info.mcUsd)}`,
      `💧 <b>Liquidity:</b>  ${formatUsd(info.liquidityUsd)}`,
      `📊 <b>Volume 24h:</b>  ${formatUsd(info.volume24)}`,
      `🏦 <b>DEX:</b>  ${esc(info.dexId)}`,
      `🔁 <b>Txns 24h:</b>  ${info.buys24} 🟢  /  ${info.sells24} 🔴`,
      '',
      `📈 <b>1h</b> ${formatPct(info.change1h)}   <b>6h</b> ${formatPct(info.change6h)}   <b>24h</b> ${formatPct(info.change24h)}`,
    );
  } else {
    lines.push('<i>No market data yet — very new or not on a DEX.</i>');
  }
  // Real Solana mint-safety badges (renounced / freeze revoked).
  if (chain === 'solana' && 'getMintInfo' in adapter && typeof (adapter as { getMintInfo?: unknown }).getMintInfo === 'function') {
    const safety = await (adapter as unknown as { getMintInfo(t: string): Promise<{ mintRenounced: boolean; freezeRevoked: boolean }> }).getMintInfo(token).catch(() => null);
    if (safety) {
      lines.push(
        '',
        `🧑‍🌾 <b>Mint renounced:</b> ${safety.mintRenounced ? '✅' : '⚠️ no'}`,
        `❄️ <b>Freeze revoked:</b> ${safety.freezeRevoked ? '✅' : '⚠️ no'}`,
      );
    }
  }
  if (info && info.pooledSui > 0) lines.push(`🌊 <b>Pooled:</b> ${info.pooledSui.toLocaleString('en-US', { maximumFractionDigits: 0 })} (quote)`);
  lines.push('', `📋 <b>Token</b> (tap to copy)`, code(token), '');
  if (held > 0n) {
    const heldHuman = Number(held) / 10 ** tokMeta.decimals;
    lines.push(`👜 <b>Holding:</b>  ${esc(formatAmount(held, tokMeta.decimals))} ${esc(sym)}`);
    if (info && info.priceNative > 0) {
      const worthNative = heldHuman * info.priceNative;
      const worthUsd = heldHuman * info.priceUsd;
      lines.push(`💎 <b>Worth:</b>  ${worthNative.toPrecision(4)} ${esc(meta.nativeSymbol)}  ·  ${formatUsd(worthUsd)}`);
    }
    const u = await ctx.services.repo.getUser(id);
    const cp = u?.chainPositions?.[`${chain}:${token}`];
    if (cp && info) for (const l of chainPnlLines(cp, info.priceUsd)) lines.push(l);
  }
  lines.push(`💵 <b>Balance:</b>  ${esc(formatAmount(nativeBal, meta.nativeDecimals))} ${esc(meta.nativeSymbol)}`, '', `👇 <b>Tap an amount to buy</b> (${esc(meta.nativeSymbol)}):`);

  const presets = QUICK_PRESETS[chain] ?? ['0.1', '0.5', '1', '5'];
  const xSearch = `https://x.com/search?q=${encodeURIComponent('$' + sym)}`;
  const kb = new InlineKeyboard();
  kb.text(`🟢 ${presets[0]} ${meta.nativeSymbol}`, `sq:${presets[0]}`).text(`🟢 ${presets[1]} ${meta.nativeSymbol}`, `sq:${presets[1]}`).row();
  kb.text(`🟢 ${presets[2]} ${meta.nativeSymbol}`, `sq:${presets[2]}`).text(`🟢 ${presets[3]} ${meta.nativeSymbol}`, `sq:${presets[3]}`).row();
  kb.text('✏️ Buy X', 'sq:x').text('🔴 Sell', 'ssell').row();
  kb.url('📊 Chart', info?.url ?? adapter.explorerAddress(token)).url('🔎 Explorer', adapter.explorerAddress(token)).url('𝕏 Search', xSearch).row();
  kb.text('🔄 Refresh', 'sref').text('⬅️ Menu', 'menu');

  await renderCard(ctx, { text: lines.join('\n'), kb, chartUrl, edit });
}

/** Read the stored {chain, token} for the active card, if it matches the chain. */
async function currentChainToken(ctx: BotContext): Promise<{ chain: ChainId; token: string } | null> {
  const raw = await ctx.services.repo.getMeta(`xtok:${tgId(ctx)}`);
  if (!raw) return null;
  const [chain, token] = raw.split('\n');
  if (!chain || !token) return null;
  return { chain: chain as ChainId, token };
}

/** Execute a buy of `amountNative` of the native token → the stored token. */
async function chainBuy(ctx: BotContext, amountNative: string): Promise<void> {
  const id = tgId(ctx);
  const cur = await currentChainToken(ctx);
  const cc = await activeNonSui(ctx);
  if (!cur || !cc || cur.chain !== cc.chain) {
    await ctx.reply('That token expired. Paste it again.', { reply_markup: backMenu() });
    return;
  }
  if (!isPositiveAmount(amountNative)) throw new Error(`Enter a positive ${cc.meta.nativeSymbol} amount.`);
  await ctx.services.security.enforceRate(id, 'chainbuy');
  const { chain, adapter, meta } = cc;
  const address = await ctx.services.multiWallet.ensureWallet(id, chain);
  const amount = toBaseUnits(amountNative, meta.nativeDecimals);
  const bal = await adapter.getNativeBalance(address).catch(() => 0n);
  if (bal < amount + gasBuffer(meta)) {
    throw new Error(`Not enough ${meta.nativeSymbol}. Balance: ${formatAmount(bal, meta.nativeDecimals)} ${meta.nativeSymbol}. Fund ${shortenAddress(address, 6, 6)} and retry.`);
  }
  const u = (await ctx.services.repo.getUser(id))!;
  await ctx.reply(`⏳ Buying <b>${esc(amountNative)} ${esc(meta.nativeSymbol)}</b> worth on ${esc(meta.name)}…`, { parse_mode: 'HTML' });
  const heldBefore = await adapter.getTokenBalance(address, cur.token).catch(() => 0n);
  const req = { inputToken: meta.nativeAddress, outputToken: cur.token, amount: amount.toString(), slippageBps: u.settings.slippageBps, owner: address };
  const quote = await adapter.quote(req);
  const secret = await ctx.services.multiWallet.getSecret(id, chain);
  const { digest } = await adapter.swap(secret, quote, req);
  const tokMeta = await adapter.getTokenMeta(cur.token).catch(() => ({ decimals: 18, symbol: cur.token.slice(0, 6) } as { decimals: number; symbol: string }));
  // Use the ACTUAL received amount (post-confirmation balance delta), not the
  // estimate, and price the cost in USD so PnL is denomination-correct.
  const heldAfter = await adapter.getTokenBalance(address, cur.token).catch(() => heldBefore + BigInt(quote.outAmount));
  const received = heldAfter > heldBefore ? heldAfter - heldBefore : BigInt(quote.outAmount);
  const priceUsd = (await ctx.services.dex.token(cur.token, meta.dexScreenerChain).catch(() => null))?.priceUsd ?? 0;
  const buyUsd = priceUsd > 0 ? (Number(received) / 10 ** tokMeta.decimals) * priceUsd : 0;
  await ctx.services.repo
    .withUser(id, (uu) => {
      const key = `${chain}:${cur.token}`;
      uu.chainPositions = uu.chainPositions ?? {};
      const p = uu.chainPositions[key];
      if (p) {
        p.amount = (BigInt(p.amount) + received).toString();
        p.costUsd = (Number(p.costUsd) + buyUsd).toFixed(6);
        p.updatedAt = new Date().toISOString();
      } else {
        uu.chainPositions[key] = { token: cur.token, symbol: tokMeta.symbol, decimals: tokMeta.decimals, amount: received.toString(), costUsd: buyUsd.toFixed(6), realizedUsd: '0', updatedAt: new Date().toISOString() };
      }
    })
    .catch(() => {});
  await ctx.reply(
    `✅ Bought <b>~${esc(formatAmount(received, tokMeta.decimals))} ${esc(tokMeta.symbol)}</b> for ${esc(amountNative)} ${esc(meta.nativeSymbol)}\n${link('View transaction', adapter.explorerTx(digest))}`,
    { parse_mode: 'HTML' },
  );
  // Re-show the position card so the new holding, worth & PnL are visible.
  await chainCard(ctx, cur.token).catch(() => {});
}

/** Execute a sell of `percent` of the held token → native, on the active chain. */
async function chainSell(ctx: BotContext, percent: number): Promise<void> {
  const id = tgId(ctx);
  const cur = await currentChainToken(ctx);
  const cc = await activeNonSui(ctx);
  if (!cur || !cc || cur.chain !== cc.chain) {
    await ctx.reply('That token expired. Paste it again.', { reply_markup: backMenu() });
    return;
  }
  await ctx.services.security.enforceRate(id, 'chainsell');
  const { chain, adapter, meta } = cc;
  const address = await ctx.services.multiWallet.ensureWallet(id, chain);
  const held = await adapter.getTokenBalance(address, cur.token).catch(() => 0n);
  if (held <= 0n) throw new Error('You have none of this token to sell.');
  const sellAmount = (held * BigInt(Math.max(1, Math.min(100, percent)))) / 100n;
  const u = (await ctx.services.repo.getUser(id))!;
  await ctx.reply(`⏳ Selling <b>${percent}%</b> on ${esc(meta.name)}…`, { parse_mode: 'HTML' });
  const req = { inputToken: cur.token, outputToken: meta.nativeAddress, amount: sellAmount.toString(), slippageBps: u.settings.slippageBps, owner: address };
  const quote = await adapter.quote(req);
  const secret = await ctx.services.multiWallet.getSecret(id, chain);
  const { digest } = await adapter.swap(secret, quote, req);
  // Realize PnL in USD against tracked cost basis (best-effort). Proceeds are
  // valued at the token's live USD price to avoid gas-noise on native deltas.
  const sPriceUsd = (await ctx.services.dex.token(cur.token, meta.dexScreenerChain).catch(() => null))?.priceUsd ?? 0;
  const sTokMeta = await adapter.getTokenMeta(cur.token).catch(() => ({ decimals: 18 } as { decimals: number }));
  await ctx.services.repo
    .withUser(id, (uu) => {
      const key = `${chain}:${cur.token}`;
      const p = uu.chainPositions?.[key];
      if (!p) return;
      const amt = BigInt(p.amount);
      if (amt <= 0n) return;
      // Clamp the closed portion to the tracked amount so cost basis can't go negative.
      const sold = sellAmount > amt ? amt : sellAmount;
      const proceedsUsd = sPriceUsd > 0 ? (Number(sold) / 10 ** sTokMeta.decimals) * sPriceUsd : 0;
      const costPortionUsd = Number(p.costUsd) * (Number(sold) / Number(amt));
      p.realizedUsd = (Number(p.realizedUsd) + (proceedsUsd - costPortionUsd)).toFixed(6);
      p.amount = (amt - sold).toString();
      p.costUsd = Math.max(0, Number(p.costUsd) - costPortionUsd).toFixed(6);
      p.updatedAt = new Date().toISOString();
    })
    .catch(() => {});
  await ctx.reply(
    `✅ Sold for <b>~${esc(formatAmount(BigInt(quote.outAmount), meta.nativeDecimals))} ${esc(meta.nativeSymbol)}</b>\n${link('View transaction', adapter.explorerTx(digest))}`,
    { parse_mode: 'HTML' },
  );
  // Re-show the position card so the updated holding & PnL are visible.
  await chainCard(ctx, cur.token).catch(() => {});
}

async function startBuy(ctx: BotContext, coinType?: string): Promise<void> {
  const id = await ensureWallet(ctx);
  const chain = await ctx.services.multiWallet.getActiveChain(id);
  if (chain !== 'sui') {
    const meta = CHAINS[chain];
    if (coinType && isChainToken(ctx, coinType, chain)) {
      await chainCard(ctx, coinType);
      return;
    }
    await ctx.reply(`🟢 <b>Buy on ${esc(meta.name)}</b>\n\nPaste the token <b>address</b>:`, { parse_mode: 'HTML' });
    return;
  }
  if (coinType && isValidCoinType(coinType)) {
    await promptBuyAmount(ctx, coinType);
    return;
  }
  ctx.services.sessions.set(id, { flow: 'buy_token', data: {} });
  await ctx.reply('🟢 <b>Buy</b>\n\nPaste the token <b>coin type</b> (e.g. <code>0x…::coin::COIN</code>):', {
    parse_mode: 'HTML',
  });
}

async function startSell(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const chain = await ctx.services.multiWallet.getActiveChain(id);
  if (chain !== 'sui') {
    const meta = CHAINS[chain];
    const cur = await currentChainToken(ctx);
    if (cur && cur.chain === chain) { await chainCard(ctx, cur.token); return; }
    await ctx.reply(`🔴 <b>Sell on ${esc(meta.name)}</b>\n\nPaste the token <b>address</b> to open its card, then tap Sell.`, { parse_mode: 'HTML' });
    return;
  }
  const address = (await ctx.services.wallet.getAddress(id))!;
  const holdings = (await ctx.services.sui.getHoldings(address)).filter((h) => h.coinType !== SUI_TYPE);
  if (holdings.length === 0) {
    await ctx.reply('🔴 No non-SUI tokens to sell.', { reply_markup: backMenu() });
    return;
  }
  const list = holdings.slice(0, 20);
  // Use index refs (Sui coin types exceed Telegram's 64-byte callback_data limit).
  await ctx.services.repo.setMeta(`selllist:${id}`, JSON.stringify(list.map((h) => h.coinType))).catch(() => {});
  const kb = new InlineKeyboard();
  list.forEach((h, i) => kb.text(`${h.symbol} (${h.formatted})`, `sl:${i}`).row());
  kb.text('⬅️ Back', 'menu');
  await ctx.reply('🔴 <b>Sell</b> — pick a token:', { parse_mode: 'HTML', reply_markup: kb });
}

async function prepareAndConfirm(
  ctx: BotContext,
  inputType: string,
  outputType: string,
  humanAmount: string,
): Promise<void> {
  const id = tgId(ctx);
  const u = (await ctx.services.repo.getUser(id))!;
  if (inputType === SUI_TYPE) ctx.services.security.assertBuyWithinCap(Number(humanAmount));
  const prepared = await ctx.services.trade.prepareQuote({
    inputType,
    outputType,
    humanAmount,
    slippageBps: u.settings.slippageBps,
  });
  ctx.services.pending.set(`${id}:quote`, prepared);
  const text = [
    prepared.kind === 'buy' ? '🟢 <b>Confirm Buy</b>' : prepared.kind === 'sell' ? '🔴 <b>Confirm Sell</b>' : '🔄 <b>Confirm Swap</b>',
    '',
    `Pay: <b>${esc(prepared.display.amountIn)} ${esc(prepared.inputMeta.symbol)}</b>`,
    `Receive (est): <b>${esc(prepared.display.amountOut)} ${esc(prepared.outputMeta.symbol)}</b>`,
    `Min received: <b>${esc(prepared.display.minReceive)} ${esc(prepared.outputMeta.symbol)}</b>`,
    `Fee: ${esc(prepared.display.feeShown)} SUI (${prepared.display.displayFeePct})`,
    prepared.quote.routeLabel ? `Route: <i>${esc(prepared.quote.routeLabel)}</i>` : '',
  ]
    .filter(Boolean)
    .join('\n');
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: confirmCancel('confirm_swap') });
}

async function executeSwap(ctx: BotContext): Promise<void> {
  const id = tgId(ctx);
  const prepared = ctx.services.pending.get(`${id}:quote`) as PreparedQuote | undefined;
  if (!prepared) {
    await ctx.reply('That quote expired. Please start again.', { reply_markup: backMenu() });
    return;
  }
  ctx.services.pending.delete(`${id}:quote`);
  await ctx.reply('⏳ Submitting…');
  const signer = await ctx.services.wallet.getKeypair(id);
  const { digest } = await ctx.services.trade.execute({ telegramId: id, prepared, signer });
  await ctx.reply(`✅ Done!\n${link('View transaction', ctx.services.sui.txUrl(digest))}`, {
    parse_mode: 'HTML',
    reply_markup: mainMenu(),
  });
}

async function showPrice(ctx: BotContext, coinType: string): Promise<void> {
  if (!isValidCoinType(coinType)) throw new Error('Provide a valid coin type, e.g. 0x…::coin::COIN');
  const meta = await ctx.services.sui.getCoinMeta(coinType);
  const price = await ctx.services.oracle.priceNumber(coinType);
  await ctx.reply(
    [`💱 <b>${esc(meta.symbol)}</b>`, '', `Price: <b>${price.toPrecision(6)} SUI</b>`, code(coinType)].join('\n'),
    { parse_mode: 'HTML', reply_markup: backMenu() },
  );
}

// --- Send -------------------------------------------------------------------

async function startSend(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  ctx.services.sessions.set(id, { flow: 'send_recipient', data: {} });
  await ctx.reply('📤 <b>Send SUI</b>\n\nPaste the recipient Sui address:', { parse_mode: 'HTML' });
}

// --- Orders (limit / tp / sl / dca) -----------------------------------------

async function ordersMenu(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const orders = await ctx.services.orders.list(id);
  const kb = new InlineKeyboard()
    .text('📉 Limit Buy', 'order:limit_buy')
    .text('📈 Limit Sell', 'order:limit_sell')
    .row()
    .text('🎯 Take Profit', 'order:take_profit')
    .text('🛑 Stop Loss', 'order:stop_loss')
    .row()
    .text('🔁 DCA', 'order:dca')
    .row()
    .text('⬅️ Back', 'menu');
  const lines = [
    '🎯 <b>Automated Orders</b>',
    '',
    '📉 <b>Limit Buy</b> — buy when the price falls to your target',
    '📈 <b>Limit Sell</b> — sell when the price rises to your target',
    '🎯 <b>Take Profit</b> / 🛑 <b>Stop Loss</b> — auto-sell at a target/floor',
    '🔁 <b>DCA</b> — split a buy into scheduled chunks',
    '',
    '<b>Active orders</b>',
  ];
  if (orders.length === 0) lines.push('<i>None yet — tap a type below to create one.</i>');
  for (const o of orders) {
    lines.push(
      `• ${esc(o.kind)} ${esc(o.coinType.split('::').pop() ?? '')}` +
        (o.triggerPrice ? ` @ ${esc(o.triggerPrice)} SUI` : '') +
        (o.dca ? ` (${o.dca.completed}/${o.dca.totalBuys})` : ''),
    );
  }
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

/**
 * A friendly limit-order builder for a specific token. Instead of asking for a
 * raw "SUI per token" price (which is meaningless for tiny-priced tokens), we
 * anchor to the live price and offer plain-language presets: buy the dip at
 * −X%, or take profit at +X%. "Custom" still allows an exact target.
 */
async function limitBuilder(ctx: BotContext, coinType: string): Promise<void> {
  const id = await ensureWallet(ctx);
  await ctx.services.repo.setMeta(`buytok:${id}`, coinType).catch(() => {});
  const [info, priceNum, meta] = await Promise.all([
    ctx.services.dex.token(coinType).catch(() => null),
    ctx.services.oracle.priceNumber(coinType).catch(() => null),
    ctx.services.sui.getCoinMeta(coinType),
  ]);
  const priceSui = info?.priceNative || priceNum || 0;
  const sym = info?.symbol ?? meta.symbol;
  const priceLine = priceSui > 0
    ? `Current price: <b>${priceSui.toPrecision(4)} SUI</b>${info ? ` · $${info.priceUsd.toPrecision(4)}` : ''}`
    : '<i>No live price yet.</i>';

  const kb = new InlineKeyboard()
    .text('📉 Buy dip −10%', 'lim:buy:10').text('−25%', 'lim:buy:25').text('−50%', 'lim:buy:50')
    .row()
    .text('📈 Take profit +50%', 'lim:sell:50').text('+100%', 'lim:sell:100').text('+300%', 'lim:sell:300')
    .row()
    .text('✏️ Custom buy price', 'lim:cust:buy').text('✏️ Custom sell price', 'lim:cust:sell')
    .row()
    .text('⬅️ Back', 'qb:ref');

  await ctx.reply(
    [
      `🎯 <b>Limit order — $${esc(sym)}</b>`,
      '',
      priceLine,
      '',
      '<b>Buy the dip</b> — fires when the price falls to your target.',
      '<b>Take profit</b> — fires when the price rises to your target.',
      '',
      'Pick a target below, or set a custom price:',
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: kb },
  );
}

// --- Copy / sniper / watchlist ----------------------------------------------

async function copyMenu(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const copies = await ctx.services.copy.list(id);
  const lines = ['👥 <b>Copy Trading</b>', ''];
  if (copies.length === 0) lines.push('<i>Not copying anyone yet.</i>');
  for (const c of copies) lines.push(`• ${code(c.leaderAddress)} — ${c.ratioBps / 100}%, max ${c.maxSui} SUI`);
  const kb = new InlineKeyboard().text('➕ Copy a wallet', 'copy_add').row().text('⬅️ Back', 'menu');
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

async function sniperMenu(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const snipes = await ctx.services.sniper.list(id);
  const lines = ['🔫 <b>Sniper</b>', '', 'Auto-buys a token the moment it becomes tradeable.', ''];
  if (snipes.length === 0) lines.push('<i>No armed snipes.</i>');
  for (const s of snipes) lines.push(`• ${esc(s.coinType?.split('::').pop() ?? '')} — ${s.amountSui} SUI`);
  const kb = new InlineKeyboard().text('🎯 Arm a snipe', 'snipe_add').row().text('⬅️ Back', 'menu');
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

async function watchlistMenu(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const items = await ctx.services.watchlist.list(id);
  const lines = ['⭐ <b>Watchlist</b>', ''];
  if (items.length === 0) lines.push('<i>Empty.</i>');
  for (const w of items) lines.push(`• <b>${esc(w.symbol)}</b>${w.alertPrice ? ` — alert ${esc(w.direction ?? 'above')} ${esc(w.alertPrice)} SUI` : ''}`);
  const kb = new InlineKeyboard().text('➕ Add token', 'watch_add').row().text('⬅️ Back', 'menu');
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

// --- Bundle -----------------------------------------------------------------

async function bundleMenu(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const wallets = await ctx.services.wallet.allWallets(id);
  ctx.services.sessions.set(id, { flow: 'bundle_token', data: {} });
  await ctx.reply(
    [
      '🧺 <b>Bundle Buy</b>',
      '',
      `You have <b>${wallets.length}</b> wallet(s). A bundle buys the same token from all of them at once.`,
      '',
      'Paste the token <b>coin type</b> to bundle-buy:',
    ].join('\n'),
    { parse_mode: 'HTML' },
  );
}

// --- Launch (bonding curve) -------------------------------------------------

const LAUNCH_STEPS = ['name', 'symbol', 'decimals', 'supply', 'description'] as const;

async function startLaunch(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  ctx.services.sessions.set(id, { flow: 'launch', step: 0, data: {} });
  await ctx.reply(
    ['🚀 <b>Launch a token</b>', '', "What's the token <b>name</b>? (e.g. <code>My Coin</code>)"].join('\n'),
    { parse_mode: 'HTML' },
  );
}

async function handleLaunchStep(ctx: BotContext, text: string): Promise<void> {
  const id = tgId(ctx);
  const state = ctx.services.sessions.get(id)!;
  const step = state.step ?? 0;
  const field = LAUNCH_STEPS[step]!;
  switch (field) {
    case 'name':
      if (!text.trim() || text.length > 32) throw new Error('Name must be 1–32 characters.');
      state.data.name = text.trim();
      break;
    case 'symbol':
      if (!/^[A-Za-z0-9]{2,10}$/.test(text.trim())) throw new Error('Symbol must be 2–10 letters/digits.');
      state.data.symbol = text.trim().toUpperCase();
      break;
    case 'decimals': {
      const d = Number(text.trim());
      if (!Number.isInteger(d) || d < 0 || d > 18) throw new Error('Decimals must be 0–18.');
      state.data.decimals = String(d);
      break;
    }
    case 'supply':
      if (!/^\d+$/.test(text.trim())) throw new Error('Supply must be a whole number.');
      state.data.supply = text.trim();
      break;
    case 'description':
      state.data.description = text.trim() === '/skip' ? '' : text.trim();
      break;
  }
  const next = step + 1;
  if (next < LAUNCH_STEPS.length) {
    ctx.services.sessions.update(id, { step: next, data: state.data });
    await ctx.reply(launchPrompt(LAUNCH_STEPS[next]!), { parse_mode: 'HTML' });
    return;
  }
  const params: LaunchParams = {
    name: state.data.name!,
    symbol: state.data.symbol!,
    decimals: Number(state.data.decimals),
    description: state.data.description ?? '',
    initialSupply: BigInt(state.data.supply ?? '0'),
    keepMintAuthority: true,
  };
  ctx.services.pending.set(`${id}:launch`, params);
  ctx.services.sessions.clear(id);
  const preview = ctx.services.launch.previewSource(params);
  await ctx.reply(
    [
      '🚀 <b>Review</b>',
      `Name: <b>${esc(params.name)}</b> • Symbol: <b>${esc(params.symbol)}</b>`,
      `Decimals: <b>${params.decimals}</b> • Supply: <b>${esc(params.initialSupply.toString())}</b>`,
      '',
      `<pre>${esc(preview.source)}</pre>`,
      'Publishing costs gas. Confirm to deploy.',
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: confirmCancel('confirm_launch') },
  );
}

function launchPrompt(field: (typeof LAUNCH_STEPS)[number]): string {
  return {
    name: 'Enter a name:',
    symbol: 'Now the <b>symbol</b> (2–10 chars):',
    decimals: 'How many <b>decimals</b>? (9 is standard)',
    supply: 'What <b>total supply</b> (whole tokens)?',
    description: 'Add a short <b>description</b>, or send <code>/skip</code>:',
  }[field];
}

async function executeLaunch(ctx: BotContext): Promise<void> {
  const id = tgId(ctx);
  const params = ctx.services.pending.get(`${id}:launch`) as LaunchParams | undefined;
  if (!params) {
    await ctx.reply('That launch expired. Start again with /launch.', { reply_markup: backMenu() });
    return;
  }
  ctx.services.pending.delete(`${id}:launch`);
  await ctx.reply('⏳ Compiling &amp; publishing…', { parse_mode: 'HTML' });
  const signer = await ctx.services.wallet.getKeypair(id);
  const result = await ctx.services.launch.launch({ telegramId: id, signer, coin: params });
  await ctx.reply(
    [
      '🎉 <b>Launched!</b>',
      '',
      `Coin: ${code(result.coinType)}`,
      `Package: ${code(result.packageId)}`,
      '',
      link('View transaction', ctx.services.sui.txUrl(result.digest)),
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: mainMenu() },
  );
}

// --- Bridge -----------------------------------------------------------------

async function bridgeMenu(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  ctx.services.sessions.set(id, { flow: 'bridge_from', data: {} });
  await ctx.reply(
    [
      '🌉 <b>Bridge</b> — move assets across chains',
      '',
      `Powered by <b>${esc(ctx.services.bridge.providerName)}</b> · best-price cross-chain routing.`,
      'Live: <b>Ethereum · Base · Arbitrum · Polygon · BNB · Solana</b> (Sui rolling out).',
      '',
      'Format: <code>fromChain toChain token amount destAddress</code>',
      'e.g. <code>polygon arbitrum USDC 25 0xYourAddress</code>',
      '',
      'Send your bridge request for a live quote:',
    ].join('\n'),
    { parse_mode: 'HTML' },
  );
}

// --- Text router ------------------------------------------------------------

async function onText(ctx: BotContext): Promise<void> {
  const id = tgId(ctx);
  const state = ctx.services.sessions.get(id);
  const text = ctx.message?.text?.trim() ?? '';
  if (text.startsWith('/')) return;
  // On a non-Sui chain, a pasted token address shows its card (mirrors Sui).
  if (!(state && state.flow === 'sol_buy_amount')) {
    const active = await ctx.services.multiWallet.getActiveChain(id).catch(() => 'sui' as ChainId);
    if (active !== 'sui' && isChainToken(ctx, text, active)) {
      await ensureWallet(ctx);
      await chainCard(ctx, text);
      return;
    }
  }
  // A pasted coin type ALWAYS shows the token card — even mid-flow — except in
  // the few steps that are specifically waiting for a coin type as input.
  const awaitingCoinType = new Set(['buy_token', 'order_token', 'dca_token', 'snipe_token', 'watch_token', 'bundle_token']);
  if (isValidCoinType(text) && !(state && awaitingCoinType.has(state.flow))) {
    await ensureWallet(ctx);
    const u = await ctx.services.repo.getUser(id);
    // Auto-buy: paste a CA and it buys instantly, no card, no taps.
    if (u?.settings.autoBuy) {
      await ctx.services.repo.setMeta(`buytok:${id}`, text).catch(() => {});
      ctx.services.sessions.clear(id);
      await ctx.reply(`⚡ <b>Auto-Buy</b> — buying ${esc(u.settings.autoBuySui)} SUI…`, { parse_mode: 'HTML' });
      await quickBuy(ctx, u.settings.autoBuySui || '1');
      return;
    }
    await promptBuyAmount(ctx, text);
    return;
  }
  if (!state) return;

  switch (state.flow) {
    case 'import_wallet': {
      if (!isValidSecretKey(text)) throw new Error('That is not a valid Sui private key.');
      ctx.services.sessions.clear(id);
      const { address } = await ctx.services.wallet.import(id, text);
      await ctx.deleteMessage().catch(() => {});
      await ctx.reply(`✅ Wallet imported.\n${code(address)}`, { parse_mode: 'HTML', reply_markup: mainMenu() });
      return;
    }
    case 'buy_token':
      if (!isValidCoinType(text)) throw new Error('Not a valid coin type.');
      await promptBuyAmount(ctx, text);
      return;
    case 'buy_amount':
      if (!isPositiveAmount(text)) throw new Error('Enter a positive amount, e.g. 1.5');
      ctx.services.sessions.clear(id);
      await prepareAndConfirm(ctx, SUI_TYPE, state.data.coinType!, text);
      return;
    case 'sol_buy_amount':
      ctx.services.sessions.clear(id);
      await chainBuy(ctx, text);
      return;
    case 'sell_amount': {
      const coinType = state.data.coinType!;
      let humanAmount = text;
      const pctMatch = text.match(/^(\d{1,3})\s*%$/);
      if (pctMatch) {
        const pct = Number(pctMatch[1]);
        if (pct < 1 || pct > 100) throw new Error('Percent must be 1–100.');
        const addr = (await ctx.services.wallet.getAddress(id))!;
        const meta = await ctx.services.sui.getCoinMeta(coinType);
        const held = await ctx.services.sui.getBalance(addr, coinType);
        if (held <= 0n) throw new Error('You have none of this token to sell.');
        humanAmount = fromBaseUnits((held * BigInt(pct)) / 100n, meta.decimals);
      } else if (!isPositiveAmount(text)) {
        throw new Error('Enter a positive amount, or a percent like 50%.');
      }
      ctx.services.sessions.clear(id);
      await prepareAndConfirm(ctx, coinType, SUI_TYPE, humanAmount);
      return;
    }
    case 'send_recipient':
      if (!isValidSuiAddress(text)) throw new Error('Not a valid Sui address.');
      ctx.services.sessions.set(id, { flow: 'send_amount', data: { recipient: text } });
      await ctx.reply('How much <b>SUI</b> to send?', { parse_mode: 'HTML' });
      return;
    case 'send_amount': {
      if (!isPositiveAmount(text)) throw new Error('Enter a positive amount.');
      const recipient = state.data.recipient!;
      ctx.services.sessions.clear(id);
      await ctx.reply('⏳ Sending…');
      const { toBaseUnits } = await import('../util/format.js');
      const signer = await ctx.services.wallet.getKeypair(id);
      const { digest } = await ctx.services.sui.transfer({ signer, recipient, coinType: SUI_TYPE, amount: toBaseUnits(text, 9) });
      await ctx.reply(`✅ Sent!\n${link('View', ctx.services.sui.txUrl(digest))}`, { parse_mode: 'HTML', reply_markup: mainMenu() });
      return;
    }
    case 'set_slippage': {
      const pct = Number(text);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 50) throw new Error('Enter a % between 0 and 50.');
      ctx.services.sessions.clear(id);
      await ctx.services.repo.withUser(id, (u) => {
        u.settings.slippageBps = Math.round(pct * 100);
      });
      await ctx.reply(`✅ Slippage set to ${pct}%.`, { reply_markup: backMenu() });
      return;
    }
    case 'autobuy_amount': {
      if (!isPositiveAmount(text)) throw new Error('Enter a positive SUI amount, e.g. 1');
      ctx.services.security.assertBuyWithinCap(Number(text));
      ctx.services.sessions.clear(id);
      await ctx.services.repo.withUser(id, (u) => {
        u.settings.autoBuySui = text;
        u.settings.autoBuy = true;
      });
      await ctx.reply(`⚡ Auto-Buy set to <b>${esc(text)} SUI</b> and turned ON.\nPaste any token and it buys instantly.`, {
        parse_mode: 'HTML',
        reply_markup: mainMenu(),
      });
      return;
    }
    case 'launch':
      await handleLaunchStep(ctx, text);
      return;
    // Orders
    case 'order_price':
      if (!isPositiveAmount(text)) throw new Error('Enter a positive trigger price in SUI.');
      ctx.services.sessions.update(id, { flow: 'order_size', data: { triggerPrice: text } });
      await ctx.reply(
        state.data.kind === 'limit_buy'
          ? 'How much <b>SUI</b> to spend when triggered?'
          : 'What <b>percent</b> of holdings to sell (1–100)?',
        { parse_mode: 'HTML' },
      );
      return;
    case 'order_size': {
      const kind = state.data.kind!;
      ctx.services.sessions.clear(id);
      if (kind === 'limit_buy') {
        if (!isPositiveAmount(text)) throw new Error('Enter a positive SUI amount.');
        await ctx.services.orders.create(id, { kind: 'limit_buy', coinType: state.data.coinType!, triggerPrice: state.data.triggerPrice!, amountSui: text });
      } else {
        const pct = Number(text);
        if (!Number.isInteger(pct) || pct < 1 || pct > 100) throw new Error('Percent must be 1–100.');
        await ctx.services.orders.create(id, { kind: kind as 'limit_sell' | 'take_profit' | 'stop_loss', coinType: state.data.coinType!, triggerPrice: state.data.triggerPrice!, sellPercent: pct });
      }
      await ctx.reply('✅ Order created. It will run automatically.', { reply_markup: mainMenu() });
      return;
    }
    case 'order_token':
      if (!isValidCoinType(text)) throw new Error('Not a valid coin type.');
      ctx.services.sessions.update(id, { flow: 'order_price', data: { coinType: text } });
      await ctx.reply('Enter your <b>target price</b> in SUI per token — the order fires when the price reaches it:', { parse_mode: 'HTML' });
      return;
    case 'dca_token':
      if (!isValidCoinType(text)) throw new Error('Not a valid coin type.');
      ctx.services.sessions.update(id, { flow: 'dca_amount', data: { coinType: text } });
      await ctx.reply('SUI amount <b>per buy</b>?', { parse_mode: 'HTML' });
      return;
    case 'dca_amount':
      if (!isPositiveAmount(text)) throw new Error('Enter a positive amount.');
      ctx.services.sessions.update(id, { flow: 'dca_count', data: { amountSui: text } });
      await ctx.reply('How many buys <b>total</b>?', { parse_mode: 'HTML' });
      return;
    case 'dca_count': {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error('Enter 1–1000.');
      ctx.services.sessions.update(id, { flow: 'dca_interval', data: { count: String(n) } });
      await ctx.reply('Interval between buys in <b>minutes</b>?', { parse_mode: 'HTML' });
      return;
    }
    case 'dca_interval': {
      const mins = Number(text);
      if (!Number.isFinite(mins) || mins < 1) throw new Error('Enter minutes ≥ 1.');
      ctx.services.sessions.clear(id);
      await ctx.services.orders.create(id, {
        kind: 'dca',
        coinType: state.data.coinType!,
        dca: { intervalSec: Math.round(mins * 60), totalBuys: Number(state.data.count), amountSui: state.data.amountSui! },
      });
      await ctx.reply('✅ DCA scheduled.', { reply_markup: mainMenu() });
      return;
    }
    // Copy
    case 'copy_leader':
      try {
        normalizeSuiAddress(text);
      } catch {
        throw new Error('Not a valid Sui address.');
      }
      ctx.services.sessions.update(id, { flow: 'copy_ratio', data: { leader: text } });
      await ctx.reply('What <b>percent</b> of the leader’s buy size to mirror? (e.g. 50)', { parse_mode: 'HTML' });
      return;
    case 'copy_ratio': {
      const pct = Number(text);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error('Enter 1–100.');
      ctx.services.sessions.update(id, { flow: 'copy_max', data: { ratio: String(Math.round(pct * 100)) } });
      await ctx.reply('Max <b>SUI</b> per mirrored buy?', { parse_mode: 'HTML' });
      return;
    }
    case 'copy_max':
      if (!isPositiveAmount(text)) throw new Error('Enter a positive amount.');
      ctx.services.sessions.clear(id);
      await ctx.services.copy.follow(id, state.data.leader!, Number(state.data.ratio), text);
      await ctx.reply('✅ Now copying that wallet.', { reply_markup: mainMenu() });
      return;
    // Sniper
    case 'snipe_token':
      if (!isValidCoinType(text)) throw new Error('Not a valid coin type.');
      ctx.services.sessions.update(id, { flow: 'snipe_amount', data: { coinType: text } });
      await ctx.reply('SUI amount to snipe with?', { parse_mode: 'HTML' });
      return;
    case 'snipe_amount': {
      if (!isPositiveAmount(text)) throw new Error('Enter a positive amount.');
      ctx.services.sessions.clear(id);
      const u = (await ctx.services.repo.getUser(id))!;
      await ctx.services.sniper.arm(id, { coinType: state.data.coinType!, amountSui: text, maxSlippageBps: Math.max(u.settings.slippageBps, 500) });
      await ctx.reply('🎯 Snipe armed. I will buy the instant it’s tradeable.', { reply_markup: mainMenu() });
      return;
    }
    // Watchlist
    case 'watch_token':
      if (!isValidCoinType(text)) throw new Error('Not a valid coin type.');
      ctx.services.sessions.update(id, { flow: 'watch_price', data: { coinType: text } });
      await ctx.reply('Alert price in SUI (or send <code>/skip</code> for no alert):', { parse_mode: 'HTML' });
      return;
    case 'watch_price': {
      ctx.services.sessions.clear(id);
      if (text === '/skip') {
        await ctx.services.watchlist.add(id, state.data.coinType!);
      } else {
        if (!isPositiveAmount(text)) throw new Error('Enter a price or /skip.');
        const cur = await ctx.services.oracle.priceNumber(state.data.coinType!).catch(() => 0);
        const dir = Number(text) >= cur ? 'above' : 'below';
        await ctx.services.watchlist.add(id, state.data.coinType!, text, dir);
      }
      await ctx.reply('⭐ Added to watchlist.', { reply_markup: mainMenu() });
      return;
    }
    // Bundle
    case 'bundle_token':
      if (!isValidCoinType(text)) throw new Error('Not a valid coin type.');
      ctx.services.sessions.update(id, { flow: 'bundle_amount', data: { coinType: text } });
      await ctx.reply('SUI amount <b>per wallet</b>?', { parse_mode: 'HTML' });
      return;
    case 'bundle_amount': {
      if (!isPositiveAmount(text)) throw new Error('Enter a positive amount.');
      ctx.services.sessions.clear(id);
      ctx.services.security.assertBuyWithinCap(Number(text));
      const wallets = await ctx.services.wallet.allWallets(id);
      await ctx.reply(`⏳ Buying from ${wallets.length} wallet(s)…`);
      const u = (await ctx.services.repo.getUser(id))!;
      const results = await ctx.services.bundle.bundleBuy({
        telegramId: id,
        coinType: state.data.coinType!,
        amountSuiPerWallet: text,
        walletIds: wallets.map((w) => w.id),
        slippageBps: u.settings.slippageBps,
      });
      const ok = results.filter((r) => r.status === 'success').length;
      const lines = [`🧺 <b>Bundle complete</b>: ${ok}/${results.length} succeeded`, ''];
      for (const r of results) lines.push(`${r.status === 'success' ? '✅' : '❌'} ${esc(r.label)}${r.error ? ` — ${esc(r.error)}` : ''}`);
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: mainMenu() });
      return;
    }
    // Bridge
    case 'bridge_from': {
      const parts = text.split(/\s+/);
      if (parts.length < 5) throw new Error('Format: fromChain toChain token amount destAddress');
      ctx.services.sessions.clear(id);
      const [fromChain, toChain, token, amount, ...addr] = parts;
      const quote = await ctx.services.bridge.quote({
        fromChain: fromChain as never,
        toChain: toChain as never,
        fromToken: token!,
        toToken: token!,
        amount: amount!,
        toAddress: addr.join(''),
      });
      await ctx.reply(
        [
          '🌉 <b>Bridge Quote</b>',
          '',
          `${esc(quote.amountIn)} ${esc(token!)} on ${esc(fromChain!)} → <b>${esc(quote.estAmountOut)} ${esc(token!)}</b> on ${esc(toChain!)}`,
          quote.feeUsd ? `Fee: ~$${esc(quote.feeUsd)}` : '',
          quote.etaSeconds ? `ETA: ~${Math.round(quote.etaSeconds / 60)} min` : '',
          '',
          `<i>Provider: ${esc(quote.provider)}. Complete the transfer via the provider to your destination address.</i>`,
        ]
          .filter(Boolean)
          .join('\n'),
        { parse_mode: 'HTML', reply_markup: mainMenu() },
      );
      return;
    }
  }
}

// --- Registration -----------------------------------------------------------

export function registerHandlers(bot: Bot<BotContext>): void {
  // /start supports a referral payload: /start <CODE>
  bot.command('start', guard(async (ctx) => {
    const id = tgId(ctx);
    if (!(await ctx.services.wallet.hasWallet(id))) {
      const codeArg = ctx.match?.toString().trim();
      let referrerId: string | undefined;
      if (codeArg) referrerId = await ctx.services.repo.resolveRefCode(codeArg);
      await ctx.services.wallet.create(id, referrerId && referrerId !== id ? referrerId : undefined);
      if (referrerId && referrerId !== id) await ctx.services.referral.registerDownline(id).catch(() => {});
    }
    await home(ctx);
  }));

  bot.command('help', guard(async (ctx) => ctx.reply(HELP, { parse_mode: 'HTML', reply_markup: backMenu() }).then(() => {})));
  bot.command('menu', guard(home));
  bot.command('wallet', guard(showWallet));
  bot.command(['balance', 'balances', 'positions'], guard(showPositions));
  bot.command('settings', guard(showSettings));
  bot.command('referral', guard(showReferral));
  bot.command('cashback', guard(showCashback));
  bot.command('send', guard(startSend));
  bot.command('launch', guard(startLaunch));
  bot.command('limit', guard(ordersMenu));
  bot.command('dca', guard(async (ctx) => {
    const id = await ensureWallet(ctx);
    ctx.services.sessions.set(id, { flow: 'dca_token', data: {} });
    await ctx.reply('🔁 <b>DCA</b>\n\nPaste the token coin type to DCA into:', { parse_mode: 'HTML' });
  }));
  bot.command('copy', guard(async (ctx) => {
    const arg = ctx.match?.toString().trim();
    if (arg) {
      const id = await ensureWallet(ctx);
      ctx.services.sessions.update(id, { flow: 'copy_ratio', data: { leader: arg } });
      await ctx.reply('What percent of the leader’s buy to mirror? (e.g. 50)');
    } else await copyMenu(ctx);
  }));
  bot.command('snipe', guard(async (ctx) => {
    const arg = ctx.match?.toString().trim();
    const id = await ensureWallet(ctx);
    if (arg && isValidCoinType(arg)) {
      ctx.services.sessions.set(id, { flow: 'snipe_amount', data: { coinType: arg } });
      await ctx.reply('SUI amount to snipe with?');
    } else await sniperMenu(ctx);
  }));
  bot.command('watch', guard(async (ctx) => {
    const arg = ctx.match?.toString().trim();
    const id = await ensureWallet(ctx);
    if (arg && isValidCoinType(arg)) {
      ctx.services.sessions.set(id, { flow: 'watch_price', data: { coinType: arg } });
      await ctx.reply('Alert price in SUI (or /skip):');
    } else await watchlistMenu(ctx);
  }));
  bot.command('bundle', guard(bundleMenu));
  bot.command('bridge', guard(bridgeMenu));
  bot.command('buy', guard(async (ctx) => startBuy(ctx, ctx.match?.toString().trim() || undefined)));
  bot.command('sell', guard(startSell));
  bot.command('price', guard(async (ctx) => {
    const arg = ctx.match?.toString().trim();
    if (!arg) throw new Error('Usage: /price <coinType>');
    await showPrice(ctx, arg);
  }));
  bot.command('tp', guard(async (ctx) => startSellOrder(ctx, 'take_profit', ctx.match?.toString().trim())));
  bot.command('sl', guard(async (ctx) => startSellOrder(ctx, 'stop_loss', ctx.match?.toString().trim())));

  // Callbacks
  const cb = (data: string, fn: (ctx: BotContext) => Promise<void>) =>
    bot.callbackQuery(data, guard(async (ctx) => {
      await ctx.answerCallbackQuery().catch(() => {});
      await fn(ctx);
    }));

  cb('menu', home);
  bot.callbackQuery('home_ref', guard(async (ctx) => {
    await ctx.answerCallbackQuery('Refreshing…').catch(() => {});
    await home(ctx, true);
  }));
  cb('chain', showChainPicker);
  cb('chain:soon', async (ctx) => { await ctx.reply('That chain is rolling out soon. Live now: Sui & Solana.'); });
  bot.callbackQuery(/^chain:set:(.+)$/, guard(async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const c = ctx.match![1]!;
    if ((LIVE_CHAINS as string[]).includes(c)) await setChain(ctx, c as ChainId);
  }));
  cb('wallet', showWallet);
  cb('positions', showPositions);
  cb('settings', showSettings);
  cb('referral', showReferral);
  cb('cashback', showCashback);
  cb('cashback_claim', async (ctx) => {
    const id = tgId(ctx);
    const s = await ctx.services.cashback.summary(id);
    if (s.unclaimedMist <= 0n) {
      await ctx.reply('No cashback to claim yet. Trade to earn cashback.', { reply_markup: backMenu() });
      return;
    }
    if (!ctx.services.payout) {
      await ctx.reply(`You have ${formatAmount(s.unclaimedMist, 9)} SUI in cashback. On-chain claims enable once the operator configures payouts.`, { reply_markup: backMenu() });
      return;
    }
    if (!(await ctx.services.security.firstSeen(`cbclaim:${id}`, 60))) {
      await ctx.reply('A claim is already being processed. Please wait a moment.', { reply_markup: backMenu() });
      return;
    }
    await ctx.reply('⏳ Sending your cashback…');
    const result = await ctx.services.payout.claimCashback(id);
    if (!result) {
      await ctx.reply(`Minimum claim is ${ctx.services.config.minReferralClaimSui} SUI. Keep trading and try again.`, { reply_markup: backMenu() });
      return;
    }
    await ctx.reply(
      `✅ Paid ${formatAmount(result.amountMist, 9)} SUI cashback to your wallet.\n${link('View transaction', ctx.services.sui.txUrl(result.digest))}`,
      { parse_mode: 'HTML', reply_markup: mainMenu() },
    );
  });
  cb('help', async (ctx) => { await ctx.reply(HELP, { parse_mode: 'HTML', reply_markup: backMenu() }); });
  cb('buy', async (ctx) => startBuy(ctx));
  cb('sell', startSell);
  cb('send', startSend);
  cb('orders', ordersMenu);
  cb('copy', copyMenu);
  cb('sniper', sniperMenu);
  cb('watchlist', watchlistMenu);
  cb('bundle', bundleMenu);
  cb('bridge', bridgeMenu);
  cb('launch', startLaunch);
  cb('subwallets', showSubwallets);

  cb('toggle_mev', async (ctx) => {
    await ctx.services.repo.withUser(tgId(ctx), (u) => { u.settings.mevProtection = !u.settings.mevProtection; });
    await showSettings(ctx);
  });
  cb('set_slippage', async (ctx) => {
    ctx.services.sessions.set(tgId(ctx), { flow: 'set_slippage', data: {} });
    await ctx.reply('Enter slippage % (e.g. 1):');
  });
  cb('toggle_autobuy', async (ctx) => {
    await ctx.services.repo.withUser(tgId(ctx), (u) => { u.settings.autoBuy = !u.settings.autoBuy; });
    await showSettings(ctx);
  });
  cb('set_autobuy', async (ctx) => {
    ctx.services.sessions.set(tgId(ctx), { flow: 'autobuy_amount', data: {} });
    await ctx.reply('⚡ Enter the <b>Auto-Buy amount</b> in SUI (e.g. <code>1</code>). Pasting a token will instantly buy this much.', { parse_mode: 'HTML' });
  });
  cb('ref_claim', async (ctx) => {
    const id = tgId(ctx);
    const summary = await ctx.services.referral.summary(id);
    if (!summary || summary.unclaimedMist <= 0n) {
      await ctx.reply('Nothing to claim yet.', { reply_markup: backMenu() });
      return;
    }
    if (ctx.services.payout) {
      // Idempotency: block double-taps while a payout is in flight.
      if (!(await ctx.services.security.firstSeen(`claim:${id}`, 60))) {
        await ctx.reply('A claim is already being processed. Please wait a moment.', { reply_markup: backMenu() });
        return;
      }
      await ctx.reply('⏳ Sending your referral payout…');
      const result = await ctx.services.payout.claim(id);
      if (!result) {
        const min = ctx.services.config.minReferralClaimSui;
        await ctx.reply(`Minimum claim is ${min} SUI. Keep earning and try again.`, { reply_markup: backMenu() });
        return;
      }
      await ctx.reply(
        `✅ Paid ${formatAmount(result.amountMist, 9)} SUI to your wallet.\n${link('View transaction', ctx.services.sui.txUrl(result.digest))}`,
        { parse_mode: 'HTML', reply_markup: mainMenu() },
      );
      return;
    }
    // No payout wallet configured: earnings stay in the ledger for manual payout.
    await ctx.reply(
      `You have ${formatAmount(summary.unclaimedMist, 9)} SUI in referral earnings. Automatic payouts aren’t enabled yet — the operator will process it to your wallet.`,
      { reply_markup: backMenu() },
    );
  });
  cb('subwallet_add', async (ctx) => {
    const w = await ctx.services.wallet.addSubWallet(tgId(ctx));
    await ctx.reply(`✅ Added ${esc(w.label)}:\n${code(w.address)}\nFund it with SUI to include it in bundles.`, { parse_mode: 'HTML', reply_markup: backMenu() });
  });
  cb('copy_add', async (ctx) => {
    ctx.services.sessions.set(tgId(ctx), { flow: 'copy_leader', data: {} });
    await ctx.reply('Paste the wallet address to copy:');
  });
  cb('snipe_add', async (ctx) => {
    ctx.services.sessions.set(tgId(ctx), { flow: 'snipe_token', data: {} });
    await ctx.reply('Paste the token coin type to snipe:');
  });
  cb('watch_add', async (ctx) => {
    ctx.services.sessions.set(tgId(ctx), { flow: 'watch_token', data: {} });
    await ctx.reply('Paste the token coin type to watch:');
  });
  cb('export', async (ctx) => {
    const secret = await ctx.services.wallet.exportSecret(tgId(ctx));
    await ctx.reply(`🔑 <b>Private key</b> (keep secret!):\n${code(secret)}`, { parse_mode: 'HTML', reply_markup: backMenu() });
  });
  bot.callbackQuery(/^export:(.+)$/, guard(async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const chain = ctx.match![1]!;
    if (!(LIVE_CHAINS as string[]).includes(chain) || chain === 'sui') return;
    const secret = await ctx.services.multiWallet.getSecret(tgId(ctx), chain as ChainId);
    await ctx.reply(`🔑 <b>${esc(CHAINS[chain as ChainId].name)} private key</b> (keep secret!):\n${code(secret)}`, { parse_mode: 'HTML', reply_markup: backMenu() });
  }));

  bot.callbackQuery(/^sl:(\d+)$/, guard(async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const idx = Number(ctx.match![1]);
    const raw = await ctx.services.repo.getMeta(`selllist:${tgId(ctx)}`);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    const coinType = list[idx];
    if (!coinType) {
      await ctx.reply('That list expired — open Sell again.', { reply_markup: backMenu() });
      return;
    }
    const meta = await ctx.services.sui.getCoinMeta(coinType);
    ctx.services.sessions.set(tgId(ctx), { flow: 'sell_amount', data: { coinType } });
    await ctx.reply(`🔴 How much <b>${esc(meta.symbol)}</b> to sell? (amount, or a % like <code>50%</code>)`, { parse_mode: 'HTML' });
  }));

  // Tap a token in Positions to open its full scan card.
  bot.callbackQuery(/^tok:(\d+)$/, guard(async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const idx = Number(ctx.match![1]);
    const raw = await ctx.services.repo.getMeta(`toklist:${tgId(ctx)}`);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    const coinType = list[idx];
    if (!coinType) {
      await ctx.reply('That list expired — open Positions again.', { reply_markup: backMenu() });
      return;
    }
    await promptBuyAmount(ctx, coinType);
  }));

  // Tap a non-Sui position → open its card (token address fits in callback_data).
  bot.callbackQuery(/^xt:(.+)$/, guard(async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const token = ctx.match![1]!;
    const cc = await activeNonSui(ctx);
    if (cc && isChainToken(ctx, token, cc.chain)) await chainCard(ctx, token);
  }));

  // --- Non-Sui chain card callbacks (Solana / EVM / …) ---
  bot.callbackQuery(/^sq:(.+)$/, guard(async (ctx) => {
    const arg = ctx.match![1]!;
    const id = tgId(ctx);
    const cc = await activeNonSui(ctx);
    if (arg === 'x') {
      await ctx.answerCallbackQuery().catch(() => {});
      const cur = await currentChainToken(ctx);
      if (cur) {
        ctx.services.sessions.set(id, { flow: 'sol_buy_amount', data: { coinType: cur.token } });
        await ctx.reply(`How much <b>${esc(cc?.meta.nativeSymbol ?? 'native')}</b> to spend? (e.g. <code>0.75</code>)`, { parse_mode: 'HTML' });
      }
      return;
    }
    await ctx.answerCallbackQuery(`Buying ${arg} ${cc?.meta.nativeSymbol ?? ''}…`).catch(() => {});
    await chainBuy(ctx, arg);
  }));
  bot.callbackQuery('sref', guard(async (ctx) => {
    await ctx.answerCallbackQuery('Refreshing…').catch(() => {});
    const cur = await currentChainToken(ctx);
    if (cur) await chainCard(ctx, cur.token, true);
  }));
  bot.callbackQuery('ssell', guard(async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const kb = new InlineKeyboard()
      .text('25%', 'ssell:25').text('50%', 'ssell:50').text('100%', 'ssell:100')
      .row().text('⬅️ Back', 'sref');
    await ctx.reply('🔴 <b>Sell</b> — what percent of your holdings?', { parse_mode: 'HTML', reply_markup: kb });
  }));
  bot.callbackQuery(/^ssell:(\d+)$/, guard(async (ctx) => {
    await ctx.answerCallbackQuery('Selling…').catch(() => {});
    await chainSell(ctx, Number(ctx.match![1]));
  }));

  bot.callbackQuery(/^qb:(.+)$/, guard(async (ctx) => {
    const arg = ctx.match![1]!;
    const id = tgId(ctx);
    if (arg === 'ref') {
      await ctx.answerCallbackQuery('Refreshing…').catch(() => {});
      const coinType = await ctx.services.repo.getMeta(`buytok:${id}`);
      if (coinType) await promptBuyAmount(ctx, coinType, true); // edit in place
      return;
    }
    if (arg === 'x') {
      await ctx.answerCallbackQuery().catch(() => {});
      const coinType = await ctx.services.repo.getMeta(`buytok:${id}`);
      if (coinType) {
        ctx.services.sessions.set(id, { flow: 'buy_amount', data: { coinType } });
        await ctx.reply('How much <b>SUI</b> to spend? (e.g. <code>1.5</code>)', { parse_mode: 'HTML' });
      }
      return;
    }
    if (arg === 'sell') {
      await ctx.answerCallbackQuery().catch(() => {});
      const coinType = await ctx.services.repo.getMeta(`buytok:${id}`);
      if (!coinType) return;
      const meta = await ctx.services.sui.getCoinMeta(coinType);
      ctx.services.sessions.set(id, { flow: 'sell_amount', data: { coinType } });
      await ctx.reply(`🔴 How much <b>${esc(meta.symbol)}</b> to sell? (or a % like <code>50%</code>)`, { parse_mode: 'HTML' });
      return;
    }
    if (arg === 'auto') {
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.services.repo.withUser(id, (u) => { u.settings.autoBuy = !u.settings.autoBuy; });
      const coinType = await ctx.services.repo.getMeta(`buytok:${id}`);
      if (coinType) await promptBuyAmount(ctx, coinType, true);
      return;
    }
    if (arg === 'lim') {
      await ctx.answerCallbackQuery().catch(() => {});
      const coinType = await ctx.services.repo.getMeta(`buytok:${id}`);
      if (!coinType) return;
      await limitBuilder(ctx, coinType);
      return;
    }
    await ctx.answerCallbackQuery(`Buying ${arg} SUI…`).catch(() => {});
    await quickBuy(ctx, arg);
  }));
  bot.callbackQuery(/^lim:(buy|sell):(\d+)$/, guard(async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const id = tgId(ctx);
    const side = ctx.match![1] as 'buy' | 'sell';
    const pct = Number(ctx.match![2]);
    const coinType = await ctx.services.repo.getMeta(`buytok:${id}`);
    if (!coinType) return;
    const info = await ctx.services.dex.token(coinType).catch(() => null);
    const priceNum = info?.priceNative || (await ctx.services.oracle.priceNumber(coinType).catch(() => null)) || 0;
    if (priceNum <= 0) {
      await ctx.reply('⚠️ No live price to anchor to yet. Use ✏️ Custom to set an exact target.');
      return;
    }
    // Dip-buy targets a lower price; take-profit targets a higher price.
    const factor = side === 'buy' ? 1 - pct / 100 : 1 + pct / 100;
    const trigger = (priceNum * factor).toPrecision(6);
    if (side === 'buy') {
      ctx.services.sessions.set(id, { flow: 'order_size', data: { kind: 'limit_buy', coinType, triggerPrice: trigger } });
      await ctx.reply(
        `🎯 <b>Limit buy set at ${esc(trigger)} SUI</b> (−${pct}% from now).\n\nHow much <b>SUI</b> should I spend when it triggers?`,
        { parse_mode: 'HTML' },
      );
    } else {
      ctx.services.sessions.set(id, { flow: 'order_size', data: { kind: 'limit_sell', coinType, triggerPrice: trigger } });
      await ctx.reply(
        `📈 <b>Take profit set at ${esc(trigger)} SUI</b> (+${pct}% from now).\n\nWhat <b>percent</b> of your holdings should I sell (1–100)?`,
        { parse_mode: 'HTML' },
      );
    }
  }));
  bot.callbackQuery(/^lim:cust:(buy|sell)$/, guard(async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const id = tgId(ctx);
    const side = ctx.match![1] as 'buy' | 'sell';
    const coinType = await ctx.services.repo.getMeta(`buytok:${id}`);
    if (!coinType) return;
    const kind = side === 'buy' ? 'limit_buy' : 'limit_sell';
    ctx.services.sessions.set(id, { flow: 'order_price', data: { kind, coinType } });
    await ctx.reply(
      side === 'buy'
        ? '✏️ Enter your <b>target buy price</b> in SUI per token (fires when the price falls to it):'
        : '✏️ Enter your <b>target sell price</b> in SUI per token (fires when the price rises to it):',
      { parse_mode: 'HTML' },
    );
  }));
  bot.callbackQuery(/^order:(.+)$/, guard(async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const kind = ctx.match![1]!;
    const id = tgId(ctx);
    if (kind === 'dca') {
      ctx.services.sessions.set(id, { flow: 'dca_token', data: {} });
      await ctx.reply('Paste the token coin type to DCA into:');
      return;
    }
    ctx.services.sessions.set(id, { flow: 'order_token', data: { kind } });
    await ctx.reply('Paste the token coin type:');
  }));

  bot.callbackQuery('confirm_swap', guard(async (ctx) => { await ctx.answerCallbackQuery().catch(() => {}); await executeSwap(ctx); }));
  bot.callbackQuery('confirm_launch', guard(async (ctx) => { await ctx.answerCallbackQuery().catch(() => {}); await executeLaunch(ctx); }));
  bot.callbackQuery('cancel', guard(async (ctx) => {
    await ctx.answerCallbackQuery('Cancelled').catch(() => {});
    ctx.services.sessions.clear(tgId(ctx));
    await ctx.reply('Cancelled.', { reply_markup: mainMenu() });
  }));

  bot.on('message:text', guard(onText));
}

async function startSellOrder(ctx: BotContext, kind: 'take_profit' | 'stop_loss', coinType?: string): Promise<void> {
  const id = await ensureWallet(ctx);
  if (coinType && isValidCoinType(coinType)) {
    ctx.services.sessions.set(id, { flow: 'order_price', data: { kind, coinType } });
    await ctx.reply('Enter your target price in SUI per token — the order fires when the price reaches it:');
  } else {
    ctx.services.sessions.set(id, { flow: 'order_token', data: { kind } });
    await ctx.reply('Paste the token coin type:');
  }
}
