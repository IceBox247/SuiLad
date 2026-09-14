/**
 * Constant-product bonding curve with virtual reserves (pump.fun-style).
 *
 * The curve holds virtual SUI reserves `rs` and virtual token reserves `rt`
 * with invariant k = rs * rt. Buying with SUI moves along the curve; selling
 * reverses it. Price (SUI per token) = rs / rt. All amounts are base units
 * (MIST for SUI). Pure integer math — no floating point.
 */

const X18 = 10n ** 18n;

export interface CurveState {
  /** Virtual SUI reserves (MIST). */
  rs: bigint;
  /** Virtual token reserves (base units). */
  rt: bigint;
}

/** Result of a curve trade: amount out plus the new reserves. */
export interface CurveTrade {
  amountOut: bigint;
  state: CurveState;
}

/** Buy tokens with an exact SUI input. `feeBps` is an optional curve fee. */
export function buyExactSuiIn(state: CurveState, suiIn: bigint, feeBps = 0): CurveTrade {
  if (suiIn <= 0n) throw new Error('suiIn must be positive');
  assertReserves(state);
  const netIn = applyFee(suiIn, feeBps);
  const k = state.rs * state.rt;
  const newRs = state.rs + netIn;
  // Round the new token reserve UP so tokens paid out are floored — the pool
  // keeps rounding dust and the invariant k never decreases (no drain vector).
  const newRt = ceilDiv(k, newRs);
  const tokensOut = state.rt - newRt;
  if (tokensOut <= 0n) throw new Error('Amount too small');
  return { amountOut: tokensOut, state: { rs: newRs, rt: newRt } };
}

/** Sell an exact token amount for SUI. */
export function sellExactTokenIn(state: CurveState, tokenIn: bigint, feeBps = 0): CurveTrade {
  if (tokenIn <= 0n) throw new Error('tokenIn must be positive');
  assertReserves(state);
  const k = state.rs * state.rt;
  const newRt = state.rt + tokenIn;
  // Round the new SUI reserve UP so SUI paid out is floored (pool-protective).
  const newRs = ceilDiv(k, newRt);
  const grossSuiOut = state.rs - newRs;
  const suiOut = applyFee(grossSuiOut, feeBps);
  if (suiOut <= 0n) throw new Error('Amount too small');
  return { amountOut: suiOut, state: { rs: newRs, rt: newRt } };
}

/** Current price in SUI-per-token, 18-dp fixed point. */
export function priceX18(state: CurveState, tokenDecimals: number): bigint {
  assertReserves(state);
  // price = (rs / 1e9 SUI) / (rt / 10^dec tokens)  -> X18
  return (state.rs * 10n ** BigInt(tokenDecimals) * X18) / (state.rt * 10n ** 9n);
}

/** How much real SUI has been raised, given the starting virtual SUI reserve. */
export function raisedSui(state: CurveState, virtualSuiStart: bigint): bigint {
  return state.rs > virtualSuiStart ? state.rs - virtualSuiStart : 0n;
}

/** Migration progress (0..1, X18) toward the SUI raise threshold. */
export function migrationProgressX18(raised: bigint, thresholdSui: bigint): bigint {
  if (thresholdSui <= 0n) return X18;
  const p = (raised * X18) / thresholdSui;
  return p > X18 ? X18 : p;
}

export interface CurveConfig {
  /** Starting virtual SUI reserve (MIST). */
  virtualSui: bigint;
  /** Tokens (base units) placed on the curve for sale. */
  curveSupply: bigint;
  /** SUI (MIST) raise that triggers migration to a DEX. */
  migrateThresholdSui: bigint;
  /** Curve fee in bps (taken on each buy/sell). */
  feeBps: number;
}

/** Initial reserves from a config: rt = curveSupply, rs = virtualSui. */
export function initialState(cfg: CurveConfig): CurveState {
  if (cfg.virtualSui <= 0n || cfg.curveSupply <= 0n) throw new Error('Invalid curve config');
  return { rs: cfg.virtualSui, rt: cfg.curveSupply };
}

/** Ceiling division for positive bigints. */
function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

function applyFee(amount: bigint, feeBps: number): bigint {
  if (feeBps <= 0) return amount;
  if (feeBps > 10_000 || !Number.isInteger(feeBps)) throw new Error(`Invalid feeBps ${feeBps}`);
  return (amount * BigInt(10_000 - feeBps)) / 10_000n;
}

function assertReserves(s: CurveState): void {
  if (s.rs <= 0n || s.rt <= 0n) throw new Error('Curve reserves must be positive');
}
