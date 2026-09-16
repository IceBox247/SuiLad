import {
  SUPPORTED_CHAINS,
  type BridgeProvider,
  type BridgeQuote,
  type BridgeQuoteRequest,
  type Chain,
} from './types.js';

type FetchLike = (url: string, init?: unknown) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/**
 * HTTP bridge-aggregator provider (deBridge / Mayan). Queries the provider's
 * quote endpoint and normalizes the response. Endpoint shapes vary across
 * provider versions, so the parser is tolerant; verify against the live API and
 * smoke-test on testnet before mainnet use.
 */
export class AggregatorBridgeProvider implements BridgeProvider {
  constructor(
    public readonly name: 'mayan' | 'debridge',
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  supports(from: Chain, to: Chain): boolean {
    return from !== to && SUPPORTED_CHAINS.includes(from) && SUPPORTED_CHAINS.includes(to);
  }

  async quote(req: BridgeQuoteRequest): Promise<BridgeQuote> {
    if (!this.supports(req.fromChain, req.toChain)) {
      throw new Error(`Bridging ${req.fromChain} → ${req.toChain} is not supported.`);
    }
    const url = this.buildUrl(req);
    const res = await this.fetchImpl(url);
    if (!res.ok) {
      throw new Error(`Bridge quote failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    return parseBridgeQuote(await res.json(), req, this.name);
  }

  private buildUrl(req: BridgeQuoteRequest): string {
    const q = new URLSearchParams({
      srcChain: req.fromChain,
      dstChain: req.toChain,
      srcToken: req.fromToken,
      dstToken: req.toToken,
      amount: req.amount,
      dstAddress: req.toAddress,
    });
    return `${this.baseUrl.replace(/\/$/, '')}/quote?${q.toString()}`;
  }
}

/**
 * Tolerant parser for aggregator quote responses. Recognizes several common
 * field names for the destination amount, fee and ETA.
 */
export function parseBridgeQuote(json: unknown, req: BridgeQuoteRequest, provider: string): BridgeQuote {
  const j = (json ?? {}) as Record<string, unknown>;
  const est = (j.estimation ?? j.estimate ?? j) as Record<string, unknown>;

  const amountOut = firstDefined(
    est.dstAmount,
    est.amountOut,
    est.toAmount,
    (est.dstChainTokenOut as Record<string, unknown> | undefined)?.amount,
    est.expectedOutput,
  );
  if (amountOut == null) throw new Error('Bridge quote missing an output amount.');

  const feeUsd = firstDefined(est.feeUsd, est.protocolFeeUsd, j.feeUsd);
  const eta = firstDefined(est.etaSeconds, est.eta, j.estimatedTransferTime);

  return {
    provider,
    fromChain: req.fromChain,
    toChain: req.toChain,
    fromToken: req.fromToken,
    toToken: req.toToken,
    amountIn: req.amount,
    estAmountOut: String(amountOut),
    feeUsd: feeUsd != null ? String(feeUsd) : undefined,
    etaSeconds: eta != null ? Number(eta) : undefined,
    raw: json,
  };
}

function firstDefined(...vals: unknown[]): unknown {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return undefined;
}
