import type { WalletService } from './walletService.js';
import type { TradeService } from '../trade/tradeService.js';
import { SUI_TYPE } from '../sui/service.js';

export interface BundleResult {
  walletId: string;
  label: string;
  address: string;
  status: 'success' | 'failed';
  digest?: string;
  error?: string;
}

/**
 * Bundling: buy a token from many wallets (main + sub-wallets) in a single
 * click. Each wallet signs and submits its own transaction; executions run in
 * parallel for speed, and failures are isolated per wallet.
 */
export class BundleService {
  constructor(
    private readonly wallet: WalletService,
    private readonly trade: TradeService,
  ) {}

  /**
   * Buy `amountSuiPerWallet` of `coinType` from each selected wallet.
   * Returns a per-wallet result (isolated failures).
   */
  async bundleBuy(params: {
    telegramId: string;
    coinType: string;
    amountSuiPerWallet: string;
    walletIds: string[];
    slippageBps: number;
  }): Promise<BundleResult[]> {
    const { telegramId, coinType, amountSuiPerWallet, walletIds, slippageBps } = params;
    if (walletIds.length === 0) throw new Error('Select at least one wallet.');

    const wallets = await this.wallet.allWallets(telegramId);
    const chosen = wallets.filter((w) => walletIds.includes(w.id));
    if (chosen.length === 0) throw new Error('No matching wallets found.');

    const runs = chosen.map(async (w): Promise<BundleResult> => {
      try {
        const signer = await this.wallet.keypairFor(telegramId, w.id);
        // Quote per wallet so each execution has a fresh route.
        const prepared = await this.trade.prepareQuote({
          inputType: SUI_TYPE,
          outputType: coinType,
          humanAmount: amountSuiPerWallet,
          slippageBps,
        });
        const { digest } = await this.trade.execute({
          telegramId,
          prepared,
          signer,
          tradeKind: 'bundle',
        });
        return { walletId: w.id, label: w.label, address: w.address, status: 'success', digest };
      } catch (err) {
        return {
          walletId: w.id,
          label: w.label,
          address: w.address,
          status: 'failed',
          error: (err as Error).message,
        };
      }
    });

    return Promise.all(runs);
  }
}
