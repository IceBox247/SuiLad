import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityService } from '../src/services/security.js';
import { makeRepo } from './helpers.js';
import type { Repo } from '../src/storage/repo.js';

let repo: Repo;

beforeEach(() => {
  repo = makeRepo();
});

describe('SecurityService', () => {
  it('rate-limits per user per action', async () => {
    const sec = new SecurityService(repo, { rateLimitPerMin: 3, maxBuySui: 0, allowedIds: [], adminIds: [] });
    await sec.enforceRate('1', 'buy');
    await sec.enforceRate('1', 'buy');
    await sec.enforceRate('1', 'buy');
    await expect(sec.enforceRate('1', 'buy')).rejects.toThrow(/too fast/);
    // Different user unaffected.
    await expect(sec.enforceRate('2', 'buy')).resolves.toBeUndefined();
  });

  it('enforces a buy cap', () => {
    const sec = new SecurityService(repo, { rateLimitPerMin: 30, maxBuySui: 5, allowedIds: [], adminIds: [] });
    expect(() => sec.assertBuyWithinCap(4)).not.toThrow();
    expect(() => sec.assertBuyWithinCap(6)).toThrow(/cap/);
  });

  it('allowlist and admin checks', () => {
    const sec = new SecurityService(repo, { rateLimitPerMin: 30, maxBuySui: 0, allowedIds: ['1'], adminIds: ['9'] });
    expect(sec.isAllowed('1')).toBe(true);
    expect(sec.isAllowed('2')).toBe(false);
    expect(sec.isAdmin('9')).toBe(true);
    const open = new SecurityService(repo, { rateLimitPerMin: 30, maxBuySui: 0, allowedIds: [], adminIds: [] });
    expect(open.isAllowed('anyone')).toBe(true);
  });

  it('bans and unbans', async () => {
    await repo.createUser('1', { address: '0x1', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
    const sec = new SecurityService(repo, { rateLimitPerMin: 30, maxBuySui: 0, allowedIds: [], adminIds: [] });
    expect(await sec.isBanned('1')).toBe(false);
    await sec.ban('1', new Date(Date.now() + 60_000));
    expect(await sec.isBanned('1')).toBe(true);
    await sec.unban('1');
    expect(await sec.isBanned('1')).toBe(false);
  });

  it('firstSeen enforces idempotency', async () => {
    const sec = new SecurityService(repo, { rateLimitPerMin: 30, maxBuySui: 0, allowedIds: [], adminIds: [] });
    expect(await sec.firstSeen('k')).toBe(true);
    expect(await sec.firstSeen('k')).toBe(false);
  });
});
