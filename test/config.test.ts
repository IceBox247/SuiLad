import { describe, it, expect } from 'vitest';
import { loadConfig, NETWORK_RPC } from '../src/config.js';

const base = {
  TELEGRAM_BOT_TOKEN: '123:abc',
  WALLET_ENCRYPTION_KEY: 'x'.repeat(64),
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('applies sensible defaults', () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.network).toBe('testnet');
    expect(cfg.rpcUrl).toBe(NETWORK_RPC.testnet);
    expect(cfg.swapProvider).toBe('mock');
    expect(cfg.defaultSlippageBps).toBe(100);
    expect(cfg.allowedTelegramIds).toEqual([]);
  });

  it('requires a bot token', () => {
    expect(() => loadConfig({ WALLET_ENCRYPTION_KEY: 'x'.repeat(64) } as NodeJS.ProcessEnv)).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
  });

  it('requires a sufficiently long encryption key', () => {
    expect(() => loadConfig({ ...base, WALLET_ENCRYPTION_KEY: 'short' })).toThrow(
      /WALLET_ENCRYPTION_KEY/,
    );
  });

  it('parses the allowlist as CSV', () => {
    const cfg = loadConfig({ ...base, ALLOWED_TELEGRAM_IDS: '1, 2 ,3' });
    expect(cfg.allowedTelegramIds).toEqual(['1', '2', '3']);
  });

  it('maps networks to default RPC URLs', () => {
    expect(loadConfig({ ...base, SUI_NETWORK: 'mainnet' }).rpcUrl).toBe(NETWORK_RPC.mainnet);
  });

  it('requires an RPC url for custom network', () => {
    expect(() => loadConfig({ ...base, SUI_NETWORK: 'custom' })).toThrow(/custom/);
    const cfg = loadConfig({ ...base, SUI_NETWORK: 'custom', SUI_RPC_URL: 'https://my.node' });
    expect(cfg.rpcUrl).toBe('https://my.node');
  });

  it('defaults fees to 1.1% charged / 1% shown and 5-level referral splits', () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.tradingFeeBps).toBe(110);
    expect(cfg.displayFeeBps).toBe(100);
    expect(cfg.referralLevelBps).toEqual([2000, 500, 200, 200, 100]);
  });

  it('parses custom referral level bps', () => {
    const cfg = loadConfig({ ...base, REFERRAL_LEVEL_BPS: '3000,1000,500' });
    expect(cfg.referralLevelBps).toEqual([3000, 1000, 500, 0, 0]);
  });

  it('selects redis storage when Upstash creds are present', () => {
    const cfg = loadConfig({ ...base, UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' });
    expect(cfg.storageBackend).toBe('redis');
  });
});
