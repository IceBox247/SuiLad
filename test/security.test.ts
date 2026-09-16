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
    const sec = new SecurityService(repo, { rateLimitPerMin: 3, maxBuySui: 0, allowedIds: [], adminIds: [], enforceAllowlist: false });
    await sec.enforceRate('1', 'buy');
    await sec.enforceRate('1', 'buy');
    await sec.enforceRate('1', 'buy');
    await expect(sec.enforceRate('1', 'buy')).rejects.toThrow(/too fast/);
    // Different user unaffected.
    await expect(sec.enforceRate('2', 'buy')).resolves.toBeUndefined();
  });

  it('enforces a buy cap', () => {
    const sec = new SecurityService(repo, { rateLimitPerMin: 30, maxBuySui: 5, allowedIds: [], adminIds: [], enforceAllowlist: false });
    expect(() => sec.assertBuyWithinCap(4)).not.toThrow();
    expect(() => sec.assertBuyWithinCap(6)).toThrow(/cap/);
  });

  it('allowlist and admin checks', () => {
    // Restriction only applies when enforceAllowlist is true.
    const sec = new SecurityService(repo, { rateLimitPerMin: 30, maxBuySui: 0, allowedIds: ['1'], adminIds: ['9'], enforceAllowlist: true });
    expect(sec.isAllowed('1')).toBe(true);
    expect(sec.isAllowed('2')).toBe(false);
    expect(sec.isAdmin('9')).toBe(true);
    const open = new SecurityService(repo, { rateLimitPerMin: 30, maxBuySui: 0, allowedIds: [], adminIds: [], enforceAllowlist: true });
    expect(open.isAllowed('anyone')).toBe(true);
  });

  it('is public by default even when an allowlist value is left over', () => {
    // enforceAllowlist=false → anyone allowed regardless of allowedIds.
    const sec = new SecurityService(repo, { rateLimitPerMin: 30, maxBuySui: 0, allowedIds: ['1'], adminIds: [], enforceAllowlist: false });
    expect(sec.isAllowed('1')).toBe(true);
    expect(sec.isAllowed('somebody-else')).toBe(true);
  });

  it('bans and unbans', async () => {
    await repo.createUser('1', { address: '0x1', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
    const sec = new SecurityService(repo, { rateLimitPerMin: 30, maxBuySui: 0, allowedIds: [], adminIds: [], enforceAllowlist: false });
    expect(await sec.isBanned('1')).toBe(false);
    await sec.ban('1', new Date(Date.now() + 60_000));
    expect(await sec.isBanned('1')).toBe(true);
    await sec.unban('1');
    expect(await sec.isBanned('1')).toBe(false);
  });

  it('firstSeen enforces idempotency', async () => {
    const sec = new SecurityService(repo, { rateLimitPerMin: 30, maxBuySui: 0, allowedIds: [], adminIds: [], enforceAllowlist: false });
    expect(await sec.firstSeen('k')).toBe(true);
    expect(await sec.firstSeen('k')).toBe(false);
  });
});
