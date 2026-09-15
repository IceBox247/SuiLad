import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import type { LogLevel } from './logger.js';

loadDotenv();

/**
 * Default RPC endpoints per network. Sui's public fullnodes have deprecated the
 * classic JSON-RPC methods this bot (and the Cetus SDK) rely on, so we default
 * to JSON-RPC-compatible community providers. Set SUI_RPC_URL for production.
 */
export const NETWORK_RPC: Record<string, string> = {
  mainnet: 'https://sui-rpc.publicnode.com',
  testnet: 'https://sui-testnet-rpc.publicnode.com',
  devnet: 'https://fullnode.devnet.sui.io',
  localnet: 'http://127.0.0.1:9000',
};

const csvIds = z
  .string()
  .optional()
  .transform((v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean));

const csvNums = (fallback: number[]) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return fallback;
      const parts = v.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      return parts.length ? parts : fallback;
    });

const RawSchema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  ALLOWED_TELEGRAM_IDS: csvIds,
  ADMIN_TELEGRAM_IDS: csvIds,

  // Network
  SUI_NETWORK: z.enum(['mainnet', 'testnet', 'devnet', 'localnet', 'custom']).default('testnet'),
  SUI_RPC_URL: z.string().url().optional().or(z.literal('')),

  // Wallet security
  WALLET_ENCRYPTION_KEY: z.string().min(32, 'WALLET_ENCRYPTION_KEY must be at least 32 characters'),

  // Trading / routing
  SWAP_PROVIDER: z.enum(['mock', 'cetus']).default('mock'),
  SWAP_API_BASE_URL: z.string().url().optional().or(z.literal('')),
  DEFAULT_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(5000).default(100),

  // Fees (charged vs displayed) + referral distribution
  TRADING_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(110), // actually charged (1.1%)
  DISPLAY_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(100), // shown to users (1%)
  FEE_WALLET_ADDRESS: z.string().optional().or(z.literal('')),
  // Secret key of the fee wallet — enables on-chain referral payouts (/referral → Claim).
  FEE_WALLET_SECRET: z.string().optional().or(z.literal('')),
  // Minimum claimable referral balance in SUI (covers gas; avoids dust claims).
  MIN_REFERRAL_CLAIM_SUI: z.coerce.number().min(0).default(0.05),
  REFERRAL_LEVEL_BPS: csvNums([2000, 500, 200, 200, 100]), // % of fee to L1..L5

  // Storage. Accept both the Upstash names and Vercel's KV integration names
  // (Vercel auto-injects KV_REST_API_URL / KV_REST_API_TOKEN when you create a
  // Redis/Upstash store from the Vercel dashboard).
  UPSTASH_REDIS_REST_URL: z.string().url().optional().or(z.literal('')),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().or(z.literal('')),
  KV_REST_API_URL: z.string().url().optional().or(z.literal('')),
  KV_REST_API_TOKEN: z.string().optional().or(z.literal('')),
  DATA_FILE: z.string().default('./data/suipad.json'),

  // Launch / launchpad
  SUI_CLI_PATH: z.string().optional().or(z.literal('')),
  COIN_TEMPLATE_PATH: z.string().optional().or(z.literal('')),
  LAUNCHPAD_PACKAGE_ID: z.string().optional().or(z.literal('')),
  LAUNCHPAD_CONFIG_ID: z.string().optional().or(z.literal('')),

  // Bridging
  BRIDGE_PROVIDER: z.enum(['mock', 'mayan', 'debridge']).default('mock'),
  BRIDGE_API_BASE_URL: z.string().url().optional().or(z.literal('')),

  // Security / limits
  // Public by default. Set ENFORCE_ALLOWLIST=true to restrict to ALLOWED_TELEGRAM_IDS.
  ENFORCE_ALLOWLIST: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(6000).default(30),
  MAX_BUY_SUI: z.coerce.number().min(0).default(0), // 0 = no cap
  MAX_SUBWALLETS: z.coerce.number().int().min(1).max(50).default(10),

  // Hosting (Vercel webhook + cron)
  PUBLIC_URL: z.string().url().optional().or(z.literal('')),
  WEBHOOK_SECRET: z.string().optional().or(z.literal('')),
  CRON_SECRET: z.string().optional().or(z.literal('')),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface AppConfig {
  telegramBotToken: string;
  allowedTelegramIds: string[];
  adminTelegramIds: string[];
  network: string;
  rpcUrl: string;
  walletEncryptionKey: string;
  swapProvider: 'mock' | 'cetus';
  swapApiBaseUrl: string;
  defaultSlippageBps: number;
  tradingFeeBps: number;
  displayFeeBps: number;
  feeWalletAddress: string;
  feeWalletSecret: string;
  minReferralClaimSui: number;
  referralLevelBps: number[];
  storageBackend: 'redis' | 'file';
  upstashUrl: string;
  upstashToken: string;
  dataFile: string;
  suiCliPath: string;
  coinTemplatePath: string;
  launchpadPackageId: string;
  launchpadConfigId: string;
  bridgeProvider: 'mock' | 'mayan' | 'debridge';
  bridgeApiBaseUrl: string;
  enforceAllowlist: boolean;
  rateLimitPerMin: number;
  maxBuySui: number;
  maxSubWallets: number;
  publicUrl: string;
  webhookSecret: string;
  cronSecret: string;
  logLevel: LogLevel;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Treat empty-string env vars as unset so schema defaults/optionals apply.
  // (Pasting a whole .env template into a host often creates blank values like
  // `SWAP_PROVIDER=`, which would otherwise fail enum/number validation.)
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && v.trim() !== '') cleaned[k] = v;
  }
  const parsed = RawSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const raw = parsed.data;

  const network = raw.SUI_NETWORK;
  let rpcUrl = raw.SUI_RPC_URL || '';
  if (!rpcUrl) {
    if (network === 'custom') throw new Error('SUI_NETWORK=custom requires SUI_RPC_URL to be set.');
    rpcUrl = NETWORK_RPC[network]!;
  }

  if (raw.TRADING_FEE_BPS > 0 && !raw.FEE_WALLET_ADDRESS) {
    // Not fatal, but fees can't be collected without a destination.
  }

  const levels = raw.REFERRAL_LEVEL_BPS.slice(0, 5);
  while (levels.length < 5) levels.push(0);

  // Prefer explicit Upstash names, fall back to Vercel's KV integration names.
  const upstashUrl = raw.UPSTASH_REDIS_REST_URL || raw.KV_REST_API_URL || '';
  const upstashToken = raw.UPSTASH_REDIS_REST_TOKEN || raw.KV_REST_API_TOKEN || '';
  const hasRedis = Boolean(upstashUrl && upstashToken);

  return {
    telegramBotToken: raw.TELEGRAM_BOT_TOKEN,
    allowedTelegramIds: raw.ALLOWED_TELEGRAM_IDS,
    adminTelegramIds: raw.ADMIN_TELEGRAM_IDS,
    enforceAllowlist: raw.ENFORCE_ALLOWLIST,
    network,
    rpcUrl,
    walletEncryptionKey: raw.WALLET_ENCRYPTION_KEY,
    swapProvider: raw.SWAP_PROVIDER,
    swapApiBaseUrl: raw.SWAP_API_BASE_URL || '',
    defaultSlippageBps: raw.DEFAULT_SLIPPAGE_BPS,
    tradingFeeBps: raw.TRADING_FEE_BPS,
    displayFeeBps: raw.DISPLAY_FEE_BPS,
    feeWalletAddress: raw.FEE_WALLET_ADDRESS || '',
    feeWalletSecret: raw.FEE_WALLET_SECRET || '',
    minReferralClaimSui: raw.MIN_REFERRAL_CLAIM_SUI,
    referralLevelBps: levels,
    storageBackend: hasRedis ? 'redis' : 'file',
    upstashUrl,
    upstashToken,
    dataFile: raw.DATA_FILE,
    suiCliPath: raw.SUI_CLI_PATH || '',
    coinTemplatePath: raw.COIN_TEMPLATE_PATH || '',
    launchpadPackageId: raw.LAUNCHPAD_PACKAGE_ID || '',
    launchpadConfigId: raw.LAUNCHPAD_CONFIG_ID || '',
    bridgeProvider: raw.BRIDGE_PROVIDER,
    bridgeApiBaseUrl: raw.BRIDGE_API_BASE_URL || '',
    rateLimitPerMin: raw.RATE_LIMIT_PER_MIN,
    maxBuySui: raw.MAX_BUY_SUI,
    maxSubWallets: raw.MAX_SUBWALLETS,
    publicUrl: raw.PUBLIC_URL || '',
    webhookSecret: raw.WEBHOOK_SECRET || '',
    cronSecret: raw.CRON_SECRET || '',
    logLevel: raw.LOG_LEVEL,
  };
}
