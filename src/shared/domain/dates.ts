// ISO yyyy-MM-dd helpers. All arithmetic is calendar based (UTC), never time-of-day,
// so daylight saving and device time zones cannot shift a movement to another day.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const fromIso = (iso: string): number => {
  const m = ISO_RE.exec(iso)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  return toIso(fromIso(iso) + days * 86_400_000);
}

// b - a in whole days (negative when b is earlier)
export function daysBetween(a: string, b: string): number {
  return Math.round((fromIso(b) - fromIso(a)) / 86_400_000);
}

// Feb 29 + 1 year = Feb 28
export function addYears(iso: string, years: number): string {
  const m = ISO_RE.exec(iso)!;
  const y = Number(m[1]) + years;
  const mo = Number(m[2]);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${String(y).padStart(4, '0')}-${m[2]}-${String(Math.min(Number(m[3]), lastDay)).padStart(2, '0')}`;
}

export const lastDayOfMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1-12

// 0 = Sunday ... 6 = Saturday
export const weekdayOf = (iso: string): number => new Date(fromIso(iso)).getUTCDay();

// Month arithmetic that keeps the intended day: Jan 31 + 1 month = Feb 28, + 2 = Mar 31 (with anchorDay 31)
export function addMonthsKeepingDay(iso: string, months: number, anchorDay?: number): string {
  const m = ISO_RE.exec(iso)!;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const y = Math.floor(idx / 12);
  const mo = (idx % 12) + 1;
  const day = Math.min(anchorDay ?? Number(m[3]), lastDayOfMonth(y, mo));
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Today in the device's local calendar
export function localIso(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM' keys: the month `by` months away (negative = earlier)
export function shiftMonthKey(key: string, by: number): string {
  const idx = Number(key.slice(0, 4)) * 12 + (Number(key.slice(5, 7)) - 1) + by;
  return `${String(Math.floor(idx / 12)).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

// The last `n` COMPLETE months before the month of `today`, oldest first
export function lastCompleteMonths(today: string, n: number): string[] {
  const current = today.slice(0, 7);
  return Array.from({ length: n }, (_, i) => shiftMonthKey(current, -(n - i)));
}
