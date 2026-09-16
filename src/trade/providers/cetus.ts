import BN from 'bn.js';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiClient } from '@mysten/sui/client';
import type { RouterData } from '@cetusprotocol/aggregator-sdk';
import type { BuildSwapParams, Quote, QuoteRequest, SwapProvider } from '../types.js';
import { applySlippage } from '../quote.js';
import { SUI_TYPE } from '../../sui/service.js';

/**
 * Live routing via the Cetus DEX Aggregator (splits orders across Cetus,
 * Aftermath, Bluefin, DeepBook, Turbos, FlowX, Kriya, …). Mainnet only for real
 * routing; use the mock provider on other networks.
 *
 * The heavy @cetusprotocol/aggregator-sdk is imported lazily (only when a Sui
 * quote/swap actually runs) so it never inflates serverless cold starts for
 * users trading on other chains.
 */
export class CetusAggregatorProvider implements SwapProvider {
  readonly name = 'cetus';
  private sdk?: typeof import('@cetusprotocol/aggregator-sdk');

  constructor(
    private readonly suiClient: SuiClient,
    private readonly network: string,
    private readonly endpoint?: string,
    private readonly partner?: string,
  ) {}

  private async loadSdk(): Promise<typeof import('@cetusprotocol/aggregator-sdk')> {
    if (!this.sdk) this.sdk = await import('@cetusprotocol/aggregator-sdk');
    return this.sdk;
  }

  private async newClient(signer?: string) {
    const { AggregatorClient, Env } = await this.loadSdk();
    return new AggregatorClient({
      client: this.suiClient,
      signer,
      env: this.network === 'testnet' ? Env.Testnet : Env.Mainnet,
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
      ...(this.partner ? { partner: this.partner } : {}),
    });
  }

  async quote(req: QuoteRequest): Promise<Quote> {
    const client = await this.newClient();
    const routerData = await client.findRouters({
      from: req.inputType,
      target: req.outputType,
      amount: new BN(req.amountIn.toString()),
      byAmountIn: true,
    });
    if (!routerData || routerData.routes.length === 0 || routerData.insufficientLiquidity) {
      throw new Error('No route with sufficient liquidity for this pair/size.');
    }
    const amountOut = BigInt(routerData.amountOut.toString());
    const minAmountOut = applySlippage(amountOut, req.slippageBps);
    return {
      inputType: req.inputType,
      outputType: req.outputType,
      amountIn: req.amountIn,
      amountOut,
      minAmountOut,
      slippageBps: req.slippageBps,
      routeLabel: describeRoute(routerData),
      raw: routerData,
    };
  }

  async buildTransaction(params: BuildSwapParams): Promise<Transaction> {
    const { quote, sender, fee } = params;
    const routerData = quote.raw as RouterData | undefined;
    if (!routerData) throw new Error('Missing route data; re-quote before executing.');
    const { buildInputCoin } = await this.loadSdk();
    const client = await this.newClient(sender);
    const tx = new Transaction();
    tx.setSender(sender);
    const slippage = quote.slippageBps / 10_000;

    if (fee?.onOutput && quote.outputType === SUI_TYPE) {
      // SELL: route to SUI, then split the fee from the received SUI.
      const coins = await client.getCoins(quote.inputType);
      const { targetCoin } = buildInputCoin(tx, coins, BigInt(routerData.amountIn.toString()), quote.inputType);
      const outCoin = await client.routerSwap({ routers: routerData, inputCoin: targetCoin, slippage, txb: tx });
      if (fee.amount > 0n && fee.wallet) {
        const [feeCoin] = tx.splitCoins(outCoin, [fee.amount]);
        tx.transferObjects([feeCoin], fee.wallet);
      }
      tx.transferObjects([outCoin], sender);
      return tx;
    }

    // BUY / token→token: aggregator handles input coins and returns output to sender.
    await client.fastRouterSwap({ routers: routerData, txb: tx, slippage, byAmountIn: true });
    if (fee && !fee.onOutput && fee.amount > 0n && fee.wallet) {
      // Fee taken from SUI input (buys): split from gas.
      const [feeCoin] = tx.splitCoins(tx.gas, [fee.amount]);
      tx.transferObjects([feeCoin], fee.wallet);
    }
    return tx;
  }
}

function describeRoute(routerData: RouterData): string {
  const providers = new Set<string>();
  for (const route of routerData.routes) {
    for (const path of route.path ?? []) {
      if (path?.provider) providers.add(path.provider);
    }
  }
  return providers.size ? [...providers].join(' + ') : 'CETUS-AGG';
}
