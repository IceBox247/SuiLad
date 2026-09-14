import { describe, it, expect } from 'vitest';
import { splitFee, referralShares, platformNet } from '../src/trade/fees.js';

describe('fees', () => {
  it('splits a 1.1% fee from input', () => {
    expect(splitFee(1_000_000_000n, 110)).toEqual({ fee: 11_000_000n, net: 989_000_000n });
    expect(splitFee(1_000_000_000n, 0)).toEqual({ fee: 0n, net: 1_000_000_000n });
  });

  it('computes 5-level referral shares (20/5/2/2/1%)', () => {
    const fee = 100_000_000n; // 0.1 SUI fee
    const shares = referralShares(fee, [2000, 500, 200, 200, 100]);
    expect(shares).toEqual([20_000_000n, 5_000_000n, 2_000_000n, 2_000_000n, 1_000_000n]);
    // total distributed = 30% of the fee
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(30_000_000n);
  });

  it('platform keeps the remainder', () => {
    const fee = 100_000_000n;
    const dist = referralShares(fee, [2000, 500, 200, 200, 100]);
    expect(platformNet(fee, dist)).toBe(70_000_000n);
  });

  it('rejects invalid bps', () => {
    expect(() => splitFee(1n, 20_000)).toThrow();
  });
});
