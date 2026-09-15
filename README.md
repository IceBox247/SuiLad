# 🚀 SuiPad

A fast, secure **Telegram trading + launchpad bot for the Sui blockchain**. Trade
any token, run automated strategies, launch coins on a bonding curve, bundle buys
across many wallets, bridge across chains, and earn through a 5-level referral
program — all from Telegram, deployable to **Vercel**.

> ⚠️ **This bot moves real money and custodies signing keys.** Read
> [Security](#-security) before deploying. Start on **testnet** with small amounts.

---

## Features

**Trading**
- Buy / sell any token via the **Cetus DEX aggregator** (best execution across
  Cetus, Aftermath, Bluefin, DeepBook, Turbos, FlowX, Kriya, Momentum, …).
- Live prices, positions & realized PnL, slippage control, MEV-aware execution.
- **1% trading fee** (charged at 1.1%, shown as 1% — configurable).

**Automation** (runs on a cron tick)
- **Limit buy / limit sell**, **take-profit**, **stop-loss**.
- **DCA** — recurring buys on a schedule.
- **Copy-trade** — mirror a leader wallet's buys, proportionally, capped by budget.
- **Sniper** — auto-buy the instant a token becomes tradeable.
- **Watchlist** with price alerts.

**Power tools**
- **Bundle buy** — buy the same token from many sub-wallets in one click.
- **Launchpad** — publish a coin and trade it on a **bonding curve** (pump.fun
  style), with migration to a DEX at a raise threshold.
- **Bridge** — quote Sui ↔ Ethereum/EVM ↔ Solana via an aggregator (Mayan/deBridge).
- **5-level referrals** — earn 20% / 5% / 2% / 2% / 1% of the platform fee from
  your downline.

**UX & ops**
- Slick inline-keyboard UI + Telegram **Menu button** listing every command.
- Per-user encrypted wallets, rate limiting, per-user locks, allowlist & bans.
- Deploys to **Vercel** (webhook + cron) with **Upstash Redis** storage.

---

## Quick start (local)

```bash
npm install
cp .env.example .env         # set TELEGRAM_BOT_TOKEN + WALLET_ENCRYPTION_KEY
#   WALLET_ENCRYPTION_KEY:  openssl rand -hex 32
#   SUI_NETWORK=testnet  (recommended to start)

npm test                     # 119 unit/integration tests
npm run smoke                # live read-only checks (balance + real Cetus quote)
npm start                    # long-polling mode
```

Open the bot in Telegram → `/start`.

---

## Deploy to Vercel

The bot runs as two serverless functions: `api/webhook.ts` (Telegram updates) and
`api/cron.ts` (automation ticks). State lives in **Upstash Redis** (the local JSON
store is not usable on Vercel's ephemeral filesystem).

1. **Create an Upstash Redis DB** → copy `UPSTASH_REDIS_REST_URL` + `_TOKEN`.
2. **Import the repo into Vercel** and set env vars (see `.env.example`):
   - `TELEGRAM_BOT_TOKEN`, `WALLET_ENCRYPTION_KEY`
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - `SUI_NETWORK`, `SUI_RPC_URL` (a JSON-RPC provider for mainnet)
   - `SWAP_PROVIDER=cetus`, `FEE_WALLET_ADDRESS`
   - **`WEBHOOK_SECRET`** (required — see Security), `CRON_SECRET`, `PUBLIC_URL`
3. **Deploy.** `vercel.json` schedules `/api/cron` every minute (needs Vercel Pro
   for sub-daily crons).
4. **Register the webhook + Menu button:**
   ```bash
   PUBLIC_URL=https://<you>.vercel.app WEBHOOK_SECRET=<same> npx tsx scripts/set-webhook.ts
   ```

---

## Configuration

Every setting is an env var — see [`.env.example`](./.env.example). Highlights:

| Var | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | From @BotFather. |
| `WALLET_ENCRYPTION_KEY` | ≥32 bytes; encrypts every stored key. Back it up. |
| `SUI_NETWORK` / `SUI_RPC_URL` | Network + RPC (use a JSON-RPC provider for mainnet). |
| `SWAP_PROVIDER` | `mock` (offline) or `cetus` (live, mainnet). |
| `TRADING_FEE_BPS` / `DISPLAY_FEE_BPS` | Charged (110) vs shown (100). |
| `FEE_WALLET_ADDRESS` | Where fees are collected. |
| `REFERRAL_LEVEL_BPS` | `2000,500,200,200,100` (L1–L5 share of the fee). |
| `UPSTASH_REDIS_REST_URL/_TOKEN` | Storage (auto-selects Redis when present). |
| `LAUNCHPAD_PACKAGE_ID` | Deployed bonding-curve package (see `move/launchpad`). |
| `BRIDGE_PROVIDER` | `mayan` / `debridge` / `mock`. |
| `ENFORCE_ALLOWLIST` | `true` makes the bot private (default: public). |
| `CASHBACK_BPS` | Share of each user's own fee rebated to them (default 2000 = 20%). |
| `ALLOWED_TELEGRAM_IDS` / `ADMIN_TELEGRAM_IDS` | Access control (allowlist only applies when `ENFORCE_ALLOWLIST=true`). |
| `WEBHOOK_SECRET` / `CRON_SECRET` | Required to secure the Vercel endpoints. |

### RPC note
Public `*.sui.io` fullnodes have **deprecated JSON-RPC**; defaults point at
JSON-RPC-compatible providers. Use your own node/provider for mainnet.

---

## Architecture

```
Telegram ─┬─ long-poll (src/index.ts)        Vercel ─┬─ api/webhook.ts (updates)
          │                                          └─ api/cron.ts   (automation)
          ▼
      grammY bot (src/bot) ── Services (src/app.ts wires everything)
        ├── WalletService     encrypt/sign, main + sub-wallets
        ├── TradeService      quote → fee (1.1%) → swap → referral credit → PnL
        ├── OrderEngine       limit / TP / SL / DCA  (cron tick)
        ├── CopyTradeService  mirror leader buys       (cron tick)
        ├── SniperService     auto-buy when tradeable  (cron tick)
        ├── WatchlistService  price alerts             (cron tick)
        ├── BundleService     multi-wallet buys
        ├── ReferralService   5-level fee distribution
        ├── SecurityService   rate limits, locks, bans, spend caps
        ├── LaunchService     publish coins (template / Sui CLI)
        ├── LaunchpadClient   bonding-curve create/buy/sell (move/launchpad)
        └── BridgeService     cross-chain quotes
      Repo (src/storage) ── KV backend: Upstash Redis | file, per-user locks
```

**Bonding curve** (`src/launch/curve.ts` + `move/launchpad/`): constant-product
with virtual reserves; all division rounds **pool-protectively** so rounding
dust can never drain the curve (covered by tests). The Move contract is provided
ready to compile/audit/deploy.

---

## 🔒 Security

- **Keys encrypted at rest** (AES-256-GCM + per-record scrypt key). Plaintext keys
  never hit storage.
- **`WALLET_ENCRYPTION_KEY`** is the crown jewel — store it in a secret manager;
  losing it makes wallets unrecoverable, leaking it compromises all wallets.
- **Webhook fails closed**: `api/webhook.ts` refuses to run without `WEBHOOK_SECRET`
  and validates Telegram's secret-token header, preventing forged updates that
  could impersonate users. Always set it.
- **Per-user locks** serialize every balance/order mutation (no lost updates or
  double-spends across concurrent webhook + cron invocations).
- **Rate limiting, spend caps, allowlist & bans** guard against abuse.
- **Referral loop protection**: self-referral and cycles are rejected.
- **Curve math is drain-safe** (pool-protective rounding, tested).
- Referral earnings accrue to a ledger and are paid out by the operator — the bot
  never auto-transfers from the fee wallet.

Use burner wallets / small amounts; tell your users the same. Nothing here is
financial advice — you are responsible for the funds you and your users move.

---

## Testing & verification

```bash
npm run lint         # strict tsc --noEmit
npm test             # 123 tests
npm run smoke        # live: testnet balance, mainnet metadata, real Cetus quote
E2E_SUI_KEY=... npm run e2e:testnet   # real on-chain testnet transfer + trade pipeline
```

**On-chain referral payouts:** set `FEE_WALLET_SECRET` and users' `/referral → Claim`
sends SUI from the fee wallet to their address. The amount is reserved under a
per-user lock before the transfer and refunded if it fails (no lost balances,
no double-claims). Without the secret, earnings stay in the ledger for manual payout.

**Verified here:** config, key encryption, wallet/sub-wallet lifecycle, unit &
slippage math, the storage layer + concurrency locks, fee split, **5-level
referral distribution**, **bonding-curve math** (incl. drain-safety), the **order
engine** (limit/TP/SL/DCA firing), copy-trade math, bridge quoting/parsing, Move
templating, and a **live Cetus mainnet quote**. Full app wiring (bot + all
services + a cron tick) boots cleanly.

**Requires your keys/funds/deploy to exercise on-chain** (build validated
transactions; test on testnet first):
- Real swap / launch / bundle / snipe / copy execution (needs a funded wallet).
- The **bonding-curve launchpad** package must be compiled, **audited**, and
  deployed with the Sui CLI, then set `LAUNCHPAD_PACKAGE_ID`.
- **Bridging** execution goes through the provider/relayer; quotes are wired,
  smoke-test against the live provider before mainnet.

---

## Launching the bonding-curve package

```bash
# One-time, on a machine with the Sui CLI + a funded deployer:
cd move/launchpad && sui client publish --gas-budget 200000000
# Set the resulting package id:
#   LAUNCHPAD_PACKAGE_ID=0x...
```
Have the Move contract audited before mainnet use.

---

## Project layout

```
api/                webhook + cron serverless entrypoints (Vercel)
move/launchpad/     bonding-curve Move package
src/
  app.ts            wires all services (shared by CLI + Vercel)
  config.ts         env parsing & validation (zod)
  bot/              grammY bot, slick UI, flows, safety middleware
  crypto/           AES-256-GCM secret storage
  storage/          KV backend (Redis|file) + per-user-locked Repo
  sui/              client, wallets, balances, transfers, tx exec
  trade/            swap providers (Cetus|mock), fees, price oracle
  services/         wallet, referral, security, orders, copy, sniper, watchlist, bundle
  launch/           coin templating, curve math, launchpad client
  bridge/           cross-chain quote providers
scripts/            smoke, template build, webhook setup
test/               vitest suite (119 tests)
```
