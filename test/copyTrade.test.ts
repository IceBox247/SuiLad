import { describe, it, expect } from 'vitest';
import { mirrorAmountMist, CopyTradeService } from '../src/services/copyTrade.js';
import { makeRepo } from './helpers.js';

describe('copy-trade follow validation', () => {
  it('rejects a non-numeric or non-positive maxSui', async () => {
    const repo = makeRepo();
    await repo.createUser('u1', { address: '0x1', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
    const svc = new CopyTradeService(repo, {} as any, {} as any, {} as any, {} as any, async () => {});
    await expect(svc.follow('u1', '0x2', 5000, 'abc')).rejects.toThrow(/positive number/);
    await expect(svc.follow('u1', '0x2', 5000, '0')).rejects.toThrow(/positive number/);
    await expect(svc.follow('u1', '0x2', 5000, '')).rejects.toThrow(/positive number/);
  });
});

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
