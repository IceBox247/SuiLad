import { describe, it, expect, beforeEach } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { TradeService } from '../src/trade/tradeService.js';
import { MockSwapProvider } from '../src/trade/providers/mock.js';
import { ReferralService } from '../src/services/referralService.js';
import { SuiService, SUI_TYPE } from '../src/sui/service.js';
import { makeFakeClient, makeRepo } from './helpers.js';
import type { Repo } from '../src/storage/repo.js';

const USDC = '0xusdc::usdc::USDC';
const FEE_WALLET = '0x' + 'f'.repeat(64);
let repo: Repo;

beforeEach(async () => {
  repo = makeRepo();
  await repo.createUser('1', { address: '0xabc', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
});

function buildService(feeBps = 110) {
  const { client, calls } = makeFakeClient({
    metadata: { [USDC]: { decimals: 6, symbol: 'USDC', name: 'USD Coin' } },
    executeResult: { digest: 'SWAP_DIGEST' },
  });
  const sui = new SuiService(client, 'testnet');
  const provider = new MockSwapProvider({ [`${SUI_TYPE}->${USDC}`]: [72n, 100n] });
  const referral = new ReferralService(repo, [2000, 500, 200, 200, 100]);
  const trade = new TradeService(provider, sui, repo, referral, {
    tradingFeeBps: feeBps,
    displayFeeBps: 100,
    feeWallet: FEE_WALLET,
  });
  return { trade, calls };
}

describe('TradeService', () => {
  it('charges 1.1% on buys but shows 1%, routing the net', async () => {
    const { trade } = buildService(110);
    const prepared = await trade.prepareQuote({ inputType: SUI_TYPE, outputType: USDC, humanAmount: '1', slippageBps: 100 });
    // fee charged = 1.1% of 1e9 = 11,000,000 MIST
    expect(prepared.feeSuiValue).toBe(11_000_000n);
    // routed net = 989,000,000
    expect(prepared.quote.amountIn).toBe(989_000_000n);
    // displayed fee uses 1% (display bps) = 0.01 SUI
    expect(prepared.display.feeShown).toBe('0.01');
    expect(prepared.display.displayFeePct).toBe('1%');
  });

  it('executes, records the trade, tracks the position, and credits referrers', async () => {
    // Set up a referral chain: '1' referred by 'boss'.
    await repo.createUser('boss', { address: '0xboss', encryptedSecretKey: 'e', keyScheme: 'ED25519' });
    await repo.withUser('1', (u) => { u.referral.referrerId = 'boss'; });

    const { trade, calls } = buildService(110);
    const signer = Ed25519Keypair.generate();
    const prepared = await trade.prepareQuote({ inputType: SUI_TYPE, outputType: USDC, humanAmount: '1', slippageBps: 100 });
    const { digest, tradeId } = await trade.execute({ telegramId: '1', prepared, signer });
    expect(digest).toBe('SWAP_DIGEST');
    expect(calls.executed).toBe(1);

    const user = (await repo.getUser('1'))!;
    expect(user.trades.find((t) => t.id === tradeId)?.status).toBe('success');
    expect(user.positions.find((p) => p.coinType === USDC)?.amount).toBe(prepared.quote.amountOut.toString());

    // Referrer got 20% of the fee (2000 bps).
    const boss = (await repo.getUser('boss'))!;
    expect(BigInt(boss.referral.unclaimedMist)).toBe((11_000_000n * 2000n) / 10_000n);
  });

  it('records a failed swap and rethrows', async () => {
    const { client } = makeFakeClient({
      metadata: { [USDC]: { decimals: 6, symbol: 'USDC', name: 'USD Coin' } },
      executeResult: { status: 'failure', error: 'boom' },
    });
    const sui = new SuiService(client, 'testnet');
    const referral = new ReferralService(repo, [2000, 500, 200, 200, 100]);
    const trade = new TradeService(new MockSwapProvider(), sui, repo, referral, { tradingFeeBps: 110, displayFeeBps: 100, feeWallet: FEE_WALLET });
    const signer = Ed25519Keypair.generate();
    const prepared = await trade.prepareQuote({ inputType: SUI_TYPE, outputType: USDC, humanAmount: '1', slippageBps: 100 });
    await expect(trade.execute({ telegramId: '1', prepared, signer })).rejects.toThrow(/boom/);
    expect((await repo.getUser('1'))!.trades[0]?.status).toBe('failed');
  });
});
