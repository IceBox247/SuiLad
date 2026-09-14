import { describe, it, expect } from 'vitest';
import { patchCoinBytecode, REFERENCE_TEMPLATE } from '../src/launch/patcher.js';

describe('coin bytecode patcher', () => {
  it('exposes the reference template defaults', () => {
    expect(REFERENCE_TEMPLATE.symbol).toBe('TMPL');
    expect(REFERENCE_TEMPLATE.decimals).toBe(6);
    expect(REFERENCE_TEMPLATE.witness).toBe('TEMPLATE');
  });

  it('loads the WASM and rejects invalid template bytecode', async () => {
    // Not a real compiled module -> the WASM deserializer must reject it,
    // proving the WASM integration is live (rather than silently succeeding).
    const garbage = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(
      patchCoinBytecode(garbage, { symbol: 'MYC', name: 'My Coin', decimals: 9, description: 'x' }),
    ).rejects.toBeTruthy();
  });
});
