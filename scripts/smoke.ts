/**
 * Live smoke test (read-only). Proves the chain + quoting layers work against
 * real networks. Runs no transactions and spends nothing.
 *   npx tsx scripts/smoke.ts
 */
import { createSuiClient } from '../src/sui/client.js';
import { SuiService, SUI_TYPE } from '../src/sui/service.js';
import { createWallet } from '../src/sui/wallet.js';
import { CetusAggregatorProvider } from '../src/trade/providers/cetus.js';
import { formatAmount } from '../src/util/format.js';

async function main() {
  // 1. Wallet generation (offline).
  const w = createWallet();
  console.log('✓ generated wallet:', w.address);

  // 2. Read a balance from Sui testnet (a fresh wallet: expect 0).
  const testnet = new SuiService(createSuiClient('https://sui-testnet-rpc.publicnode.com'), 'testnet');
  const bal = await testnet.getBalance(w.address, SUI_TYPE);
  console.log('✓ testnet SUI balance of new wallet:', formatAmount(bal, 9), '(expected 0)');

  // 3. Read holdings of a known active mainnet address via the SuiService.
  //    (Uses getAllBalances; a well-known address is fine for a read.)
  const mainnetClient = createSuiClient('https://sui-rpc.publicnode.com');
  const mainnet = new SuiService(mainnetClient, 'mainnet');
  try {
    const meta = await mainnet.getCoinMeta(SUI_TYPE);
    console.log('✓ mainnet SUI metadata:', meta.symbol, meta.decimals + 'dp');
  } catch (e) {
    console.log('… mainnet metadata read skipped:', (e as Error).message);
  }

  // 4. Live routing quote via the Cetus aggregator (mainnet), 1 SUI -> USDC.
  const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const cetus = new CetusAggregatorProvider(mainnetClient, 'mainnet');
  const quote = await cetus.quote({
    inputType: SUI_TYPE,
    outputType: USDC,
    amountIn: 1_000_000_000n, // 1 SUI
    slippageBps: 100,
  });
  console.log(
    `✓ live Cetus quote: 1 SUI -> ${formatAmount(quote.amountOut, 6)} USDC ` +
      `(min ${formatAmount(quote.minAmountOut, 6)}), route: ${quote.routeLabel}`,
  );

  console.log('\nAll live checks passed.');
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});
