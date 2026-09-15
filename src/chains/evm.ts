import { logger } from '../logger.js';
import { CHAINS, EVM_CHAIN_ID, NATIVE } from './meta.js';
import type {
  ChainAdapter,
  ChainId,
  ChainMeta,
  GeneratedWallet,
  SwapQuote,
  SwapRequest,
  SwapResult,
  TokenMeta,
} from './types.js';

const LIFI = 'https://li.quest/v1';
/** LI.FI + most tooling use the zero address for a chain's native coin. */
const EVM_NATIVE_ZERO = '0x0000000000000000000000000000000000000000';

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

/** Normalize our native sentinel (or bare native) to LI.FI's zero address. */
function toLifiToken(token: string): string {
  const t = token.toLowerCase();
  if (t === NATIVE.evm.toLowerCase() || t === EVM_NATIVE_ZERO) return EVM_NATIVE_ZERO;
  return token;
}

/** Parse a LI.FI same-chain quote into our chain-neutral SwapQuote. */
export function parseLifiQuote(json: any, req: SwapRequest): SwapQuote {
  const est = json?.estimate ?? {};
  return {
    inputToken: req.inputToken,
    outputToken: req.outputToken,
    inAmount: String(est.fromAmount ?? req.amount),
    outAmount: String(est.toAmount ?? '0'),
    minOut: String(est.toAmountMin ?? est.toAmount ?? '0'),
    route: `LI.FI (${json?.tool ?? 'best'})`,
    raw: json,
  };
}

/**
 * EVM chain adapter (Ethereum, Base, Arbitrum, Polygon, BNB Chain). Trading is
 * routed through LI.FI's aggregator (best price across DEXs; keyless), and
 * signing/broadcast/approvals use viem — imported lazily so non-EVM
 * invocations never pay its cold-start cost. One instance per chain.
 */
export class EvmAdapter implements ChainAdapter {
  readonly meta: ChainMeta;
  private readonly chainId: number;

  constructor(
    chain: ChainId,
    private readonly rpcUrl: string,
    private readonly explorer: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.meta = CHAINS[chain];
    const id = EVM_CHAIN_ID[chain];
    if (!id) throw new Error(`${chain} is not an EVM chain`);
    this.chainId = id;
  }

  private viem() {
    return import('viem');
  }
  private viemAccounts() {
    return import('viem/accounts');
  }

  private async publicClient() {
    const { createPublicClient, http } = await this.viem();
    return createPublicClient({ transport: http(this.rpcUrl) });
  }

  /** Minimal viem Chain so signing uses the correct chainId (EIP-155). */
  private viemChain() {
    return {
      id: this.chainId,
      name: this.meta.name,
      nativeCurrency: { name: this.meta.nativeSymbol, symbol: this.meta.nativeSymbol, decimals: this.meta.nativeDecimals },
      rpcUrls: { default: { http: [this.rpcUrl] } },
    } as const;
  }

  // --- Wallets -------------------------------------------------------------

  async createWallet(): Promise<GeneratedWallet> {
    const { generatePrivateKey, privateKeyToAccount } = await this.viemAccounts();
    const pk = generatePrivateKey();
    return { address: privateKeyToAccount(pk).address, secretKey: pk, scheme: 'secp256k1' };
  }

  async importWallet(secret: string): Promise<GeneratedWallet> {
    const { privateKeyToAccount } = await this.viemAccounts();
    const pk = normalizePk(secret);
    return { address: privateKeyToAccount(pk).address, secretKey: pk, scheme: 'secp256k1' };
  }

  isValidSecret(secret: string): boolean {
    try {
      normalizePk(secret);
      return true;
    } catch {
      return false;
    }
  }

  isValidAddress(address: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(address.trim());
  }

  // --- Reads ---------------------------------------------------------------

  async getNativeBalance(address: string): Promise<bigint> {
    const client = await this.publicClient();
    return client.getBalance({ address: address as `0x${string}` });
  }

