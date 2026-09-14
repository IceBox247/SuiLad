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

  it('requires a fee address when a fee is set', () => {
    expect(() => loadConfig({ ...base, PLATFORM_FEE_BPS: '50' })).toThrow(/PLATFORM_FEE_ADDRESS/);
    const cfg = loadConfig({ ...base, PLATFORM_FEE_BPS: '50', PLATFORM_FEE_ADDRESS: '0xfee' });
    expect(cfg.platformFeeBps).toBe(50);
  });
});
