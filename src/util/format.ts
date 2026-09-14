/**
 * Formatting & unit-conversion helpers. All on-chain amounts are handled as
 * bigint base units; conversions to/from human decimal strings are done with
 * string math to avoid floating-point rounding errors.
 */

/** Parse a human decimal amount (e.g. "1.5") into base units given `decimals`. */
export function toBaseUnits(amount: string | number, decimals: number): bigint {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error(`Invalid decimals: ${decimals}`);
  }
  const str = typeof amount === 'number' ? numberToPlainString(amount) : amount.trim();
  if (str === '' || str === '.' || str === '-') throw new Error(`Invalid amount: "${amount}"`);
  if (!/^-?\d*\.?\d*$/.test(str)) throw new Error(`Invalid amount: "${amount}"`);

  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [intPart = '0', fracPartRaw = ''] = unsigned.split('.');
  if (fracPartRaw.length > decimals) {
    throw new Error(`Amount "${amount}" has more than ${decimals} decimal places`);
  }
  const fracPart = fracPartRaw.padEnd(decimals, '0');
  const combined = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, '');
  const value = BigInt(combined === '' ? '0' : combined);
  return negative ? -value : value;
}

/** Convert base units to a human decimal string (no thousands separators). */
export function fromBaseUnits(amount: bigint, decimals: number): string {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error(`Invalid decimals: ${decimals}`);
  }
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const s = abs.toString().padStart(decimals + 1, '0');
  const intPart = s.slice(0, s.length - decimals);
  const fracPart = decimals === 0 ? '' : s.slice(s.length - decimals).replace(/0+$/, '');
  const result = fracPart ? `${intPart}.${fracPart}` : intPart;
  return negative ? `-${result}` : result;
}

/** Human-friendly formatted amount with thousands separators and capped fraction digits. */
export function formatAmount(amount: bigint, decimals: number, maxFractionDigits = 6): string {
  const plain = fromBaseUnits(amount, decimals);
  const negative = plain.startsWith('-');
  const [intPart = '0', fracPart = ''] = (negative ? plain.slice(1) : plain).split('.');
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = fracPart.slice(0, maxFractionDigits);
  frac = frac.replace(/0+$/, '');
  const body = frac ? `${groupedInt}.${frac}` : groupedInt;
  return negative ? `-${body}` : body;
}

/** Shorten an address / object id for display: 0x1234…abcd */
export function shortenAddress(address: string, lead = 6, tail = 4): string {
  if (!address.startsWith('0x')) address = `0x${address}`;
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, 2 + lead)}…${address.slice(-tail)}`;
}

/** Convert basis points to a percentage string, e.g. 100 -> "1%". */
export function bpsToPercent(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/** Render a number in plain (non-exponential) notation. */
function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${n}`);
  if (!/e/i.test(String(n))) return String(n);
  // Expand scientific notation.
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}
