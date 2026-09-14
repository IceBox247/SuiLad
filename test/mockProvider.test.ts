import { describe, it, expect } from 'vitest';
import { MockSwapProvider } from '../src/trade/providers/mock.js';
import { SUI_TYPE } from '../src/sui/service.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const USDC = '0xusdc::usdc::USDC';

describe('MockSwapProvider', () => {
  it('quotes 1:1 by default and applies slippage', async () => {
    const p = new MockSwapProvider();
    const q = await p.quote({ inputType: SUI_TYPE, outputType: USDC, amountIn: 1_000_000n, slippageBps: 100 });
    expect(q.amountOut).toBe(1_000_000n);
    expect(q.minAmountOut).toBe(990_000n);
  });

  it('applies a configured rate', async () => {
    const p = new MockSwapProvider({ [`${SUI_TYPE}->${USDC}`]: [72n, 100n] });
    const q = await p.quote({ inputType: SUI_TYPE, outputType: USDC, amountIn: 1_000_000n, slippageBps: 0 });
    expect(q.amountOut).toBe(720_000n);
  });

  it('builds a transaction with commands and the correct sender', async () => {
    const p = new MockSwapProvider();
    const signer = Ed25519Keypair.generate();
    const q = await p.quote({ inputType: SUI_TYPE, outputType: USDC, amountIn: 1000n, slippageBps: 100 });
    const tx = await p.buildTransaction({ quote: q, signer, sender: signer.toSuiAddress() });
    const data = tx.getData();
    expect(data.sender).toBe(signer.toSuiAddress());
    expect(data.commands.length).toBeGreaterThan(0);
  });
});
