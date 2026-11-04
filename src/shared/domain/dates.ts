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

// Today in the device's local calendar
export function localIso(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
