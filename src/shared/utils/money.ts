// Money helpers: every amount is a plain number in major units (pesos, dollars)
// and must be rounded to 2 decimals after every operation, otherwise binary
// floats leave ghost cents (0.1 + 0.2 = 0.30000000000000004).
// RD$ and US$ are never mixed here: callers sum one currency at a time.

// Rounds half away from zero to 2 decimals (the EPSILON nudge makes 1.005 -> 1.01).
// NaN/Infinity are propagated on purpose, never silently turned into 0.
export function round2(value: number): number {
  if (!Number.isFinite(value)) return value;
  const rounded = (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
  return rounded === 0 ? 0 : rounded; // avoid -0
}

export function addMoney(a: number, b: number): number {
  return round2(round2(a) + round2(b));
}

export function subMoney(a: number, b: number): number {
  return round2(round2(a) - round2(b));
}

export function sumMoney(values: readonly number[]): number {
  return values.reduce((sum, value) => addMoney(sum, value), 0);
}

// Equality at cent precision
export function moneyEquals(a: number, b: number): boolean {
  return round2(a) === round2(b);
}

export const sum = sumMoney;
export const subtract = subMoney;

// amount * pct / 100, rounded to cents (percent(1000, 0.2) = 2)
export function percent(amount: number, pct: number): number {
  return round2((round2(amount) * pct) / 100);
}

// Same amount within half a cent
export function equalsMoney(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

// Fixed 2 decimals, thousands separators, minus sign in front; NaN/Infinity become "—"
// instead of leaking "NaN" into the UI
export function formatMoney(value: number, symbol = ''): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = round2(value);
  const [whole, cents] = Math.abs(rounded).toFixed(2).split('.');
  return `${rounded < 0 ? '-' : ''}${symbol}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}
