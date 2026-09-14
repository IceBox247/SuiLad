import { describe, it, expect } from 'vitest';
import { applySlippage, deductFee, executionPrice } from '../src/trade/quote.js';

describe('applySlippage', () => {
  it('reduces amount by slippage bps', () => {
    expect(applySlippage(1_000_000n, 100)).toBe(990_000n); // 1%
    expect(applySlippage(1_000_000n, 50)).toBe(995_000n); // 0.5%
    expect(applySlippage(1_000_000n, 0)).toBe(1_000_000n);
  });
  it('floors the result', () => {
    expect(applySlippage(999n, 100)).toBe(989n); // 999*9900/10000 = 989.01 -> 989
  });
  it('rejects invalid slippage', () => {
    expect(() => applySlippage(1n, -1)).toThrow();
    expect(() => applySlippage(1n, 10001)).toThrow();
    expect(() => applySlippage(-1n, 100)).toThrow();
  });
});

describe('deductFee', () => {
  it('takes the fee and returns the net', () => {
    expect(deductFee(1_000_000n, 100)).toEqual({ net: 990_000n, fee: 10_000n });
    expect(deductFee(1_000_000n, 0)).toEqual({ net: 1_000_000n, fee: 0n });
  });
  it('rejects invalid fee', () => {
    expect(() => deductFee(1n, -1)).toThrow();
  });
});

describe('executionPrice', () => {
  it('computes output per input adjusting for decimals', () => {
    // 1 SUI (9dp) -> 0.72 USDC (6dp)
    const price = executionPrice(1_000_000_000n, 720_000n, 9, 6);
    expect(price).toBeCloseTo(0.72, 5);
  });
  it('returns 0 for zero input', () => {
    expect(executionPrice(0n, 100n, 9, 6)).toBe(0);
  });
});
