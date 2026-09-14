# 🚀 SuiPad

A Telegram bot that lets anyone **trade tokens** and **launch new coins** on the
[Sui](https://sui.io) blockchain — straight from a chat.

- 💼 **Non-custodial-per-user wallets** — each Telegram user gets a Sui wallet; private keys are encrypted at rest (AES-256-GCM).
- 🟢🔴 **Trade any token** — buy/sell routed through the **Cetus DEX Aggregator** (best execution across Cetus, Aftermath, Bluefin, DeepBook, Turbos, FlowX, Kriya, …).
- 🚀 **Launch a coin** in a guided flow — name, symbol, decimals, supply — and SuiPad compiles & publishes the Move `Coin` module for you.
- 📊 Balances, live prices, slippage settings, transfers, and trade/launch history.

> ⚠️ **This bot moves real money.** Read the [Security](#-security) section before deploying. Start on **testnet** and with small amounts.

---

## Quick start

```bash
# 1. Install deps (Node.js 20+)
npm install

# 2. Configure
cp .env.example .env
#    - TELEGRAM_BOT_TOKEN   from @BotFather
#    - WALLET_ENCRYPTION_KEY  = $(openssl rand -hex 32)
#    - SUI_NETWORK=testnet   (recommended to start)

# 3. Verify everything works
npm run test        # 85 unit tests
npm run smoke       # live read-only checks (balance + a real Cetus quote)

# 4. Run
npm start
```

Then open your bot in Telegram and send `/start`.

---

## Commands

| Command | What it does |
| --- | --- |
| `/start` | Create/show your wallet and the main menu |
| `/wallet` | Wallet details, deposit, send, export key |
| `/balance` | Your token balances |
| `/buy <coinType>` | Buy a token with SUI |
| `/sell` | Pick a held token and sell it for SUI |
| `/price <coinType>` | Live price of a token in SUI |
| `/send` | Transfer SUI to an address |
| `/launch` | Guided flow to create & deploy a new coin |
| `/positions` | Recent trades & launches |
| `/settings` | Slippage tolerance & preferences |

A coin type looks like `0xdba3…900e7::usdc::USDC`.

---

## Configuration

All configuration is via environment variables (see [`.env.example`](./.env.example)).

| Var | Required | Notes |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | ✅ | From [@BotFather](https://t.me/BotFather). |
| `WALLET_ENCRYPTION_KEY` | ✅ | ≥32 chars. `openssl rand -hex 32`. **Back this up** — losing it makes every stored wallet unrecoverable. |
| `SUI_NETWORK` | | `mainnet` \| `testnet` \| `devnet` \| `localnet` \| `custom` (default `testnet`). |
| `SUI_RPC_URL` | | Override the RPC endpoint. **Recommended for mainnet** (see below). |
| `ALLOWED_TELEGRAM_IDS` | | Comma-separated allowlist. Empty = open to everyone. |
| `SWAP_PROVIDER` | | `mock` (offline, dev) \| `cetus` (live routing). Default `mock`. |
| `DEFAULT_SLIPPAGE_BPS` | | Default slippage in basis points (100 = 1%). |
| `PLATFORM_FEE_BPS` / `PLATFORM_FEE_ADDRESS` | | Optional operator fee on SUI-funded swaps. |
| `COIN_TEMPLATE_PATH` | | Enables compiler-free launching (see [Launching](#launching-a-coin)). |
| `SUI_CLI_PATH` | | Path to the `sui` CLI for compile-based launching. |

### ⚠️ RPC endpoints (important)

Sui's **public** fullnodes (`fullnode.<net>.sui.io`) have **deprecated the classic
JSON-RPC methods** this bot relies on and now return `Method not found`.
SuiPad therefore defaults to JSON-RPC-compatible community providers
(`sui-rpc.publicnode.com`, `sui-testnet-rpc.publicnode.com`).

For production, set `SUI_RPC_URL` to **your own fullnode** or a **dedicated RPC
provider** (with an API key) for reliability and higher rate limits.

---

## How it works

```
Telegram ──> grammY bot ──> Services
                              ├── WalletService   (encrypt/decrypt keys, sign)
                              ├── SuiService       (balances, metadata, transfers, execute)
                              ├── TradeService ──> SwapProvider (Cetus aggregator | mock)
                              └── LaunchService ─> Move template → publish
                              Store (encrypted JSON, atomic writes)
```

### Trading

Quotes and swap transactions are produced by a pluggable `SwapProvider`:

- **`cetus`** — uses the [Cetus DEX Aggregator](https://www.cetus.zone/), which
  splits your order across many Sui DEXes for the best price. Verified live:
  `1 SUI → ~0.726 USDC` routed via Bluefin at time of writing.
- **`mock`** — deterministic, offline pricing so you can exercise the whole bot
  flow (quote → confirm → execute a harmless self-transfer) without a live API.

Slippage protection (`minAmountOut`) is computed from your slippage setting and
enforced on-chain by the aggregator.

### Launching a coin

`/launch` walks you through name, symbol, decimals and supply, previews the
generated Move module, and publishes it. Two strategies:

1. **Compiler-free (recommended for a server)** — set `COIN_TEMPLATE_PATH` to a
   precompiled coin-template bytecode. SuiPad patches the identifiers and
   metadata directly ([`@mysten/move-bytecode-template`](https://www.npmjs.com/package/@mysten/move-bytecode-template)) — **no Sui CLI needed at runtime**. Build the template once:
   ```bash
   npm run build:template   # requires the Sui CLI, run once
   # writes assets/coin-template.b64 → set COIN_TEMPLATE_PATH=assets/coin-template.b64
   ```
2. **Compile on demand** — if the [`sui` CLI](https://docs.sui.io/references/cli)
   is installed, SuiPad generates a full Move package and runs
   `sui move build` for each launch. Set `SUI_CLI_PATH` if it isn't on `PATH`.

The generated module (Move 2024 edition) creates the currency, mints the initial
supply to you, freezes the `CoinMetadata`, and either transfers the `TreasuryCap`
to you (mint authority kept) or freezes it (fixed supply).

---

## 🔒 Security

This bot **custodies signing keys** for its users. Treat it accordingly:

- **Private keys are encrypted at rest** with AES-256-GCM; a per-record scrypt key
  is derived from `WALLET_ENCRYPTION_KEY`. Plaintext keys never hit the store.
- **`WALLET_ENCRYPTION_KEY` is the crown jewel.** Store it in a secret manager,
  not in the repo. If it leaks, all wallets are compromised. If it's lost, all
  wallets are unrecoverable.
- The bot process can sign transactions for any user it holds a key for — run it
  on trusted infrastructure, restrict `ALLOWED_TELEGRAM_IDS`, and keep the data
  file (`DATA_FILE`) private and backed up.
- **Use burner wallets / small amounts.** Recommend the same to your users.
- The JSON store is fine for a single process; for scale, swap it for SQLite or
  Postgres behind the same `Store` interface.

Nothing here is financial advice. You are responsible for the funds and tokens
you and your users move.

---

## Testing & verification

```bash
npm run lint    # tsc --noEmit (strict)
npm run test    # 85 unit tests (crypto, encoding, quoting, store, launch templating, …)
npm run smoke   # live: reads a testnet balance, mainnet metadata, and a real Cetus quote
```

What's covered vs. what needs your keys:

- ✅ **Unit-tested & live-verified**: config, key encryption, wallet gen/import,
  unit conversion & slippage math, the storage layer, the swap-quote pipeline
  (including a **live** Cetus mainnet quote), Move source generation, and publish
  result parsing.
- 🔑 **Needs your funded wallet to exercise on-chain**: executing real swaps and
  publishing a coin (both build validated transactions but require gas + signing).
  Start on testnet.

---

## Project layout

```
src/
  config.ts            env parsing & validation (zod)
  crypto/encryption.ts AES-256-GCM secret storage
  storage/             encrypted JSON store (atomic writes)
  sui/                 client, wallet keypairs, balances, transfers, execute
  trade/               SwapProvider interface, slippage math, Cetus + mock providers
  launch/              Move source generator, bytecode patcher, publisher
  services/            WalletService (key lifecycle)
  bot/                 grammY bot, commands, flows, keyboards
  index.ts             entrypoint
scripts/
  smoke.ts             live read-only checks
  build-coin-template.ts  build the compiler-free launch template (needs sui CLI)
test/                  vitest suite
```
