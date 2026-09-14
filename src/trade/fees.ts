/** Pure fee math. All amounts are base units (bigint). */

export const BPS = 10_000n;

/** Split an input amount into the platform fee and the net amount to route. */
export function splitFee(amountIn: bigint, feeBps: number): { fee: bigint; net: bigint } {
  if (feeBps < 0 || feeBps > 10_000 || !Number.isInteger(feeBps)) {
    throw new Error(`Invalid feeBps: ${feeBps}`);
  }
  if (amountIn < 0n) throw new Error('amountIn must be non-negative');
  const fee = (amountIn * BigInt(feeBps)) / BPS;
  return { fee, net: amountIn - fee };
}

/**
 * Given a collected fee, compute the referral payout to each of the up-to-5
 * upline levels. `levelBps[i]` is the share (in bps of the fee) for level i+1.
 * Returns one entry per level (0 when there is no upline at that level yet —
 * the caller decides which levels actually have an upline).
 */
export function referralShares(feeMist: bigint, levelBps: number[]): bigint[] {
  return levelBps.map((bps) => {
    if (bps < 0 || bps > 10_000 || !Number.isInteger(bps)) throw new Error(`Invalid level bps: ${bps}`);
    return (feeMist * BigInt(bps)) / BPS;
  });
}

/** Platform's net share of a fee after distributing to the given active levels. */
export function platformNet(feeMist: bigint, distributed: bigint[]): bigint {
  const paid = distributed.reduce((a, b) => a + b, 0n);
  return feeMist - paid;
}
