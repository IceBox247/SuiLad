import { SUPPORTED_CHAINS, type BridgeProvider, type BridgeQuote, type BridgeQuoteRequest, type Chain } from './types.js';

type FetchLike = (url: string, init?: unknown) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const LIFI = 'https://li.quest/v1';

/** LI.FI chain keys per bridge Chain. Sui is not on LI.FI. */
const LIFI_CHAIN: Partial<Record<Chain, string>> = {
  ethereum: 'ETH',
  base: 'BAS',
  arbitrum: 'ARB',
  polygon: 'POL',
  bsc: 'BSC',
  solana: 'SOL',
  arc: 'arc',
  stable: 'sta',
  robinhood: 'out',
};

/**
 * Real cross-chain bridging via LI.FI (keyless). Resolves token symbols to
 * addresses, then asks LI.FI for the best cross-chain route. Returns genuine
 * output amount, fee (USD) and ETA. Execution is performed by signing the
 * returned transactionRequest on the source chain (surfaced in `raw`).
 */
export class LifiBridgeProvider implements BridgeProvider {
  readonly name = 'lifi';

  constructor(private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  supports(from: Chain, to: Chain): boolean {
    return from !== to && Boolean(LIFI_CHAIN[from]) && Boolean(LIFI_CHAIN[to]) && SUPPORTED_CHAINS.includes(from) && SUPPORTED_CHAINS.includes(to);
  }

  /** Resolve a symbol or address to a token address on `chain`. */
  private async resolveToken(chain: string, token: string): Promise<string> {
    if (/^0x[0-9a-fA-F]{40}$/.test(token) || token.length > 30) return token; // already an address/mint
    const res = await this.fetchImpl(`${LIFI}/token?chain=${chain}&token=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error(`Unknown token "${token}" on ${chain}`);
    const j = (await res.json()) as { address?: string };
    if (!j.address) throw new Error(`Unknown token "${token}" on ${chain}`);
    return j.address;
  }

  async quote(req: BridgeQuoteRequest): Promise<BridgeQuote> {
    if (!this.supports(req.fromChain, req.toChain)) {
      throw new Error(`Bridging ${req.fromChain} → ${req.toChain} isn't supported yet (Sui bridges are rolling out).`);
    }
    const fromKey = LIFI_CHAIN[req.fromChain]!;
    const toKey = LIFI_CHAIN[req.toChain]!;
    const [fromToken, toToken] = await Promise.all([
      this.resolveToken(fromKey, req.fromToken),
      this.resolveToken(toKey, req.toToken),
    ]);
    const fromAddress = req.fromAddress ?? req.toAddress;
    const url =
      `${LIFI}/quote?fromChain=${fromKey}&toChain=${toKey}&fromToken=${fromToken}&toToken=${toToken}` +
      `&fromAmount=${req.amount}&fromAddress=${fromAddress}&toAddress=${req.toAddress}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`Bridge quote failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return parseLifiBridgeQuote(await res.json(), req);
  }
}

export function parseLifiBridgeQuote(json: unknown, req: BridgeQuoteRequest): BridgeQuote {
  const j = (json ?? {}) as any;
  const est = j.estimate ?? {};
  if (!est.toAmount) throw new Error('Bridge quote missing an output amount.');
  const feeUsd = sumUsd(est.feeCosts) + sumUsd(est.gasCosts);
  return {
    provider: 'lifi',
    fromChain: req.fromChain,
    toChain: req.toChain,
    fromToken: req.fromToken,
    toToken: req.toToken,
    amountIn: req.amount,
    estAmountOut: String(est.toAmount),
    feeUsd: feeUsd > 0 ? feeUsd.toFixed(2) : undefined,
    etaSeconds: est.executionDuration != null ? Number(est.executionDuration) : undefined,
    raw: json,
  };
}

function sumUsd(costs: unknown): number {
  if (!Array.isArray(costs)) return 0;
  return costs.reduce((acc, c) => acc + Number((c as { amountUSD?: string })?.amountUSD ?? 0), 0);
}
