/** Pure math for slippage protection and quote presentation. */

export const BPS_DENOMINATOR = 10_000n;

/**
 * Apply slippage tolerance to an expected output to get the minimum acceptable
 * output. minOut = floor(amountOut * (10000 - slippageBps) / 10000).
 */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10_000 || !Number.isInteger(slippageBps)) {
    throw new Error(`Invalid slippageBps: ${slippageBps}`);
  }
  if (amountOut < 0n) throw new Error('amountOut must be non-negative');
  const keepBps = BPS_DENOMINATOR - BigInt(slippageBps);
  return (amountOut * keepBps) / BPS_DENOMINATOR;
}

/**
 * Deduct a platform fee (in bps) from an input amount. Returns the amount that
 * will actually be routed plus the fee taken.
 */
export function deductFee(amountIn: bigint, feeBps: number): { net: bigint; fee: bigint } {
  if (feeBps < 0 || feeBps > 10_000 || !Number.isInteger(feeBps)) {
    throw new Error(`Invalid feeBps: ${feeBps}`);
  }
  if (feeBps === 0) return { net: amountIn, fee: 0n };
  const fee = (amountIn * BigInt(feeBps)) / BPS_DENOMINATOR;
  return { net: amountIn - fee, fee };
}

/**
 * Effective execution price = amountOut / amountIn scaled to account for
 * decimals, returned as a floating-point number for display only.
 */
export function executionPrice(
  amountIn: bigint,
  amountOut: bigint,
  decimalsIn: number,
  decimalsOut: number,
): number {
  if (amountIn === 0n) return 0;
  const inFloat = Number(amountIn) / 10 ** decimalsIn;
  const outFloat = Number(amountOut) / 10 ** decimalsOut;
  if (inFloat === 0) return 0;
  return outFloat / inFloat;
}
