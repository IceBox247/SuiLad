/**
 * Chain-agnostic contract for a trading chain. Each supported network (Sui,
 * Solana, the EVM family, Tron) provides a {@link ChainAdapter} so the bot's
 * trade/wallet/UI layers can stay chain-neutral. Amounts are always base units
 * (the chain's smallest unit) expressed as bigint/decimal strings; humans see
 * decimals applied at the edges only.
 */

export type ChainId =
  | 'sui'
  | 'solana'
  | 'ethereum'
  | 'base'
  | 'arbitrum'
  | 'polygon'
  | 'bsc'
  | 'tron';

export interface ChainMeta {
  id: ChainId;
  /** Display name, e.g. "Solana". */
  name: string;
  /** Short emoji/icon for menus. */
  icon: string;
  /** Native gas token symbol, e.g. "SOL", "ETH", "SUI". */
  nativeSymbol: string;
  /** Native token decimals (SOL 9, ETH 18, SUI 9, TRX 6). */
  nativeDecimals: number;
  /** Canonical address/mint/coin-type of the native (wrapped) token used for quotes. */
  nativeAddress: string;
  /** DexScreener chainId used for market data + chart lookups. */
  dexScreenerChain: string;
  /** Family — drives key scheme + address validation. */
  family: 'sui' | 'solana' | 'evm' | 'tron';
}

export interface GeneratedWallet {
  address: string;
  /** Chain-native encoded secret (bech32 for Sui, base58 for Solana, 0x-hex for EVM). Store encrypted only. */
  secretKey: string;
  scheme: string;
}

/** A priced route for swapping `inAmount` of `inputToken` into `outputToken`. */
export interface SwapQuote {
  inputToken: string;
  outputToken: string;
  /** Input amount in base units. */
  inAmount: string;
  /** Expected output in base units. */
  outAmount: string;
  /** Minimum acceptable output after slippage, base units. */
  minOut: string;
  /** Price impact as a fraction (0.01 = 1%), when known. */
  priceImpactPct?: number;
  /** Human-readable route label (e.g. "Jupiter", "Cetus"). */
  route: string;
  /** Opaque provider payload used to build/execute the swap. */
  raw?: unknown;
}

export interface SwapRequest {
  /** Input token address/mint/coin-type. */
  inputToken: string;
  outputToken: string;
  /** Input amount in base units. */
  amount: string;
  /** Slippage tolerance in basis points (100 = 1%). */
  slippageBps: number;
  /** Owner address (payer), so the adapter can build the tx. */
  owner: string;
}

export interface SwapResult {
  /** Transaction hash / digest / signature. */
  digest: string;
  /** Output actually credited, base units, when the adapter can determine it. */
  outAmount?: string;
}

export interface TokenMeta {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * The per-chain capability surface. Adapters must be safe to construct without
 * network access (lazy RPC), and all network calls must time out.
 */
export interface ChainAdapter {
  readonly meta: ChainMeta;

  // --- Wallets -------------------------------------------------------------
  createWallet(): Promise<GeneratedWallet>;
  importWallet(secret: string): Promise<GeneratedWallet>;
  /** True if `secret` decodes to a valid key for this chain. */
  isValidSecret(secret: string): boolean;
  /** True if `address` is a syntactically valid address on this chain. */
  isValidAddress(address: string): boolean;

  // --- Reads ---------------------------------------------------------------
  /** Native (gas token) balance in base units. */
  getNativeBalance(address: string): Promise<bigint>;
  /** Token balance in base units. */
  getTokenBalance(address: string, token: string): Promise<bigint>;
  /** On-chain token metadata (symbol/name/decimals). */
  getTokenMeta(token: string): Promise<TokenMeta>;

  // --- Trading -------------------------------------------------------------
  quote(req: SwapRequest): Promise<SwapQuote>;
  /** Execute a swap. `secretKey` is the chain-native encoded secret (decrypted upstream). */
  swap(secretKey: string, quote: SwapQuote, req: SwapRequest): Promise<SwapResult>;

  // --- Explorer ------------------------------------------------------------
  explorerTx(hash: string): string;
  explorerAddress(address: string): string;
}
