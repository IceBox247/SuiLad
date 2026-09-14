import BN from 'bn.js';
import { AggregatorClient, Env, type RouterData } from '@cetusprotocol/aggregator-sdk';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiClient } from '@mysten/sui/client';
import type { BuildSwapParams, Quote, QuoteRequest, SwapProvider } from '../types.js';
import { applySlippage } from '../quote.js';

/**
 * Live routing via the Cetus DEX Aggregator, which splits orders across many
 * Sui DEXes (Cetus, Aftermath, DeepBook, Turbos, FlowX, Kriya, …) for best
 * execution. The aggregator operates on Sui mainnet; on other networks live
 * routing is generally unavailable — use the mock provider there.
 */
export class CetusAggregatorProvider implements SwapProvider {
  readonly name = 'cetus';
  private readonly env: Env;

  constructor(
    private readonly suiClient: SuiClient,
    network: string,
    private readonly endpoint?: string,
    private readonly partner?: string,
  ) {
    this.env = network === 'testnet' ? Env.Testnet : Env.Mainnet;
  }

  private newClient(signer?: string): AggregatorClient {
    return new AggregatorClient({
      client: this.suiClient,
      signer,
      env: this.env,
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
      ...(this.partner ? { partner: this.partner } : {}),
    });
  }

  async quote(req: QuoteRequest): Promise<Quote> {
    const client = this.newClient();
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
    const { quote, sender } = params;
    const routerData = quote.raw as RouterData | undefined;
    if (!routerData) throw new Error('Missing route data; re-quote before executing.');
    const client = this.newClient(sender);
    const tx = new Transaction();
    tx.setSender(sender);
    // fastRouterSwap pulls the input coins from `signer`, performs the routed
    // swap, enforces the slippage-adjusted minimum, and returns output to sender.
    await client.fastRouterSwap({
      routers: routerData,
      txb: tx,
      slippage: quote.slippageBps / 10_000,
      byAmountIn: true,
    });
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
