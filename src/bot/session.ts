/** In-memory per-user conversation state for multi-step flows. */

export type FlowName =
  | 'import_wallet'
  | 'buy_token'
  | 'buy_amount'
  | 'sell_amount'
  | 'set_slippage'
  | 'send_recipient'
  | 'send_amount'
  | 'launch';

export interface FlowState {
  flow: FlowName;
  /** Sub-step index for multi-step flows (e.g. launch). */
  step?: number;
  /** Arbitrary carried data (token type, amounts, launch params, …). */
  data: Record<string, string>;
}

export class SessionStore {
  private map = new Map<string, FlowState>();

  get(telegramId: string): FlowState | undefined {
    return this.map.get(telegramId);
  }

  set(telegramId: string, state: FlowState): void {
    this.map.set(telegramId, state);
  }

  update(telegramId: string, patch: Partial<FlowState>): FlowState {
    const current = this.map.get(telegramId) ?? { flow: patch.flow!, data: {} };
    const next: FlowState = {
      flow: patch.flow ?? current.flow,
      step: patch.step ?? current.step,
      data: { ...current.data, ...(patch.data ?? {}) },
    };
    this.map.set(telegramId, next);
    return next;
  }

  clear(telegramId: string): void {
    this.map.delete(telegramId);
  }
}
