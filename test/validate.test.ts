import { describe, it, expect } from 'vitest';
import {
  isValidSuiAddress,
  normalizeSuiAddress,
  isValidCoinType,
  isMoveIdentifier,
  isPositiveAmount,
} from '../src/util/validate.js';

describe('isValidSuiAddress', () => {
  it('accepts valid hex addresses', () => {
    expect(isValidSuiAddress('0x2')).toBe(true);
    expect(isValidSuiAddress('0x' + 'a'.repeat(64))).toBe(true);
  });
  it('rejects malformed addresses', () => {
    expect(isValidSuiAddress('2')).toBe(false);
    expect(isValidSuiAddress('0xZZ')).toBe(false);
    expect(isValidSuiAddress('0x' + 'a'.repeat(65))).toBe(false);
  });
});

describe('normalizeSuiAddress', () => {
  it('pads to 32 bytes', () => {
    expect(normalizeSuiAddress('0x2')).toBe('0x' + '0'.repeat(63) + '2');
  });
  it('throws on invalid', () => {
    expect(() => normalizeSuiAddress('nope')).toThrow();
  });
});

describe('isValidCoinType', () => {
  it('accepts SUI and fully-qualified coin types', () => {
    expect(isValidCoinType('0x2::sui::SUI')).toBe(true);
    expect(isValidCoinType('0xabc123::coin::COIN')).toBe(true);
  });
  it('rejects bad types', () => {
    expect(isValidCoinType('0x2::sui')).toBe(false);
    expect(isValidCoinType('sui::SUI')).toBe(false);
    expect(isValidCoinType('0x2::0bad::X')).toBe(false);
  });
});

describe('isMoveIdentifier', () => {
  it('validates identifiers', () => {
    expect(isMoveIdentifier('my_coin')).toBe(true);
    expect(isMoveIdentifier('_x1')).toBe(true);
    expect(isMoveIdentifier('1bad')).toBe(false);
    expect(isMoveIdentifier('bad-name')).toBe(false);
  });
});

describe('isPositiveAmount', () => {
  it('validates positive numbers', () => {
    expect(isPositiveAmount('1.5')).toBe(true);
    expect(isPositiveAmount('0')).toBe(false);
    expect(isPositiveAmount('-1')).toBe(false);
    expect(isPositiveAmount('abc')).toBe(false);
  });
});
