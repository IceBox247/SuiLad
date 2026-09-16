import { describe, it, expect, beforeEach } from 'vitest';
import { OrderEngine } from '../src/services/orderEngine.js';
import { TradeService } from '../src/trade/tradeService.js';
import { MockSwapProvider } from '../src/trade/providers/mock.js';
import { PriceOracle } from '../src/trade/priceOracle.js';
import { WalletService } from '../src/services/walletService.js';
import { ReferralService } from '../src/services/referralService.js';
import { SecurityService } from '../src/services/security.js';
import { SuiService, SUI_TYPE } from '../src/sui/service.js';
import { makeFakeClient, makeRepo } from './helpers.js';
import type { Repo } from '../src/storage/repo.js';

const USDC = '0xusdc::usdc::USDC';
const KEY = 'k'.repeat(64);
let repo: Repo;
let engine: OrderEngine;
let fired: string[];

beforeEach(async () => {
  repo = makeRepo();
  const wallet = new WalletService(repo, KEY);
  await wallet.create('1');
  const { client } = makeFakeClient({
    metadata: { [USDC]: { decimals: 6, symbol: 'USDC', name: 'USD Coin' } },
    balances: { [USDC]: '1000000000' },
    executeResult: { digest: 'ORDER_TX' },
  });
  const sui = new SuiService(client, 'testnet');
  const provider = new MockSwapProvider({ [`${SUI_TYPE}->${USDC}`]: [72n, 100n] });
  const oracle = new PriceOracle(provider, sui);
  const referral = new ReferralService(repo, [2000, 500, 200, 200, 100]);
  const security = new SecurityService(repo, { rateLimitPerMin: 10_000, maxBuySui: 0, allowedIds: [], adminIds: [], enforceAllowlist: false });
  const trade = new TradeService(provider, sui, repo, referral, { tradingFeeBps: 100, displayFeeBps: 100, feeWallet: '0x' + 'f'.repeat(64) });
  fired = [];
  engine = new OrderEngine(repo, oracle, trade, wallet, sui, security, async (_id, msg) => { fired.push(msg); });
});

describe('OrderEngine', () => {
  it('fires a limit buy when price is at/below the trigger', async () => {
    // Current price ≈ 0.00139 SUI/token; trigger 0.01 → price <= trigger.
    await engine.create('1', { kind: 'limit_buy', coinType: USDC, triggerPrice: '0.01', amountSui: '0.5' });
    const res = await engine.tick();
    expect(res.fired).toBe(1);
    const u = (await repo.getUser('1'))!;
    expect(u.orders[0]!.status).toBe('done');
    expect(u.trades.some((t) => t.kind === 'order' && t.status === 'success')).toBe(true);
    expect(fired.length).toBe(1);
  });

  it('does not fire a limit buy when price is above the trigger', async () => {
    await engine.create('1', { kind: 'limit_buy', coinType: USDC, triggerPrice: '0.0000001', amountSui: '0.5' });
    const res = await engine.tick();
    expect(res.fired).toBe(0);
    expect((await repo.getUser('1'))!.orders[0]!.status).toBe('active');
  });

  it('runs a DCA buy and advances the schedule', async () => {
    await engine.create('1', { kind: 'dca', coinType: USDC, dca: { intervalSec: 3600, totalBuys: 2, amountSui: '0.1' } });
    await engine.tick();
    const o = (await repo.getUser('1'))!.orders[0]!;
    expect(o.dca!.completed).toBe(1);
    expect(o.status).toBe('active'); // one buy left, scheduled later
  });

  it('cancels an order', async () => {
    const o = await engine.create('1', { kind: 'limit_buy', coinType: USDC, triggerPrice: '0.0000001', amountSui: '0.5' });
    expect(await engine.cancel('1', o.id)).toBe(true);
    expect((await engine.list('1')).length).toBe(0);
  });
});
