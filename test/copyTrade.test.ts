import { describe, it, expect } from 'vitest';
import { mirrorAmountMist } from '../src/services/copyTrade.js';

describe('copy-trade mirror math', () => {
  it('mirrors a fraction of the leader spend, capped by the budget', () => {
    // Leader spent 10 SUI, ratio 50%, cap 3 SUI → min(5, 3) = 3 SUI.
    expect(mirrorAmountMist(10n * 10n ** 9n, 5000, 3n * 10n ** 9n)).toBe(3n * 10n ** 9n);
    // Leader spent 2 SUI, ratio 50%, cap 3 SUI → 1 SUI.
    expect(mirrorAmountMist(2n * 10n ** 9n, 5000, 3n * 10n ** 9n)).toBe(1n * 10n ** 9n);
  });

  it('returns 0 for non-positive ratio', () => {
    expect(mirrorAmountMist(10n ** 9n, 0, 10n ** 9n)).toBe(0n);
  });
});
