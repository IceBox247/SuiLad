import { describe, it, expect, beforeEach } from 'vitest';
import { makeRepo } from './helpers.js';
import type { Repo } from '../src/storage/repo.js';

let repo: Repo;
beforeEach(() => {
  repo = makeRepo();
});

describe('Repo', () => {
  it('creates users idempotently with a unique referral code', async () => {
    const a = await repo.createUser('1', { address: '0x1', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
    const again = await repo.createUser('1', { address: '0xother', encryptedSecretKey: 'e2', keyScheme: 'ED25519' });
    expect(again.address).toBe('0x1'); // idempotent — no overwrite
    expect(a.referral.code).toHaveLength(8);
    expect(await repo.resolveRefCode(a.referral.code)).toBe('1');
  });

  it('mutates under a lock and persists', async () => {
    await repo.createUser('1', { address: '0x1', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
    await repo.withUser('1', (u) => { u.settings.slippageBps = 250; });
    expect((await repo.getUser('1'))!.settings.slippageBps).toBe(250);
  });

  it('serializes concurrent mutations (no lost updates)', async () => {
    await repo.createUser('1', { address: '0x1', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
    // 20 concurrent increments must all apply.
    await Promise.all(
      Array.from({ length: 20 }, () =>
        repo.withUser('1', (u) => {
          u.referral.levelCounts[0] += 1;
        }),
      ),
    );
    expect((await repo.getUser('1'))!.referral.levelCounts[0]).toBe(20);
  });

  it('tracks active-automation indexes', async () => {
    await repo.setActive('orders', '1', true);
    await repo.setActive('orders', '2', true);
    await repo.setActive('orders', '1', false);
    expect((await repo.listActive('orders')).sort()).toEqual(['2']);
  });

  it('tracks leader followers', async () => {
    await repo.addFollower('0xLEADER', 'f1');
    await repo.addFollower('0xleader', 'f2'); // same leader, case-insensitive
    expect((await repo.getFollowers('0xLEADER')).sort()).toEqual(['f1', 'f2']);
  });
});