  async getTokenBalance(address: string, token: string): Promise<bigint> {
    try {
      const client = await this.publicClient();
      return (await client.readContract({
        address: token as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      })) as bigint;
    } catch (err) {
      logger.debug('evm token balance failed', { token, e: (err as Error).message });
      return 0n;
    }
  }

  async getTokenMeta(token: string): Promise<TokenMeta> {
    const client = await this.publicClient();
    const base = { address: token as `0x${string}`, abi: ERC20_ABI } as const;
    const [decimals, symbol, name] = await Promise.all([
      client.readContract({ ...base, functionName: 'decimals' }).catch(() => 18),
      client.readContract({ ...base, functionName: 'symbol' }).catch(() => token.slice(0, 6)),
      client.readContract({ ...base, functionName: 'name' }).catch(() => token.slice(0, 6)),
    ]);
    return { address: token, symbol: String(symbol), name: String(name), decimals: Number(decimals) };
  }

  // --- Trading -------------------------------------------------------------

  async quote(req: SwapRequest): Promise<SwapQuote> {
    const url =
      `${LIFI}/quote?fromChain=${this.chainId}&toChain=${this.chainId}` +
      `&fromToken=${toLifiToken(req.inputToken)}&toToken=${toLifiToken(req.outputToken)}` +
      `&fromAmount=${req.amount}&fromAddress=${req.owner}&slippage=${req.slippageBps / 10000}`;
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`LI.FI quote failed (${res.status})`);
    const json: any = await res.json();
    if (!json?.estimate?.toAmount || !json?.transactionRequest) throw new Error(`No route: ${json?.message ?? 'unknown'}`);
    return parseLifiQuote(json, req);
  }

  async swap(secretKey: string, quote: SwapQuote, req: SwapRequest): Promise<SwapResult> {
    const { createWalletClient, createPublicClient, http } = await this.viem();
    const { privateKeyToAccount } = await this.viemAccounts();
    const account = privateKeyToAccount(normalizePk(secretKey));
    // Give viem a real chain so it signs with the correct chainId (EIP-155);
    // signing with no chain risks a replay-unsafe or rejected transaction.
    const chain = this.viemChain();
    const wallet = createWalletClient({ account, chain, transport: http(this.rpcUrl) });
    const client = createPublicClient({ chain, transport: http(this.rpcUrl) });
    const raw = quote.raw as any;

    // ERC-20 inputs need an allowance for LI.FI's router before the swap.
    if (toLifiToken(req.inputToken) !== EVM_NATIVE_ZERO) {
      const spender = (raw?.estimate?.approvalAddress ?? raw?.transactionRequest?.to) as `0x${string}`;
      const owner = account.address;
      const allowance = (await client.readContract({
        address: req.inputToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [owner, spender],
      })) as bigint;
      if (allowance < BigInt(req.amount)) {
        const approveHash = await wallet.writeContract({
          address: req.inputToken as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spender, BigInt(req.amount)],
        });
        await client.waitForTransactionReceipt({ hash: approveHash });
      }
    }

    const tx = raw.transactionRequest;
    const hash = await wallet.sendTransaction({
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value: tx.value ? BigInt(tx.value) : 0n,
      gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
    });
    await client.waitForTransactionReceipt({ hash }).catch(() => {});
    return { digest: hash, outAmount: quote.outAmount };
  }

  // --- Explorer ------------------------------------------------------------

  explorerTx(hash: string): string {
    return `${this.explorer}/tx/${hash}`;
  }
  explorerAddress(address: string): string {
    return `${this.explorer}/address/${address}`;
  }
}

/** Normalize a private key to 0x-prefixed 64-hex, or throw. */
function normalizePk(secret: string): `0x${string}` {
  const s = secret.trim();
  const hex = s.startsWith('0x') ? s.slice(2) : s;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('EVM key must be 32 bytes (64 hex chars).');
  return `0x${hex}`;
}
