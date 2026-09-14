export type Chain = 'sui' | 'ethereum' | 'solana' | 'base' | 'arbitrum' | 'polygon' | 'bsc';

export const SUPPORTED_CHAINS: Chain[] = ['sui', 'ethereum', 'solana', 'base', 'arbitrum', 'polygon', 'bsc'];

export interface BridgeQuoteRequest {
  fromChain: Chain;
  toChain: Chain;
  /** Token symbol or address on the source chain (e.g. "USDC" or a mint/coin type). */
  fromToken: string;
  toToken: string;
  /** Human amount to bridge. */
  amount: string;
  /** Recipient address on the destination chain. */
  toAddress: string;
}

export interface BridgeQuote {
  provider: string;
  fromChain: Chain;
  toChain: Chain;
  fromToken: string;
  toToken: string;
  amountIn: string;
  /** Estimated amount received on the destination chain (human). */
  estAmountOut: string;
  /** Estimated total fee (bridge + gas) in USD, when known. */
  feeUsd?: string;
  /** ETA in seconds, when known. */
  etaSeconds?: number;
  /** Provider-specific payload for building the transaction. */
  raw?: unknown;
}

export interface BridgeProvider {
  readonly name: string;
  supports(from: Chain, to: Chain): boolean;
  quote(req: BridgeQuoteRequest): Promise<BridgeQuote>;
}
