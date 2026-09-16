import { describe, it, expect, beforeEach } from 'vitest';
import { PayoutService } from '../src/services/payoutService.js';
import { ReferralService } from '../src/services/referralService.js';
import { SuiService } from '../src/sui/service.js';
import { createWallet } from '../src/sui/wallet.js';
import { makeFakeClient, makeRepo } from './helpers.js';
import type { Repo } from '../src/storage/repo.js';

const FEE_SECRET = createWallet().secretKey;
const MIN = 50_000_000n; // 0.05 SUI
let repo: Repo;

beforeEach(async () => {
  repo = makeRepo();
  await repo.createUser('1', { address: '0x' + '1'.repeat(64), encryptedSecretKey: 'e', keyScheme: 'ED25519' });
});

function svc(executeResult: Record<string, unknown> = { digest: 'PAYOUT_TX' }) {
  const { client, calls } = makeFakeClient({ executeResult });
  const sui = new SuiService(client, 'testnet');
  return { payout: new PayoutService(repo, sui, FEE_SECRET, MIN), calls };
}

describe('PayoutService', () => {
  it('pays out and zeroes the balance', async () => {
    const ref = new ReferralService(repo, [2000, 500, 200, 200, 100]);
    await repo.withUser('1', (u) => { u.referral.unclaimedMist = (200_000_000n).toString(); });
    const { payout } = svc();
    const res = await payout.claim('1');
    expect(res?.amountMist).toBe(200_000_000n);
    expect(res?.digest).toBe('PAYOUT_TX');
    expect(BigInt((await repo.getUser('1'))!.referral.unclaimedMist)).toBe(0n);
    expect(ref).toBeDefined();
  });

  it('returns null below the minimum', async () => {
    await repo.withUser('1', (u) => { u.referral.unclaimedMist = (10_000_000n).toString(); }); // 0.01 SUI
    const { payout } = svc();
    expect(await payout.claim('1')).toBeNull();
    // Balance untouched.
    expect(BigInt((await repo.getUser('1'))!.referral.unclaimedMist)).toBe(10_000_000n);
  });

  it('refunds the balance if the on-chain transfer fails', async () => {
    await repo.withUser('1', (u) => { u.referral.unclaimedMist = (200_000_000n).toString(); });
    const { payout } = svc({ status: 'failure', error: 'insufficient gas' });
    await expect(payout.claim('1')).rejects.toThrow(/insufficient gas/);
    // The reserved amount was refunded — nothing lost.
    expect(BigInt((await repo.getUser('1'))!.referral.unclaimedMist)).toBe(200_000_000n);
  });

  it('exposes the fee wallet address', () => {
    const { payout } = svc();
    expect(payout.feeAddress).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
