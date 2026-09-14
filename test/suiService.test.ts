import { describe, it, expect } from 'vitest';
import { SuiService, SUI_TYPE } from '../src/sui/service.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { makeFakeClient } from './helpers.js';

const USDC = '0xusdc::usdc::USDC';

describe('SuiService', () => {
  it('reads a coin balance', async () => {
    const { client } = makeFakeClient({ balances: { [SUI_TYPE]: '2500000000' } });
    const sui = new SuiService(client, 'testnet');
    expect(await sui.getBalance('0xowner', SUI_TYPE)).toBe(2_500_000_000n);
  });

  it('seeds SUI metadata without a network call', async () => {
    const { client } = makeFakeClient();
    const sui = new SuiService(client, 'testnet');
    const meta = await sui.getCoinMeta(SUI_TYPE);
    expect(meta).toEqual({ coinType: SUI_TYPE, decimals: 9, symbol: 'SUI', name: 'Sui' });
  });

  it('lists holdings, SUI first, zero balances filtered', async () => {
    const { client } = makeFakeClient({
      balances: { [SUI_TYPE]: '1000000000', [USDC]: '5000000', '0xzero::z::Z': '0' },
      metadata: { [USDC]: { decimals: 6, symbol: 'USDC', name: 'USD Coin' } },
    });
    const sui = new SuiService(client, 'testnet');
    const holdings = await sui.getHoldings('0xowner');
    expect(holdings.map((h) => h.symbol)).toEqual(['SUI', 'USDC']);
    expect(holdings[1]?.formatted).toBe('5');
  });

  it('falls back to a short symbol for unknown metadata', async () => {
    const { client } = makeFakeClient({ metadata: { [USDC]: null } });
    const sui = new SuiService(client, 'testnet');
    const meta = await sui.getCoinMeta(USDC);
    expect(meta.symbol).toBe('USDC');
    expect(meta.decimals).toBe(0);
  });

  it('executes a transaction and waits', async () => {
    const { client, calls } = makeFakeClient({ executeResult: { digest: 'D1' } });
    const sui = new SuiService(client, 'testnet');
    const signer = Ed25519Keypair.generate();
    const { Transaction } = await import('@mysten/sui/transactions');
    const tx = new Transaction();
    tx.setSender(signer.toSuiAddress());
    const { digest } = await sui.execute(signer, tx);
    expect(digest).toBe('D1');
    expect(calls.executed).toBe(1);
    expect(calls.waited).toEqual(['D1']);
  });

  it('throws on failed execution status', async () => {
    const { client } = makeFakeClient({ executeResult: { status: 'failure', error: 'InsufficientGas' } });
    const sui = new SuiService(client, 'testnet');
    const signer = Ed25519Keypair.generate();
    const { Transaction } = await import('@mysten/sui/transactions');
    const tx = new Transaction();
    tx.setSender(signer.toSuiAddress());
    await expect(sui.execute(signer, tx)).rejects.toThrow(/InsufficientGas/);
  });

  it('transfers SUI and returns a digest', async () => {
    const { client, calls } = makeFakeClient({ executeResult: { digest: 'TX' } });
    const sui = new SuiService(client, 'testnet');
    const signer = Ed25519Keypair.generate();
    const { digest } = await sui.transfer({
      signer,
      recipient: '0x' + '1'.repeat(64),
      coinType: SUI_TYPE,
      amount: 1000n,
    });
    expect(digest).toBe('TX');
    expect(calls.executed).toBe(1);
  });

  it('builds explorer URLs', () => {
    const { client } = makeFakeClient();
    const sui = new SuiService(client, 'mainnet');
    expect(sui.txUrl('abc')).toContain('/tx/abc');
    expect(sui.addressUrl('0x1')).toContain('/account/0x1');
  });
});
