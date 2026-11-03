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
