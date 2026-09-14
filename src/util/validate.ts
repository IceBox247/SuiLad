/** Validation helpers for user-supplied input. */

const HEX_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;
// Fully-qualified coin type: 0x<pkg>::<module>::<Name> (module/name are Move identifiers).
const COIN_TYPE = /^0x[0-9a-fA-F]{1,64}::[a-zA-Z_][a-zA-Z0-9_]*::[a-zA-Z_][a-zA-Z0-9_]*$/;
const MOVE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** True for a syntactically valid Sui address / object id (0x + 1..64 hex). */
export function isValidSuiAddress(value: string): boolean {
  return HEX_ADDRESS.test(value.trim());
}

/** Normalize an address to 0x + 64 lowercase hex chars. */
export function normalizeSuiAddress(value: string): string {
  const v = value.trim().toLowerCase();
  if (!HEX_ADDRESS.test(v)) throw new Error(`Invalid Sui address: "${value}"`);
  const body = v.slice(2).padStart(64, '0');
  return `0x${body}`;
}

/** True for a fully-qualified coin type string like 0x2::sui::SUI. */
export function isValidCoinType(value: string): boolean {
  const v = value.trim();
  if (v === '0x2::sui::SUI') return true;
  return COIN_TYPE.test(v);
}

/** True for a valid Move identifier (module / struct name). */
export function isMoveIdentifier(value: string): boolean {
  return MOVE_IDENTIFIER.test(value);
}

/** Validate a positive decimal amount string. */
export function isPositiveAmount(value: string): boolean {
  if (!/^\d*\.?\d+$/.test(value.trim())) return false;
  return Number(value) > 0;
}
