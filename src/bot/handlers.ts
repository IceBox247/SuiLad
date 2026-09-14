import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from './context.js';
import {
  HELP,
  WELCOME,
  addrLabel,
  backMenu,
  code,
  confirmCancel,
  esc,
  link,
  mainMenu,
  walletMenu,
} from './ui.js';
import { SUI_TYPE } from '../sui/service.js';
import { isValidCoinType, isValidSuiAddress, isPositiveAmount } from '../util/validate.js';
import { isValidSecretKey } from '../sui/wallet.js';
import { formatAmount } from '../util/format.js';
import type { PreparedQuote } from '../trade/tradeService.js';
import type { LaunchParams } from '../launch/types.js';

const tgId = (ctx: BotContext): string => String(ctx.from?.id ?? '');

/** Wrap a handler so thrown errors are reported to the user instead of crashing. */
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
  if (!ctx.services.wallet.hasWallet(id)) {
    const { address } = await ctx.services.wallet.create(id);
    await ctx.reply(WELCOME(address), { parse_mode: 'HTML', reply_markup: mainMenu() });
  }
  return id;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

async function showMenu(ctx: BotContext): Promise<void> {
  const id = tgId(ctx);
  const address = ctx.services.wallet.getAddress(id);
  if (!address) {
    const { address: created } = await ctx.services.wallet.create(id);
    await ctx.reply(WELCOME(created), { parse_mode: 'HTML', reply_markup: mainMenu() });
    return;
  }
  await ctx.reply(WELCOME(address), { parse_mode: 'HTML', reply_markup: mainMenu() });
}

async function showWallet(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const address = ctx.services.wallet.getAddress(id)!;
  const bal = await ctx.services.sui.getBalance(address, SUI_TYPE);
  const text = [
    '💼 <b>Your Wallet</b>',
    '',
    addrLabel(address),
    '',
    `SUI balance: <b>${esc(formatAmount(bal, 9))}</b>`,
  ].join('\n');
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: walletMenu(address) });
}

async function showBalances(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const address = ctx.services.wallet.getAddress(id)!;
  const holdings = await ctx.services.sui.getHoldings(address);
  if (holdings.length === 0) {
    await ctx.reply('📊 No balances yet. Fund your wallet with SUI to get started.', {
      parse_mode: 'HTML',
      reply_markup: backMenu(),
    });
    return;
  }
  const lines = holdings.map(
    (h) => `• <b>${esc(h.symbol)}</b>: ${esc(h.formatted)}  ${code(h.coinType)}`,
  );
  await ctx.reply(['📊 <b>Your Balances</b>', '', ...lines].join('\n'), {
    parse_mode: 'HTML',
    reply_markup: backMenu(),
  });
}

async function showSettings(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const user = ctx.services.store.getUser(id)!;
  const kb = new InlineKeyboard()
    .text('Set slippage', 'set_slippage')
    .row()
    .text('⬅️ Back', 'menu');
  await ctx.reply(
    [
      '⚙️ <b>Settings</b>',
      '',
      `Slippage tolerance: <b>${(user.settings.slippageBps / 100).toString()}%</b>`,
      `Network: <b>${esc(ctx.services.config.network)}</b>`,
      `Swap router: <b>${esc(ctx.services.config.swapProvider)}</b>`,
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: kb },
  );
}

async function showPositions(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const user = ctx.services.store.getUser(id)!;
  const trades = user.trades.slice(0, 5);
  const launches = user.launches.slice(0, 5);
  const parts: string[] = ['📈 <b>Recent Activity</b>', ''];
  if (trades.length) {
    parts.push('<b>Trades</b>');
    for (const t of trades) {
      const status = t.status === 'success' ? '✅' : t.status === 'failed' ? '❌' : '⏳';
      parts.push(`${status} ${t.kind.toUpperCase()} ${esc(shortType(t.outputType))} — ${esc(t.status)}`);
    }
    parts.push('');
  }
  if (launches.length) {
    parts.push('<b>Launches</b>');
    for (const l of launches) {
      const status = l.status === 'success' ? '✅' : l.status === 'failed' ? '❌' : '⏳';
      parts.push(`${status} ${esc(l.symbol)} (${esc(l.name)}) — ${esc(l.status)}`);
    }
  }
  if (trades.length === 0 && launches.length === 0) parts.push('<i>Nothing yet.</i>');
  await ctx.reply(parts.join('\n'), { parse_mode: 'HTML', reply_markup: backMenu() });
}

// ---------------------------------------------------------------------------
// Buy / Sell
// ---------------------------------------------------------------------------

