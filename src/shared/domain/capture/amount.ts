// Amounts read from a document, a voice transcript or an email. Pure. The model hands over the text
// EXACTLY as it saw it; this file turns it into whole minor units (cents) without ever going through
// a float, so 1,250.50 is 125050 and nothing else. RD$ and US$ are never converted into each other.
import { TransactionCurrency } from '../../models/transaction.model';

export type AmountRejection = 'empty' | 'zero' | 'negative' | 'invalid';

export type ParsedAmount =
  | { ok: true; minor: number; currency: TransactionCurrency | null; needsConfirm: boolean }
  | { ok: false; reason: AmountRejection };

// Above this (in major units) the user must confirm explicitly: a misread digit is the likeliest cause
export const DEFAULT_LARGE_AMOUNT = 50_000_000;

const USD_RE = /(?:\bus\s*\$|\bu\s*\$\s*s\b|\busd\b|\bd[oó]lar(?:es)?\b|\bus\$)/i;
const DOP_RE = /(?:\brd\s*\$|\bdop\b|\bpesos?\b|\brd\b)/i;

// Currency named in the text itself; a bare "$" names none
export function currencyOf(text: string): TransactionCurrency | null {
  const usd = USD_RE.test(text);
  const dop = DOP_RE.test(text);
  if (usd && !dop) return 'USD';
  if (dop && !usd) return 'DOP';
  return null;
}

const NUMBER_TOKEN = /\d[\d.,   ]*\d|\d/g;

// "1,250.50", "1.250,50", "1250", "1 250,5" -> minor units. Null when the shape is not an amount.
export function minorFromNumberToken(raw: string): number | null {
  const token = raw.replace(/[   ]/g, '');
  if (!/^\d[\d.,]*$/.test(token)) return null;
  const dots = (token.match(/\./g) ?? []).length;
  const commas = (token.match(/,/g) ?? []).length;
  let integer: string;
  let decimals = '';
  if (dots && commas) {
    const sep = token.lastIndexOf('.') > token.lastIndexOf(',') ? '.' : ',';
    const other = sep === '.' ? ',' : '.';
    const at = token.lastIndexOf(sep);
    if (token.split(sep).length > 2) return null; // two decimal marks
    integer = token.slice(0, at).split(other).join('');
    decimals = token.slice(at + 1);
    if (token.slice(0, at).split(other).slice(1).some((g) => g.length !== 3)) return null; // groups of 3 only
  } else if (dots + commas === 0) {
    integer = token;
  } else {
    const sep = dots ? '.' : ',';
    const parts = token.split(sep);
    const last = parts[parts.length - 1];
    if (parts.length === 2 && last.length !== 3) {
      integer = parts[0];
      decimals = last; // 1250.50 / 1250,5
    } else if (parts.slice(1).every((g) => g.length === 3)) {
      integer = parts.join(''); // 1,250 / 1.250.000
    } else {
      return null;
    }
  }
  if (decimals.length > 2 || !/^\d*$/.test(decimals) || !integer) return null;
  if (integer.length > 12) return null;
  const cents = Number(decimals.padEnd(2, '0') || '0');
  return Number(integer) * 100 + cents;
}

export interface ParseAmountOptions {
  largeAbove?: number; // major units
}

// `hint`: the currency the caller already knows (the model's guess or the account's), used only when
// the text does not name one. A text that names one always wins over the hint.
export function parseAmount(text: string, hint?: TransactionCurrency | null, options: ParseAmountOptions = {}): ParsedAmount {
  const source = (text ?? '').trim();
  if (!source) return { ok: false, reason: 'empty' };
  const matches = source.match(NUMBER_TOKEN);
  if (!matches) return { ok: false, reason: 'invalid' };
  // the amount is the first number that is not glued to letters (a reference like "REF1234AB" is not one)
  const idx = source.search(NUMBER_TOKEN);
  const before = source.slice(0, idx);
  // a minus (or parentheses) right before the amount, with at most a currency in between; "REF-1234" is not one
  if (/(^|[\s(:])[-−–]\s*(?:[A-Za-z]{0,3}\$?\s*)?$|^\s*\(/.test(before)) return { ok: false, reason: 'negative' };
  const minor = minorFromNumberToken(matches[0]);
  if (minor === null) return { ok: false, reason: 'invalid' };
  if (minor === 0) return { ok: false, reason: 'zero' };
  const limit = options.largeAbove ?? DEFAULT_LARGE_AMOUNT;
  return { ok: true, minor, currency: currencyOf(source) ?? hint ?? null, needsConfirm: minor / 100 > limit };
}

// ---- an amount printed on a MOVEMENT row of a bank app: the sign is information, not an error.
// "- DOP 540.00", "-RD$500.00", "RD$ -500.00" and "(500.00)" leave the account; "+ DOP 1,000.00" enters it; "RD$14,113.50"
// carries no sign (some apps print none on incoming money), so the direction stays open and the arrow or the wording decides.
export type Direction = 'in' | 'out';

export type MovementAmount =
  | { ok: true; minor: number; currency: TransactionCurrency | null; needsConfirm: boolean; direction: Direction | null }
  | { ok: false; reason: AmountRejection | 'reference' };

const MINUS_BEFORE = /(^|[\s(:])[-−–]\s*(?:[A-Za-z]{0,3}\$?\s*)?$|(?:\$|\b(?:dop|rd|usd|us))\s*[-−–]\s*$/i;
const PLUS_BEFORE = /(^|[\s(:])\+\s*(?:[A-Za-z]{0,3}\$?\s*)?$|(?:\$|\b(?:dop|rd|usd|us))\s*\+\s*$/i;

// The direction a printed amount states by itself (a sign or parentheses), or null when it states none
export function signOf(text: string): Direction | null {
  const source = (text ?? '').trim();
  const idx = source.search(NUMBER_TOKEN);
  if (idx < 0) return null;
  const before = source.slice(0, idx);
  if (MINUS_BEFORE.test(before) || /^\s*\(/.test(before)) return 'out';
  if (PLUS_BEFORE.test(before)) return 'in';
  return null;
}

// Like parseAmount, but a sign is read as the direction instead of being refused, so an expense printed as "- DOP 540.00"
// keeps its amount. A long bare run of digits (a bank reference such as 243345091375) is never an amount.
export function parseMovementAmount(text: string, hint?: TransactionCurrency | null, options: ParseAmountOptions = {}): MovementAmount {
  const source = (text ?? '').trim();
  if (!source) return { ok: false, reason: 'empty' };
  const matches = source.match(NUMBER_TOKEN);
  if (!matches) return { ok: false, reason: 'invalid' };
  if (/^\d{9,}$/.test(matches[0])) return { ok: false, reason: 'reference' };
  const minor = minorFromNumberToken(matches[0]);
  if (minor === null) return { ok: false, reason: 'invalid' };
  if (minor === 0) return { ok: false, reason: 'zero' };
  const limit = options.largeAbove ?? DEFAULT_LARGE_AMOUNT;
  return { ok: true, minor, currency: currencyOf(source) ?? hint ?? null, needsConfirm: minor / 100 > limit, direction: signOf(source) };
}

// Whole minor units to major units, exact (minor is an integer)
export const majorOf = (minor: number): number => Math.round(minor) / 100;

// Major units to minor units, for amounts the user types
export const minorOf = (major: number): number => Math.round((major + Number.EPSILON) * 100);
