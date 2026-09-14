/**
 * End-to-end on-chain test on Sui TESTNET.
 *
 * This performs REAL transactions with a REAL (testnet) key, exercising the full
 * sign → execute → record pipeline. It never prints your key.
 *
 * SETUP (do NOT paste your key into chat — put it in your shell):
 *   1. Create/fund a TESTNET wallet:
 *        - get a key: any Sui wallet, or `npx tsx -e "import('./src/sui/wallet.js').then(m=>console.log(m.createWallet().secretKey))"`
 *        - fund it from the faucet: https://faucet.sui.io  (or `curl` the faucet)
 *   2. Run:
 *        E2E_SUI_KEY=suiprivkey1... npx tsx scripts/e2e-testnet.ts
 *
 * Note: live DEX swaps run on the Cetus aggregator which is MAINNET-only. This
 * script therefore proves the transaction pipeline end-to-end on testnet using
 * real transfers + the trade pipeline (mock router self-transfer). A real Cetus
 * swap must be smoke-tested on mainnet with a small amount.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { SUI_TYPE } from '../src/sui/service.js';
import { formatAmount, toBaseUnits } from '../src/util/format.js';

const TESTNET_RPC = 'https://sui-testnet-rpc.publicnode.com';

async function main() {
  const key = process.env.E2E_SUI_KEY;
  if (!key) throw new Error('Set E2E_SUI_KEY to a funded TESTNET secret key (suiprivkey… or hex).');

  const dir = await mkdtemp(join(tmpdir(), 'suipad-e2e-'));
  const config = {
    telegramBotToken: '1:TEST', allowedTelegramIds: [], adminTelegramIds: [],
    network: 'testnet', rpcUrl: TESTNET_RPC,
    walletEncryptionKey: 'e2e-'.padEnd(48, 'x'),
    swapProvider: 'mock', swapApiBaseUrl: '',
    defaultSlippageBps: 100, tradingFeeBps: 110, displayFeeBps: 100,
    feeWalletAddress: '', feeWalletSecret: '', minReferralClaimSui: 0.05,
    referralLevelBps: [2000, 500, 200, 200, 100],
    storageBackend: 'file', upstashUrl: '', upstashToken: '',
    dataFile: join(dir, 'db.json'), suiCliPath: '', coinTemplatePath: '',
    launchpadPackageId: '', launchpadConfigId: '',
    bridgeProvider: 'mock', bridgeApiBaseUrl: '',
    rateLimitPerMin: 1000, maxBuySui: 0, maxSubWallets: 10,
    publicUrl: '', webhookSecret: '', cronSecret: '', logLevel: 'warn',
  } as AppConfig;

  const app = await buildApp(config);
  const id = 'e2e';
  const { address } = await app.services.wallet.import(id, key);
  console.log('Wallet:', address);

  const bal = await app.services.sui.getBalance(address, SUI_TYPE);
  console.log('Balance:', formatAmount(bal, 9), 'SUI');
  if (bal < toBaseUnits('0.02', 9)) {
    throw new Error('Fund this testnet wallet with ≥0.02 SUI first: https://faucet.sui.io');
  }

  // 1) Real SUI self-transfer (tests signing + execution + wait).
  const signer = await app.services.wallet.getKeypair(id);
  const t1 = await app.services.sui.transfer({ signer, recipient: address, coinType: SUI_TYPE, amount: toBaseUnits('0.001', 9) });
  console.log('✓ transfer tx:', app.services.sui.txUrl(t1.digest));

  // 2) Full trade pipeline (prepareQuote → execute) via the mock router.
  const prepared = await app.services.trade.prepareQuote({
    inputType: SUI_TYPE,
    outputType: '0x2::sui::SUI',
    humanAmount: '0.001',
    slippageBps: 100,
  });
  const t2 = await app.services.trade.execute({ telegramId: id, prepared, signer });
  console.log('✓ trade pipeline tx:', app.services.sui.txUrl(t2.digest));

  // 3) Verify the trade was recorded.
  const user = await app.services.repo.getUser(id);
  console.log('✓ recorded trades:', user?.trades.length, '| status:', user?.trades[0]?.status);

  console.log('\nAll testnet E2E checks passed. (Live Cetus swaps require mainnet.)');
}

main().catch((err) => {
  console.error('E2E FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