async function startBuy(ctx: BotContext, coinType?: string): Promise<void> {
  const id = await ensureWallet(ctx);
  if (coinType && isValidCoinType(coinType)) {
    ctx.services.sessions.set(id, { flow: 'buy_amount', data: { coinType } });
    await ctx.reply(
      `🟢 Buying ${code(coinType)}\n\nHow much <b>SUI</b> do you want to spend? (e.g. <code>1.5</code>)`,
      { parse_mode: 'HTML' },
    );
    return;
  }
  ctx.services.sessions.set(id, { flow: 'buy_token', data: {} });
  await ctx.reply(
    '🟢 <b>Buy a token</b>\n\nPaste the token <b>coin type</b> you want to buy, e.g.\n' +
      code('0xabc...::coin::COIN'),
    { parse_mode: 'HTML' },
  );
}

async function startSell(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  const address = ctx.services.wallet.getAddress(id)!;
  const holdings = (await ctx.services.sui.getHoldings(address)).filter((h) => h.coinType !== SUI_TYPE);
  if (holdings.length === 0) {
    await ctx.reply('🔴 You have no non-SUI tokens to sell.', {
      parse_mode: 'HTML',
      reply_markup: backMenu(),
    });
    return;
  }
  const kb = new InlineKeyboard();
  for (const h of holdings.slice(0, 20)) {
    kb.text(`${h.symbol} (${h.formatted})`, `sell:${h.coinType}`).row();
  }
  kb.text('⬅️ Back', 'menu');
  await ctx.reply('🔴 <b>Sell a token</b>\n\nPick a token to sell:', {
    parse_mode: 'HTML',
    reply_markup: kb,
  });
}

async function askSellAmount(ctx: BotContext, coinType: string): Promise<void> {
  const id = tgId(ctx);
  const meta = await ctx.services.sui.getCoinMeta(coinType);
  ctx.services.sessions.set(id, { flow: 'sell_amount', data: { coinType } });
  await ctx.reply(`How much <b>${esc(meta.symbol)}</b> do you want to sell?`, { parse_mode: 'HTML' });
}

async function prepareAndConfirm(
  ctx: BotContext,
  kind: 'buy' | 'sell',
  inputType: string,
  outputType: string,
  humanAmount: string,
): Promise<void> {
  const id = tgId(ctx);
  const user = ctx.services.store.getUser(id)!;
  const prepared = await ctx.services.trade.prepareQuote({
    inputType,
    outputType,
    humanAmount,
    slippageBps: user.settings.slippageBps,
  });
  ctx.services.pending.set(`${id}:quote`, { prepared, kind });
  const text = [
    kind === 'buy' ? '🟢 <b>Confirm Buy</b>' : '🔴 <b>Confirm Sell</b>',
    '',
    `Pay: <b>${esc(prepared.display.amountIn)} ${esc(prepared.inputMeta.symbol)}</b>`,
    `Receive (est.): <b>${esc(prepared.display.amountOut)} ${esc(prepared.outputMeta.symbol)}</b>`,
    `Min received: <b>${esc(prepared.display.minAmountOut)} ${esc(prepared.outputMeta.symbol)}</b>`,
    prepared.feeAmount > 0n ? `Platform fee: ${esc(prepared.display.fee)} ${esc(prepared.inputMeta.symbol)}` : '',
    prepared.quote.routeLabel ? `Route: <i>${esc(prepared.quote.routeLabel)}</i>` : '',
    `Slippage: ${prepared.quote.slippageBps / 100}%`,
  ]
    .filter(Boolean)
    .join('\n');
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: confirmCancel('confirm_swap') });
}

