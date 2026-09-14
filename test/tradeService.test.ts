import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { TradeService } from '../src/trade/tradeService.js';
import { MockSwapProvider } from '../src/trade/providers/mock.js';
import { SuiService, SUI_TYPE } from '../src/sui/service.js';
import { Store } from '../src/storage/store.js';
import { makeFakeClient } from './helpers.js';

const USDC = '0xusdc::usdc::USDC';
let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suipad-trade-'));
  store = new Store(join(dir, 'db.json'), { slippageBps: 100 });
  await store.init();
  await store.upsertUser('1', { address: '0xabc', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function buildService(feeBps = 0, feeAddress = '') {
  const { client, calls } = makeFakeClient({
    metadata: { [USDC]: { decimals: 6, symbol: 'USDC', name: 'USD Coin' } },
    executeResult: { digest: 'SWAP_DIGEST' },
  });
  const sui = new SuiService(client, 'testnet');
  const provider = new MockSwapProvider({ [`${SUI_TYPE}->${USDC}`]: [72n, 100n] });
  const trade = new TradeService(provider, sui, store, { platformFeeBps: feeBps, platformFeeAddress: feeAddress });
  return { trade, calls };
}

describe('TradeService', () => {
  it('prepares a quote with metadata and formatting', async () => {
    const { trade } = buildService();
    const prepared = await trade.prepareQuote({
      inputType: SUI_TYPE,
      outputType: USDC,
      humanAmount: '1',
      slippageBps: 100,
    });
    expect(prepared.inputMeta.symbol).toBe('SUI');
    expect(prepared.outputMeta.symbol).toBe('USDC');
    // 1 SUI = 1e9 base; rate 72/100 -> 0.72e9 base out; USDC 6dp -> 720 formatted
    expect(prepared.display.amountOut).toBe('720');
    expect(prepared.feeAmount).toBe(0n);
  });

  it('deducts a platform fee from SUI input', async () => {
    const { trade } = buildService(100, '0xfee'); // 1%
    const prepared = await trade.prepareQuote({
      inputType: SUI_TYPE,
      outputType: USDC,
      humanAmount: '1',
      slippageBps: 0,
    });
    // fee = 1% of 1e9 = 1e7
    expect(prepared.feeAmount).toBe(10_000_000n);
    // routed net = 0.99e9, out = net*72/100
    expect(prepared.quote.amountIn).toBe(990_000_000n);
  });

  it('executes a swap, records it, and returns a digest', async () => {
    const { trade, calls } = buildService();
    const signer = Ed25519Keypair.generate();
    const prepared = await trade.prepareQuote({
      inputType: SUI_TYPE,
      outputType: USDC,
      humanAmount: '1',
      slippageBps: 100,
    });
    const { digest, tradeId } = await trade.execute({ telegramId: '1', prepared, signer, kind: 'buy' });
    expect(digest).toBe('SWAP_DIGEST');
    expect(calls.executed).toBe(1);
    const recorded = store.getUser('1')!.trades.find((t) => t.id === tradeId);
    expect(recorded?.status).toBe('success');
    expect(recorded?.digest).toBe('SWAP_DIGEST');
  });

  it('records a failed swap and rethrows', async () => {
    const { client } = makeFakeClient({
      metadata: { [USDC]: { decimals: 6, symbol: 'USDC', name: 'USD Coin' } },
      executeResult: { status: 'failure', error: 'boom' },
    });
    const sui = new SuiService(client, 'testnet');
    const provider = new MockSwapProvider();
    const trade = new TradeService(provider, sui, store, { platformFeeBps: 0, platformFeeAddress: '' });
    const signer = Ed25519Keypair.generate();
    const prepared = await trade.prepareQuote({
      inputType: SUI_TYPE, outputType: USDC, humanAmount: '1', slippageBps: 100,
    });
    await expect(trade.execute({ telegramId: '1', prepared, signer, kind: 'buy' })).rejects.toThrow(/boom/);
    expect(store.getUser('1')!.trades[0]?.status).toBe('failed');
  });
});
