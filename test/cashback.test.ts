import { describe, it, expect, beforeEach } from 'vitest';
import { CashbackService } from '../src/services/cashbackService.js';
import { makeRepo } from './helpers.js';
import type { Repo } from '../src/storage/repo.js';

let repo: Repo;
beforeEach(async () => {
  repo = makeRepo();
  await repo.createUser('u1', { address: '0x1', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
});

describe('CashbackService', () => {
  it('rebates 20% of the fee and accumulates the ledger', async () => {
    const cb = new CashbackService(repo, 2000); // 20%
    const credited = await cb.credit('u1', 1_000_000n); // fee = 0.001 SUI
    expect(credited).toBe(200_000n);
    const s = await cb.summary('u1');
    expect(s.unclaimedMist).toBe(200_000n);
    expect(s.totalMist).toBe(200_000n);
    expect(s.rateBps).toBe(2000);
    // Second trade accrues on top.
    await cb.credit('u1', 500_000n);
    const s2 = await cb.summary('u1');
    expect(s2.unclaimedMist).toBe(300_000n);
    expect(s2.totalMist).toBe(300_000n);
  });

  it('credits nothing for a zero fee or zero rate', async () => {
    const cb = new CashbackService(repo, 2000);
    expect(await cb.credit('u1', 0n)).toBe(0n);
    const off = new CashbackService(repo, 0);
    expect(await off.credit('u1', 1_000_000n)).toBe(0n);
  });

  it('defaults summary to zero for a fresh user', async () => {
    const cb = new CashbackService(repo, 2000);
    const s = await cb.summary('u1');
    expect(s.unclaimedMist).toBe(0n);
    expect(s.totalMist).toBe(0n);
  });
});