async function executeSwap(ctx: BotContext): Promise<void> {
  const id = tgId(ctx);
  const entry = ctx.services.pending.get(`${id}:quote`) as
    | { prepared: PreparedQuote; kind: 'buy' | 'sell' }
    | undefined;
  if (!entry) {
    await ctx.reply('That quote expired. Please start again.', { reply_markup: backMenu() });
    return;
  }
  ctx.services.pending.delete(`${id}:quote`);
  await ctx.reply('⏳ Submitting swap…');
  const signer = ctx.services.wallet.getKeypair(id);
  const { digest } = await ctx.services.trade.execute({
    telegramId: id,
    prepared: entry.prepared,
    signer,
    kind: entry.kind,
  });
  await ctx.reply(`✅ <b>Swap submitted!</b>\n\n${link('View on explorer', ctx.services.sui.txUrl(digest))}`, {
    parse_mode: 'HTML',
    reply_markup: mainMenu(),
  });
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

async function showPrice(ctx: BotContext, coinType: string): Promise<void> {
  if (!isValidCoinType(coinType)) throw new Error('Please provide a valid coin type, e.g. 0xabc::coin::COIN');
  const user = ctx.services.store.getUser(tgId(ctx));
  const slippageBps = user?.settings.slippageBps ?? ctx.services.config.defaultSlippageBps;
  const prepared = await ctx.services.trade.prepareQuote({
    inputType: SUI_TYPE,
    outputType: coinType,
    humanAmount: '1',
    slippageBps,
  });
  await ctx.reply(
    [
      `💱 <b>${esc(prepared.outputMeta.symbol)}</b> price`,
      '',
      `1 SUI ≈ <b>${esc(prepared.display.amountOut)} ${esc(prepared.outputMeta.symbol)}</b>`,
      prepared.quote.routeLabel ? `Route: <i>${esc(prepared.quote.routeLabel)}</i>` : '',
      code(coinType),
    ]
      .filter(Boolean)
      .join('\n'),
    { parse_mode: 'HTML', reply_markup: backMenu() },
  );
}

// ---------------------------------------------------------------------------
// Send / transfer
// ---------------------------------------------------------------------------

async function startSend(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  ctx.services.sessions.set(id, { flow: 'send_recipient', data: {} });
  await ctx.reply('📤 <b>Send SUI</b>\n\nPaste the recipient Sui address:', { parse_mode: 'HTML' });
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

const LAUNCH_STEPS = ['name', 'symbol', 'decimals', 'supply', 'description'] as const;

async function startLaunch(ctx: BotContext): Promise<void> {
  const id = await ensureWallet(ctx);
  ctx.services.sessions.set(id, { flow: 'launch', step: 0, data: {} });
  await ctx.reply(
    [
      '🚀 <b>Launch a new token</b>',
      '',
      "Let's set it up. First — what's the token <b>name</b>? (e.g. <code>My Coin</code>)",
    ].join('\n'),
    { parse_mode: 'HTML' },
  );
}

async function handleLaunchStep(ctx: BotContext, text: string): Promise<void> {
  const id = tgId(ctx);
  const state = ctx.services.sessions.get(id)!;
  const step = state.step ?? 0;
  const field = LAUNCH_STEPS[step]!;

  // Validate & store the current answer.
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
      if (!Number.isInteger(d) || d < 0 || d > 18) throw new Error('Decimals must be an integer 0–18.');
      state.data.decimals = String(d);
      break;
    }
    case 'supply': {
      if (!/^\d+$/.test(text.trim())) throw new Error('Supply must be a whole number (e.g. 1000000).');
      state.data.supply = text.trim();
      break;
    }
    case 'description':
      state.data.description = text.trim() === '/skip' ? '' : text.trim();
      break;
  }

  const nextStep = step + 1;
  if (nextStep < LAUNCH_STEPS.length) {
    ctx.services.sessions.update(id, { step: nextStep, data: state.data });
    await ctx.reply(launchPrompt(LAUNCH_STEPS[nextStep]!), { parse_mode: 'HTML' });
    return;
  }

  // All fields collected → build params, preview, confirm.
  const params: LaunchParams = {
    name: state.data.name!,
    symbol: state.data.symbol!,
    decimals: Number(state.data.decimals),
    description: state.data.description ?? '',
    initialSupply: BigInt(state.data.supply ?? '0'),
    iconUrl: undefined,
    keepMintAuthority: true,
  };
  ctx.services.pending.set(`${id}:launch`, params);
  ctx.services.sessions.clear(id);

  const preview = ctx.services.launch.previewSource(params);
  const summary = [
    '🚀 <b>Review your token</b>',
    '',
    `Name: <b>${esc(params.name)}</b>`,
    `Symbol: <b>${esc(params.symbol)}</b>`,
    `Decimals: <b>${params.decimals}</b>`,
    `Initial supply: <b>${esc(params.initialSupply.toString())}</b>`,
    params.description ? `Description: ${esc(params.description)}` : '',
    '',
    'Move module preview:',
    `<pre>${esc(preview.source)}</pre>`,
    'Publishing costs a small amount of SUI in gas. Confirm to deploy.',
  ]
    .filter(Boolean)
    .join('\n');
  await ctx.reply(summary, { parse_mode: 'HTML', reply_markup: confirmCancel('confirm_launch') });
}

function launchPrompt(field: (typeof LAUNCH_STEPS)[number]): string {
  switch (field) {
    case 'symbol':
      return 'Great. Now the <b>symbol / ticker</b> (2–10 letters, e.g. <code>MYC</code>):';
    case 'decimals':
      return 'How many <b>decimals</b>? (9 is standard on Sui)';
    case 'supply':
      return 'What <b>total initial supply</b> (whole tokens) should be minted to you? (e.g. <code>1000000</code>)';
    case 'description':
      return 'Add a short <b>description</b>, or send <code>/skip</code>:';
    default:
      return 'Enter a value:';
  }
}

