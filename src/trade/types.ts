import type { Transaction } from '@mysten/sui/transactions';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

/** A normalized swap quote independent of the routing provider. */
export interface Quote {
  inputType: string;
  outputType: string;
  /** Amount in, base units. */
  amountIn: bigint;
  /** Expected amount out, base units (before slippage protection). */
  amountOut: bigint;
  /** Minimum acceptable amount out after applying slippage, base units. */
  minAmountOut: bigint;
  /** Slippage tolerance used, in basis points. */
  slippageBps: number;
  /** Optional price impact as a ratio string (e.g. "-0.0012" = -0.12%). */
  priceImpact?: string;
  /** Human-readable route description, e.g. "CETUS → AFTERMATH". */
  routeLabel?: string;
  /** Opaque provider payload needed to build the swap transaction. */
  raw?: unknown;
}

export interface QuoteRequest {
  inputType: string;
  outputType: string;
  amountIn: bigint;
  slippageBps: number;
}

export interface BuildSwapParams {
  quote: Quote;
  signer: Ed25519Keypair;
  sender: string;
}

/**
 * A routing provider knows how to price a swap and build the on-chain
 * transaction that executes it. Implementations: MockSwapProvider (offline,
 * deterministic) and CetusAggregatorProvider (live routing).
 */
export interface SwapProvider {
  readonly name: string;
  quote(req: QuoteRequest): Promise<Quote>;
  buildTransaction(params: BuildSwapParams): Promise<Transaction>;
}
