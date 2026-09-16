import { describe, it, expect } from 'vitest';
import {
  buyExactSuiIn,
  sellExactTokenIn,
  priceX18,
  initialState,
  raisedSui,
  migrationProgressX18,
  type CurveState,
} from '../src/launch/curve.js';

const cfg = {
  virtualSui: 30n * 10n ** 9n, // 30 SUI
  curveSupply: 800_000_000n * 10n ** 9n, // 800M tokens (9dp)
  migrateThresholdSui: 85n * 10n ** 9n,
  feeBps: 0,
};

describe('bonding curve', () => {
  it('preserves the constant-product invariant (k never decreases on buy)', () => {
    const s0 = initialState(cfg);
    const k0 = s0.rs * s0.rt;
    const { state: s1 } = buyExactSuiIn(s0, 5n * 10n ** 9n);
    expect(s1.rs * s1.rt).toBeGreaterThanOrEqual(k0);
  });

  it('price increases as tokens are bought', () => {
    const s0 = initialState(cfg);
    const p0 = priceX18(s0, 9);
    const { state: s1 } = buyExactSuiIn(s0, 10n * 10n ** 9n);
    const p1 = priceX18(s1, 9);
    expect(p1).toBeGreaterThan(p0);
  });

  it('buy then sell returns approximately the input (minus rounding)', () => {
    const s0 = initialState(cfg);
    const buyAmt = 5n * 10n ** 9n;
    const { amountOut: tokens, state: s1 } = buyExactSuiIn(s0, buyAmt);
    const { amountOut: suiBack } = sellExactTokenIn(s1, tokens);
    // Should be very close to buyAmt; never more (no value creation).
    expect(suiBack).toBeLessThanOrEqual(buyAmt);
    const diff = buyAmt - suiBack;
    expect(diff).toBeLessThan(buyAmt / 100_000n + 2n); // within ~0.001%
  });

  it('applies a curve fee, reducing output', () => {
    const s0 = initialState(cfg);
    const noFee = buyExactSuiIn(s0, 5n * 10n ** 9n, 0).amountOut;
    const withFee = buyExactSuiIn(s0, 5n * 10n ** 9n, 100).amountOut;
    expect(withFee).toBeLessThan(noFee);
  });

  it('tracks SUI raised and migration progress', () => {
    let s: CurveState = initialState(cfg);
    ({ state: s } = buyExactSuiIn(s, 40n * 10n ** 9n));
    const raised = raisedSui(s, cfg.virtualSui);
    expect(raised).toBeGreaterThan(0n);
    const progress = migrationProgressX18(raised, cfg.migrateThresholdSui);
    expect(progress).toBeGreaterThan(0n);
    expect(progress).toBeLessThanOrEqual(10n ** 18n);
  });

  it('rejects zero/negative trades and bad reserves', () => {
    const s0 = initialState(cfg);
    expect(() => buyExactSuiIn(s0, 0n)).toThrow();
    expect(() => sellExactTokenIn(s0, -1n)).toThrow();
    expect(() => priceX18({ rs: 0n, rt: 1n }, 9)).toThrow();
  });
});