async function executeLaunch(ctx: BotContext): Promise<void> {
  const id = tgId(ctx);
  const params = ctx.services.pending.get(`${id}:launch`) as LaunchParams | undefined;
  if (!params) {
    await ctx.reply('That launch expired. Start again with /launch.', { reply_markup: backMenu() });
    return;
  }
  ctx.services.pending.delete(`${id}:launch`);
  await ctx.reply('⏳ Compiling and publishing your coin… this can take a moment.');
  const signer = ctx.services.wallet.getKeypair(id);
  const result = await ctx.services.launch.launch({ telegramId: id, signer, coin: params });
  await ctx.reply(
    [
      '🎉 <b>Token launched!</b>',
      '',
      `Coin type:\n${code(result.coinType)}`,
      `Package: ${code(result.packageId)}`,
      result.treasuryCapId ? `Treasury cap: ${code(result.treasuryCapId)}` : '',
      '',
      link('View transaction', ctx.services.sui.txUrl(result.digest)),
    ]
      .filter(Boolean)
      .join('\n'),
    { parse_mode: 'HTML', reply_markup: mainMenu() },
  );
}

// ---------------------------------------------------------------------------
// Text router (multi-step flows)
// ---------------------------------------------------------------------------

async function onText(ctx: BotContext): Promise<void> {
  const id = tgId(ctx);
  const state = ctx.services.sessions.get(id);
  const text = ctx.message?.text?.trim() ?? '';
  if (!state || text.startsWith('/')) return; // commands handled elsewhere

  switch (state.flow) {
    case 'import_wallet': {
      if (!isValidSecretKey(text)) throw new Error('That does not look like a valid Sui private key.');
      ctx.services.sessions.clear(id);
      const { address } = await ctx.services.wallet.import(id, text);
      await ctx.reply(`✅ Wallet imported.\n${code(address)}`, {
        parse_mode: 'HTML',
        reply_markup: mainMenu(),
      });
      // Best-effort: delete the message containing the secret.
      await ctx.deleteMessage().catch(() => {});
      return;
    }
    case 'buy_token': {
      if (!isValidCoinType(text)) throw new Error('That is not a valid coin type.');
      ctx.services.sessions.set(id, { flow: 'buy_amount', data: { coinType: text } });
      await ctx.reply('How much <b>SUI</b> do you want to spend?', { parse_mode: 'HTML' });
      return;
    }
    case 'buy_amount': {
      if (!isPositiveAmount(text)) throw new Error('Enter a positive amount, e.g. 1.5');
      ctx.services.sessions.clear(id);
      await prepareAndConfirm(ctx, 'buy', SUI_TYPE, state.data.coinType!, text);
      return;
    }
    case 'sell_amount': {
      if (!isPositiveAmount(text)) throw new Error('Enter a positive amount.');
      ctx.services.sessions.clear(id);
      await prepareAndConfirm(ctx, 'sell', state.data.coinType!, SUI_TYPE, text);
      return;
    }
    case 'set_slippage': {
      const pct = Number(text);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 50) throw new Error('Enter a slippage % between 0 and 50.');
      ctx.services.sessions.clear(id);
      await ctx.services.store.updateSettings(id, { slippageBps: Math.round(pct * 100) });
      await ctx.reply(`✅ Slippage set to ${pct}%.`, { reply_markup: backMenu() });
      return;
    }
    case 'send_recipient': {
      if (!isValidSuiAddress(text)) throw new Error('That is not a valid Sui address.');
      ctx.services.sessions.set(id, { flow: 'send_amount', data: { recipient: text } });
      await ctx.reply('How much <b>SUI</b> to send?', { parse_mode: 'HTML' });
      return;
    }
    case 'send_amount': {
      if (!isPositiveAmount(text)) throw new Error('Enter a positive amount.');
      const recipient = state.data.recipient!;
      ctx.services.sessions.clear(id);
      await ctx.reply('⏳ Sending…');
      const signer = ctx.services.wallet.getKeypair(id);
      const { toBaseUnits } = await import('../util/format.js');
      const { digest } = await ctx.services.sui.transfer({
        signer,
        recipient,
        coinType: SUI_TYPE,
        amount: toBaseUnits(text, 9),
      });
      await ctx.reply(`✅ Sent!\n${link('View transaction', ctx.services.sui.txUrl(digest))}`, {
        parse_mode: 'HTML',
        reply_markup: mainMenu(),
      });
      return;
    }
    case 'launch':
      await handleLaunchStep(ctx, text);
      return;
  }
}

