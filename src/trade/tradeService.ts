import { randomUUID } from 'node:crypto';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SwapProvider, Quote } from './types.js';
import { deductFee } from './quote.js';
import { SuiService, SUI_TYPE, type CoinMeta } from '../sui/service.js';
import type { Store } from '../storage/store.js';
import { toBaseUnits, formatAmount } from '../util/format.js';

export interface PreparedQuote {
  quote: Quote;
  inputMeta: CoinMeta;
  outputMeta: CoinMeta;
  /** Gross input in base units before the platform fee. */
  grossIn: bigint;
  /** Platform fee taken from input, base units. */
  feeAmount: bigint;
  /** Formatted strings for display. */
  display: {
    amountIn: string;
    amountOut: string;
    minAmountOut: string;
    fee: string;
    rate: string;
  };
}

export class TradeService {
  constructor(
    private readonly provider: SwapProvider,
    private readonly sui: SuiService,
    private readonly store: Store,
    private readonly opts: { platformFeeBps: number; platformFeeAddress: string },
  ) {}

  /**
   * Prepare a quote from a human amount. `inputType`/`outputType` are coin types;
   * for a "buy" the input is SUI, for a "sell" the output is SUI.
   */
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

    // Platform fee only applies cleanly to SUI-denominated input.
    const feeApplies = this.opts.platformFeeBps > 0 && params.inputType === SUI_TYPE;
    const { net, fee } = feeApplies
      ? deductFee(grossIn, this.opts.platformFeeBps)
      : { net: grossIn, fee: 0n };

    const quote = await this.provider.quote({
      inputType: params.inputType,
      outputType: params.outputType,
      amountIn: net,
      slippageBps: params.slippageBps,
    });

    const rate =
      quote.amountIn > 0n
        ? formatAmount(
            (quote.amountOut * 10n ** BigInt(inputMeta.decimals)) / quote.amountIn,
            outputMeta.decimals,
          )
        : '0';

    return {
      quote,
      inputMeta,
      outputMeta,
      grossIn,
      feeAmount: fee,
      display: {
        amountIn: formatAmount(grossIn, inputMeta.decimals),
        amountOut: formatAmount(quote.amountOut, outputMeta.decimals),
        minAmountOut: formatAmount(quote.minAmountOut, outputMeta.decimals),
        fee: formatAmount(fee, inputMeta.decimals),
        rate,
      },
    };
  }

  /** Execute a prepared quote: build the swap tx, add any platform fee, sign & send. */
  async execute(params: {
    telegramId: string;
    prepared: PreparedQuote;
    signer: Ed25519Keypair;
    kind: 'buy' | 'sell' | 'swap';
  }): Promise<{ digest: string; tradeId: string }> {
    const { telegramId, prepared, signer, kind } = params;
    const tradeId = randomUUID();

    await this.store.addTrade(telegramId, {
      id: tradeId,
      kind,
      inputType: prepared.quote.inputType,
      outputType: prepared.quote.outputType,
      inputAmount: prepared.grossIn.toString(),
      expectedOutput: prepared.quote.amountOut.toString(),
      status: 'submitted',
      createdAt: new Date().toISOString(),
    });

    try {
      const tx = await this.provider.buildTransaction({
        quote: prepared.quote,
        signer,
        sender: signer.toSuiAddress(),
      });

      // Add platform fee transfer (SUI only) in the same transaction.
      if (prepared.feeAmount > 0n && this.opts.platformFeeAddress) {
        const [feeCoin] = tx.splitCoins(tx.gas, [prepared.feeAmount]);
        tx.transferObjects([feeCoin], this.opts.platformFeeAddress);
      }

      const { digest } = await this.sui.execute(signer, tx);
      await this.store.updateTrade(telegramId, tradeId, { status: 'success', digest });
      return { digest, tradeId };
    } catch (err) {
      await this.store.updateTrade(telegramId, tradeId, {
        status: 'failed',
        error: (err as Error).message,
      });
      throw err;
    }
  }
}
