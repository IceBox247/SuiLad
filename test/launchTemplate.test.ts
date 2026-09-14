import { describe, it, expect } from 'vitest';
import {
  deriveIdentifiers,
  escapeMoveByteString,
  generateCoinModule,
  generateMoveToml,
  validateLaunchParams,
} from '../src/launch/template.js';
import type { LaunchParams } from '../src/launch/types.js';

const params = (over: Partial<LaunchParams> = {}): LaunchParams => ({
  name: 'My Coin',
  symbol: 'MYC',
  decimals: 9,
  description: 'A test coin',
  initialSupply: 1_000_000n,
  keepMintAuthority: true,
  ...over,
});

describe('deriveIdentifiers', () => {
  it('derives module + witness from a symbol', () => {
    expect(deriveIdentifiers('MYC')).toEqual({ moduleName: 'myc', witness: 'MYC' });
    expect(deriveIdentifiers('My-Coin!')).toEqual({ moduleName: 'my_coin_', witness: 'MY_COIN_' });
  });
  it('handles symbols starting with a digit', () => {
    expect(deriveIdentifiers('1INCH')).toEqual({ moduleName: 'inch', witness: 'INCH' });
  });
});

describe('escapeMoveByteString', () => {
  it('escapes quotes and backslashes', () => {
    expect(escapeMoveByteString('a"b\\c')).toBe('a\\"b\\\\c');
  });
  it('rejects non-ASCII', () => {
    expect(() => escapeMoveByteString('café')).toThrow(/ASCII/);
  });
});

describe('validateLaunchParams', () => {
  it('accepts valid params', () => {
    expect(() => validateLaunchParams(params())).not.toThrow();
  });
  it('rejects bad decimals', () => {
    expect(() => validateLaunchParams(params({ decimals: 20 }))).toThrow(/Decimals/);
  });
  it('rejects long symbols and names', () => {
    expect(() => validateLaunchParams(params({ symbol: 'TOOLONGSYMBOL' }))).toThrow(/symbol/);
    expect(() => validateLaunchParams(params({ name: 'x'.repeat(33) }))).toThrow(/name/);
  });
  it('rejects negative supply', () => {
    expect(() => validateLaunchParams(params({ initialSupply: -1n }))).toThrow(/supply/);
  });
  it('rejects bad icon urls', () => {
    expect(() => validateLaunchParams(params({ iconUrl: 'ftp://x' }))).toThrow(/Icon/);
  });
});

describe('generateCoinModule', () => {
  it('produces a module with the right identifiers and metadata', () => {
    const src = generateCoinModule(params());
    expect(src).toContain('module myc::myc;');
    expect(src).toContain('public struct MYC has drop {}');
    expect(src).toContain('b"MYC"');
    expect(src).toContain('b"My Coin"');
    expect(src).toContain('9,');
  });

  it('mints initial supply in base units and keeps mint authority', () => {
    const src = generateCoinModule(params({ decimals: 6, initialSupply: 5n }));
    // 5 * 10^6 = 5000000 base units
    expect(src).toContain('coin::mint_and_transfer(&mut treasury, 5000000u64');
    expect(src).toContain('transfer::public_transfer(treasury, ctx.sender());');
  });

  it('freezes the treasury for fixed supply (no mint authority)', () => {
    const src = generateCoinModule(params({ initialSupply: 0n, keepMintAuthority: false }));
    expect(src).not.toContain('mint_and_transfer');
    expect(src).toContain('transfer::public_freeze_object(treasury)');
  });

  it('includes an icon url when provided', () => {
    const src = generateCoinModule(params({ iconUrl: 'https://x.io/i.png' }));
    expect(src).toContain('new_unsafe_from_bytes(b"https://x.io/i.png")');
  });

  it('rejects injection attempts via non-ASCII / breakout', () => {
    expect(() => generateCoinModule(params({ name: 'x"; abort; b"' }))).not.toThrow();
    const src = generateCoinModule(params({ name: 'x"; abort; b"' }));
    // The quote is escaped, so it cannot break out of the byte string.
    expect(src).toContain('b"x\\"; abort; b\\""');
  });
});

describe('generateMoveToml', () => {
  it('produces a valid-looking Move.toml', () => {
    const toml = generateMoveToml('myc');
    expect(toml).toContain('name = "myc"');
    expect(toml).toContain('edition = "2024.beta"');
    expect(toml).toContain('myc = "0x0"');
  });
});
