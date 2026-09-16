import { describe, it, expect, beforeEach } from 'vitest';
import { ReferralService } from '../src/services/referralService.js';
import { makeRepo } from './helpers.js';
import type { Repo } from '../src/storage/repo.js';

let repo: Repo;
let ref: ReferralService;

/** Build a chain a <- b <- c <- d <- e <- f (a is top, f is newest). */
async function buildChain(): Promise<void> {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (let i = 0; i < ids.length; i++) {
    await repo.createUser(ids[i]!, {
      address: `0x${ids[i]}`,
      encryptedSecretKey: 'e',
      keyScheme: 'ED25519',
      referrerId: i === 0 ? undefined : ids[i - 1],
    });
  }
}

beforeEach(async () => {
  repo = makeRepo();
  ref = new ReferralService(repo, [2000, 500, 200, 200, 100]);
  await buildChain();
});

describe('ReferralService', () => {
  it('credits up to 5 levels from the fee payer', async () => {
    // f pays a 1 SUI fee (1e9 MIST). Uplines: e,d,c,b,a.
    await ref.creditFees('f', 1_000_000_000n);
    const amt = async (id: string) => BigInt((await repo.getUser(id))!.referral.unclaimedMist);
    expect(await amt('e')).toBe(200_000_000n); // L1 20%
    expect(await amt('d')).toBe(50_000_000n); // L2 5%
    expect(await amt('c')).toBe(20_000_000n); // L3 2%
    expect(await amt('b')).toBe(20_000_000n); // L4 2%
    expect(await amt('a')).toBe(10_000_000n); // L5 1%
  });

  it('stops at the top of the chain (fewer than 5 levels)', async () => {
    // c pays: uplines b (L1), a (L2). No deeper.
    await ref.creditFees('c', 1_000_000_000n);
    const b = BigInt((await repo.getUser('b'))!.referral.unclaimedMist);
    const a = BigInt((await repo.getUser('a'))!.referral.unclaimedMist);
    expect(b).toBe(200_000_000n);
    expect(a).toBe(50_000_000n);
  });

  it('registers downline counts up the chain', async () => {
    await ref.registerDownline('f');
    expect((await repo.getUser('e'))!.referral.levelCounts[0]).toBe(1);
    expect((await repo.getUser('a'))!.referral.levelCounts[4]).toBe(1);
  });

  it('claim zeroes unclaimed and returns the amount', async () => {
    await ref.creditFees('f', 1_000_000_000n);
    const claimed = await ref.claim('e');
    expect(claimed).toBe(200_000_000n);
    expect(BigInt((await repo.getUser('e'))!.referral.unclaimedMist)).toBe(0n);
  });
});