function shortType(coinType: string): string {
  const parts = coinType.split('::');
  return parts[parts.length - 1] ?? coinType;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerHandlers(bot: Bot<BotContext>): void {
  bot.command('start', guard(async (ctx) => {
    await ensureWallet(ctx);
    await showMenu(ctx);
  }));
  bot.command('help', guard(async (ctx) => {
    await ctx.reply(HELP, { parse_mode: 'HTML', reply_markup: backMenu() });
  }));
  bot.command('wallet', guard(showWallet));
  bot.command(['balance', 'balances'], guard(showBalances));
  bot.command('settings', guard(showSettings));
  bot.command('positions', guard(showPositions));
  bot.command('send', guard(startSend));
  bot.command('launch', guard(startLaunch));
  bot.command('buy', guard(async (ctx) => {
    const arg = ctx.match?.toString().trim();
    await startBuy(ctx, arg || undefined);
  }));
  bot.command('sell', guard(startSell));
  bot.command('price', guard(async (ctx) => {
    const arg = ctx.match?.toString().trim();
    if (!arg) throw new Error('Usage: /price <coinType>');
    await showPrice(ctx, arg);
  }));

  // Callback queries (inline buttons)
  bot.callbackQuery('menu', guard(async (ctx) => { await ctx.answerCallbackQuery(); await showMenu(ctx); }));
  bot.callbackQuery('wallet', guard(async (ctx) => { await ctx.answerCallbackQuery(); await showWallet(ctx); }));
  bot.callbackQuery('balances', guard(async (ctx) => { await ctx.answerCallbackQuery(); await showBalances(ctx); }));
  bot.callbackQuery('settings', guard(async (ctx) => { await ctx.answerCallbackQuery(); await showSettings(ctx); }));
  bot.callbackQuery('help', guard(async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply(HELP, { parse_mode: 'HTML', reply_markup: backMenu() }); }));
  bot.callbackQuery('buy', guard(async (ctx) => { await ctx.answerCallbackQuery(); await startBuy(ctx); }));
  bot.callbackQuery('sell', guard(async (ctx) => { await ctx.answerCallbackQuery(); await startSell(ctx); }));
  bot.callbackQuery('launch', guard(async (ctx) => { await ctx.answerCallbackQuery(); await startLaunch(ctx); }));
  bot.callbackQuery('send', guard(async (ctx) => { await ctx.answerCallbackQuery(); await startSend(ctx); }));
  bot.callbackQuery('deposit', guard(async (ctx) => {
    await ctx.answerCallbackQuery();
    const address = ctx.services.wallet.getAddress(tgId(ctx));
    await ctx.reply(`📥 Deposit to:\n${code(address ?? '')}`, { parse_mode: 'HTML', reply_markup: backMenu() });
  }));
  bot.callbackQuery('export', guard(async (ctx) => {
    await ctx.answerCallbackQuery();
    const secret = ctx.services.wallet.exportSecret(tgId(ctx));
    await ctx.reply(
      `🔑 <b>Your private key</b> (keep it secret!):\n${code(secret)}\n\n<i>Anyone with this key controls your funds.</i>`,
      { parse_mode: 'HTML', reply_markup: backMenu() },
    );
  }));
  bot.callbackQuery('set_slippage', guard(async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.services.sessions.set(tgId(ctx), { flow: 'set_slippage', data: {} });
    await ctx.reply('Enter your slippage tolerance in % (e.g. 1 for 1%):');
  }));
  bot.callbackQuery(/^sell:(.+)$/, guard(async (ctx) => {
    await ctx.answerCallbackQuery();
    const coinType = ctx.match![1]!;
    await askSellAmount(ctx, coinType);
  }));
  bot.callbackQuery('confirm_swap', guard(async (ctx) => { await ctx.answerCallbackQuery(); await executeSwap(ctx); }));
  bot.callbackQuery('confirm_launch', guard(async (ctx) => { await ctx.answerCallbackQuery(); await executeLaunch(ctx); }));
  bot.callbackQuery('cancel', guard(async (ctx) => {
    await ctx.answerCallbackQuery('Cancelled');
    ctx.services.sessions.clear(tgId(ctx));
    ctx.services.pending.delete(`${tgId(ctx)}:quote`);
    ctx.services.pending.delete(`${tgId(ctx)}:launch`);
    await ctx.reply('Cancelled.', { reply_markup: mainMenu() });
  }));

  // Free-text (flow steps)
  bot.on('message:text', guard(onText));
}
