import { describe, it, expect } from 'vitest';
import {
  toBaseUnits,
  fromBaseUnits,
  formatAmount,
  shortenAddress,
  bpsToPercent,
} from '../src/util/format.js';

describe('toBaseUnits', () => {
  it('converts whole and fractional amounts', () => {
    expect(toBaseUnits('1', 9)).toBe(1_000_000_000n);
    expect(toBaseUnits('1.5', 9)).toBe(1_500_000_000n);
    expect(toBaseUnits('0.000000001', 9)).toBe(1n);
    expect(toBaseUnits('0', 9)).toBe(0n);
    expect(toBaseUnits('123.456', 6)).toBe(123_456_000n);
  });

  it('handles zero decimals', () => {
    expect(toBaseUnits('42', 0)).toBe(42n);
  });

  it('accepts numbers including exponential notation', () => {
    expect(toBaseUnits(1.5, 9)).toBe(1_500_000_000n);
    expect(toBaseUnits(1e-9, 9)).toBe(1n);
  });

  it('rejects too many decimal places', () => {
    expect(() => toBaseUnits('1.0000000001', 9)).toThrow(/decimal places/);
  });

  it('rejects invalid input', () => {
    expect(() => toBaseUnits('abc', 9)).toThrow();
    expect(() => toBaseUnits('', 9)).toThrow();
    expect(() => toBaseUnits('.', 9)).toThrow();
  });
});

describe('fromBaseUnits', () => {
  it('is the inverse of toBaseUnits', () => {
    expect(fromBaseUnits(1_500_000_000n, 9)).toBe('1.5');
    expect(fromBaseUnits(1n, 9)).toBe('0.000000001');
    expect(fromBaseUnits(1_000_000_000n, 9)).toBe('1');
    expect(fromBaseUnits(0n, 9)).toBe('0');
  });

  it('round-trips canonical values', () => {
    for (const v of ['0.1', '999999.123456', '1000000', '0.000001']) {
      expect(fromBaseUnits(toBaseUnits(v, 6), 6)).toBe(v);
    }
  });
});

describe('formatAmount', () => {
  it('adds thousands separators and caps fraction digits', () => {
    expect(formatAmount(1_234_567_000_000_000n, 9)).toBe('1,234,567');
    expect(formatAmount(1_500_000_000n, 9)).toBe('1.5');
    expect(formatAmount(1_234_567n, 9, 6)).toBe('0.001234');
  });
});

describe('shortenAddress', () => {
  it('shortens long addresses', () => {
    const a = '0x' + 'a'.repeat(64);
    expect(shortenAddress(a)).toBe('0xaaaaaa…aaaa');
  });
  it('leaves short strings mostly intact', () => {
    expect(shortenAddress('0x1234')).toBe('0x1234');
  });
});

describe('bpsToPercent', () => {
  it('formats basis points', () => {
    expect(bpsToPercent(100)).toBe('1%');
    expect(bpsToPercent(50)).toBe('0.50%');
    expect(bpsToPercent(1000)).toBe('10%');
  });
});
