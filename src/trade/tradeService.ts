import { randomUUID } from 'node:crypto';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SwapProvider, Quote, FeeSpec } from './types.js';
import { applySlippage } from './quote.js';
import { splitFee } from './fees.js';
import { SuiService, SUI_TYPE, type CoinMeta } from '../sui/service.js';
import type { Repo } from '../storage/repo.js';
import type { ReferralService } from '../services/referralService.js';
import type { TradeRecord, Position } from '../storage/types.js';
import { toBaseUnits, formatAmount } from '../util/format.js';

export interface TradeServiceOptions {
  tradingFeeBps: number; // actually charged (e.g. 110 = 1.1%)
  displayFeeBps: number; // shown to users (e.g. 100 = 1%)
  feeWallet: string;
  priorityGasMist?: bigint;
}

export interface PreparedQuote {
  quote: Quote;
  inputMeta: CoinMeta;
  outputMeta: CoinMeta;
  kind: 'buy' | 'sell' | 'swap';
  grossIn: bigint;
  /** SUI value of the platform fee (MIST) — used for referral accounting. */
  feeSuiValue: bigint;
  feeSpec?: FeeSpec;
  /** Net token amount the user actually receives (after any output-side fee). */
  userReceives: bigint;
  display: {
    amountIn: string;
    amountOut: string;
    minReceive: string;
    feeShown: string; // displayed fee (1%) in SUI
    displayFeePct: string;
    rate: string;
  };
}

export class TradeService {
  constructor(
    private readonly provider: SwapProvider,
    private readonly sui: SuiService,
    private readonly repo: Repo,
    private readonly referral: ReferralService,
    private readonly opts: TradeServiceOptions,
    private readonly cashback?: import('../services/cashbackService.js').CashbackService,
  ) {}

  async prepareQuote(params: {
    inputType: string;
    outputType: string;
    humanAmount: string;
    slippageBps: number;
  }): Promise<PreparedQuote> {
    const [inputMeta, outputMeta] = await Promise.all([
      this.sui.getCoinMeta(params.inputType),
      this.sui.getCoinMeta(params.outputType),
    ]);
    const grossIn = toBaseUnits(params.humanAmount, inputMeta.decimals);
    if (grossIn <= 0n) throw new Error('Amount must be greater than zero.');

    const isBuy = params.inputType === SUI_TYPE;
    const isSell = params.outputType === SUI_TYPE;
    const kind: 'buy' | 'sell' | 'swap' = isBuy ? 'buy' : isSell ? 'sell' : 'swap';
    const feeActive = this.opts.tradingFeeBps > 0 && Boolean(this.opts.feeWallet);

    let routedIn = grossIn;
    let feeSpec: FeeSpec | undefined;
    let feeSuiValue = 0n;

    // Buy: fee taken from SUI input up-front; route the remainder.
    if (isBuy && feeActive) {
      const { fee, net } = splitFee(grossIn, this.opts.tradingFeeBps);
      routedIn = net;
      feeSuiValue = fee;
      feeSpec = { amount: fee, wallet: this.opts.feeWallet, onOutput: false };
    }

    const quote = await this.provider.quote({
      inputType: params.inputType,
      outputType: params.outputType,
      amountIn: routedIn,
      slippageBps: params.slippageBps,
    });

    // Sell: fee taken from the SUI output after routing the full amount.
    let userReceives = quote.amountOut;
    if (isSell && feeActive) {
      const { fee } = splitFee(quote.amountOut, this.opts.tradingFeeBps);
      feeSuiValue = fee;
      feeSpec = { amount: fee, wallet: this.opts.feeWallet, onOutput: true };
      userReceives = quote.amountOut - fee;
    }

    const minSwap = applySlippage(quote.amountOut, params.slippageBps);
    const minReceive = isSell && feeActive ? bigMax(minSwap - feeSuiValue, 0n) : minSwap;

    // Displayed fee uses the (lower) display bps; SUI value of display fee.
    const feeShownSui =
      feeActive
        ? isSell
          ? (quote.amountOut * BigInt(this.opts.displayFeeBps)) / 10_000n
          : (grossIn * BigInt(this.opts.displayFeeBps)) / 10_000n
        : 0n;

    const rate =
      quote.amountIn > 0n
        ? formatAmount((quote.amountOut * 10n ** BigInt(inputMeta.decimals)) / quote.amountIn, outputMeta.decimals)
        : '0';

    return {
      quote,
      inputMeta,
      outputMeta,
      kind,
      grossIn,
      feeSuiValue,
      feeSpec,
      userReceives,
      display: {
        amountIn: formatAmount(grossIn, inputMeta.decimals),
        amountOut: formatAmount(quote.amountOut, outputMeta.decimals),
        minReceive: formatAmount(minReceive, outputMeta.decimals),
        feeShown: formatAmount(feeShownSui, 9),
        displayFeePct: `${this.opts.displayFeeBps / 100}%`,
        rate,
      },
    };
  }

