// Number formatting helpers (tabular, readable, honest about rounding).

/** Whole number with thousands separators. */
export function fmtInt(x: number): string {
  return Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '–';
}

/** Compact count: 1.2k, 3.4M (for axis ticks). */
export function fmtCompact(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e9) return `${(x / 1e9).toPrecision(3)}B`;
  if (a >= 1e6) return `${(x / 1e6).toPrecision(3)}M`;
  if (a >= 1e3) return `${(x / 1e3).toPrecision(3)}k`;
  return String(Math.round(x * 10) / 10);
}

/** Percentage from a fraction (0.42 -> "42%"), with adaptive decimals. */
export function fmtPct(fraction: number): string {
  if (!Number.isFinite(fraction)) return '–';
  const p = fraction * 100;
  return `${p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2)}%`;
}

/** Number with a fixed number of significant digits. */
export function fmtSig(x: number, digits = 3): string {
  return Number.isFinite(x) ? String(Number(x.toPrecision(digits))) : '–';
}

/** Days with one decimal. */
export function fmtDays(x: number | null): string {
  return x === null || !Number.isFinite(x) ? 'n/a' : `${x.toFixed(1)} days`;
}
