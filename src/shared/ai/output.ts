// Output validation (2.16.0). The model writes TEXT WITH MARKERS ({{income_month}}); the figures are
// substituted here from values calculated on the device. Text with a money amount, a percentage,
// a large number or a marker that was not offered is never shown: the screen falls back to its
// deterministic alternative. Pure.

const MARKER_RE = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

export type OutputReason = 'empty' | 'unknown-marker' | 'money' | 'percent' | 'number' | 'unresolved';
export type OutputCheck = { ok: true; text: string } | { ok: false; reason: OutputReason };

export function findMarkers(text: string): string[] {
  return [...text.matchAll(MARKER_RE)].map((m) => m[1]);
}

const CURRENCY = String.raw`(?:RD\s?\$|US\s?\$|USD|DOP|EUR|\$|€|pesos?|d[oó]lares?|dollars?)`;
const MONEY_BEFORE = new RegExp(`${CURRENCY}\\s*\\d`, 'i');
const MONEY_AFTER = new RegExp(`\\d[\\d.,]*\\s*${CURRENCY}(?![a-z])`, 'i');
const SEPARATED = /\d{1,3}(?:[.,]\d{3})+|\d+[.,]\d+/; // 1,500 / 1.500 / 12.5
const PERCENT = /\d\s*%|\d+(?:[.,]\d+)?\s*(?:percent|por\s+ciento)/i;
const LARGE = /(?<![\d])\d{4,}(?![\d])/; // 1000 and more without a separator

// Checks a raw model text against the markers that were offered. Small plain integers ("3 months")
// are fine; anything that looks like money, a percentage or a calculated figure is not.
export function validateOutput(raw: string, allowed: ReadonlySet<string>): OutputCheck {
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (findMarkers(text).some((m) => !allowed.has(m))) return { ok: false, reason: 'unknown-marker' };
  const bare = text.replace(MARKER_RE, ' ');
  if (MONEY_BEFORE.test(bare) || MONEY_AFTER.test(bare)) return { ok: false, reason: 'money' };
  if (PERCENT.test(bare)) return { ok: false, reason: 'percent' };
  if (SEPARATED.test(bare) || LARGE.test(bare)) return { ok: false, reason: 'number' };
  return { ok: true, text };
}

// Puts the local values where the markers are. A marker with no value is an error, never a blank.
export function substituteMarkers(text: string, values: Readonly<Record<string, string>>): string | null {
  let missing = false;
  const out = text.replace(MARKER_RE, (_m, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      missing = true;
      return '';
    }
    return values[key];
  });
  return missing ? null : out;
}

// Validates and substitutes: the only text that may reach the screen
export function finalizeText(raw: string, values: Readonly<Record<string, string>>): OutputCheck {
  const checked = validateOutput(raw, new Set(Object.keys(values)));
  if (!checked.ok) return checked;
  const text = substituteMarkers(checked.text, values);
  return text === null ? { ok: false, reason: 'unresolved' } : { ok: true, text };
}