  /** Execute a prepared quote with a specific signer (main or a sub-wallet). */
  async execute(params: {
    telegramId: string;
    prepared: PreparedQuote;
    signer: Ed25519Keypair;
    tradeKind?: TradeRecord['kind'];
  }): Promise<{ digest: string; tradeId: string }> {
    const { telegramId, prepared, signer } = params;
    const tradeId = randomUUID();
    const record: TradeRecord = {
      id: tradeId,
      kind: params.tradeKind ?? prepared.kind,
      inputType: prepared.quote.inputType,
      outputType: prepared.quote.outputType,
      inputAmount: prepared.grossIn.toString(),
      expectedOutput: prepared.quote.amountOut.toString(),
      status: 'submitted',
      createdAt: new Date().toISOString(),
    };
    await this.repo.withUser(telegramId, (u) => {
      u.trades.unshift(record);
    });

    try {
      const tx = await this.provider.buildTransaction({
        quote: prepared.quote,
        signer,
        sender: signer.toSuiAddress(),
        fee: prepared.feeSpec,
        priorityGasMist: this.opts.priorityGasMist,
      });
      const { digest } = await this.sui.execute(signer, tx);

      await this.repo.withUser(telegramId, (u) => {
        const t = u.trades.find((x) => x.id === tradeId);
        if (t) {
          t.status = 'success';
          t.digest = digest;
        }
        updatePosition(u.positions, prepared);
      });

      // Referral payout + trader cashback accrue from the platform fee (best-effort).
      if (prepared.feeSuiValue > 0n) {
        await this.referral.creditFees(telegramId, prepared.feeSuiValue).catch(() => {});
        await this.cashback?.credit(telegramId, prepared.feeSuiValue).catch(() => {});
      }
      return { digest, tradeId };
    } catch (err) {
      await this.repo.withUser(telegramId, (u) => {
        const t = u.trades.find((x) => x.id === tradeId);
        if (t) {
          t.status = 'failed';
          t.error = (err as Error).message;
        }
      });
      throw err;
    }
  }
}

function bigMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** Update the user's tracked position for PnL/TP/SL after a fill. */
function updatePosition(positions: Position[], p: PreparedQuote): void {
  if (p.kind === 'buy') {
    const coinType = p.quote.outputType;
    let pos = positions.find((x) => x.coinType === coinType);
    if (!pos) {
      pos = {
        coinType,
        symbol: p.outputMeta.symbol,
        decimals: p.outputMeta.decimals,
        amount: '0',
        costMist: '0',
        realizedPnlMist: '0',
        updatedAt: new Date().toISOString(),
      };
      positions.push(pos);
    }
    pos.amount = (BigInt(pos.amount) + p.quote.amountOut).toString();
    pos.costMist = (BigInt(pos.costMist) + p.grossIn).toString(); // grossIn is MIST (SUI in)
    pos.updatedAt = new Date().toISOString();
  } else if (p.kind === 'sell') {
    const coinType = p.quote.inputType;
    const pos = positions.find((x) => x.coinType === coinType);
    if (!pos) return;
    const held = BigInt(pos.amount);
    const sold = p.grossIn > held ? held : p.grossIn; // grossIn is token base units on sells
    const cost = BigInt(pos.costMist);
    const costPortion = held > 0n ? (cost * sold) / held : 0n;
    const proceeds = p.userReceives; // MIST received
    pos.realizedPnlMist = (BigInt(pos.realizedPnlMist) + (proceeds - costPortion)).toString();
    pos.amount = (held - sold).toString();
    pos.costMist = (cost - costPortion).toString();
    pos.updatedAt = new Date().toISOString();
  }
}
