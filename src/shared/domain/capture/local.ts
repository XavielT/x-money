// Reading a spoken or pasted sentence WITHOUT any AI: the alternative for when the capture switch is
// off, there is no connection or a limit was reached. It only finds what is certain (the amount, the
// kind by its verb, the accounts by their words); everything else is left empty for the user to fill.
// Pure.
import { CaptureKind } from '../../models/capture-draft.model';
import { RawTransaction } from './schema';
import { amountsInText, normalizeWord } from './words';

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const KIND_RULES: readonly [RegExp, CaptureKind][] = [
  [/\b(pague|pago|pagamos|abone)\b.*\btarjeta\b|\bpago de (la )?tarjeta\b|\bpago a (la )?tarjeta\b/, 'card_payment'],
  [/\b(cuota|prestamo)\b/, 'loan_payment'],
  [/\b(aporte|aporto|aporté|abone a la meta|meta)\b/, 'goal_contribution'],
  [/\b(transferi|transferencia|mande|movi|pase)\b.*\b(a|hacia)\b/, 'internal_transfer'],
  [/\b(me depositaron|me depositaron|deposito|depositaron|me pagaron|cobre|cobré|recibi|me llego|me entro|nomina|quincena|ingreso|me transfirieron)\b/, 'income'],
  [/\b(gaste|gasto|pague|compre|compra|consumo|pagamos|se me fue)\b/, 'expense'],
];

export function kindOfText(text: string): CaptureKind {
  const s = norm(text);
  for (const [re, kind] of KIND_RULES) if (re.test(s)) return kind;
  return 'unknown';
}

function minorToText(minor: number): string {
  const major = Math.floor(minor / 100);
  const cents = minor % 100;
  return `${major}.${String(cents).padStart(2, '0')}`;
}

// "gasté 500 en gasolina y 300 en el colmado" -> two pieces, each with its own amount
export function splitSentences(text: string): string[] {
  const parts = text
    .split(/\s+y\s+(?=(?:gaste|pague|compre|aporte|transferi|me\s|\d))|[;\n]+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const withAmount = parts.filter((p) => amountsInText(p).length > 0);
  return withAmount.length > 1 ? parts.filter((p) => amountsInText(p).length > 0) : [text.trim()];
}

// "de mi cuenta de ahorros a la corriente" -> ['ahorros', 'corriente']
function transferEnds(s: string): { from?: string; to?: string } {
  const m = /\bde\s+(?:mi\s+|la\s+)?(?:cuenta\s+(?:de\s+)?)?([a-z0-9 ]+?)\s+(?:a|hacia|para)\s+(?:mi\s+|la\s+)?(?:cuenta\s+(?:de\s+)?)?([a-z0-9 ]+?)\s*$/.exec(s);
  return m ? { from: m[1].trim(), to: m[2].trim() } : {};
}

function targetOf(s: string, kind: CaptureKind): string | undefined {
  if (kind === 'goal_contribution') {
    const m = /\bmeta\s+(?:de(?:l)?\s+|para\s+(?:el\s+|la\s+)?)?([a-z0-9 ]+?)\s*$/.exec(s);
    return m?.[1];
  }
  if (kind === 'loan_payment') {
    const m = /\b(?:prestamo|credito)\s+(?:de(?:l)?\s+|para\s+)?([a-z0-9 ]*)$/.exec(s);
    return m?.[1] || 'prestamo';
  }
  return undefined;
}

function counterpartyOf(s: string, kind: CaptureKind): string | undefined {
  if (kind !== 'expense') return undefined;
  const m = /\ben\s+(?:el\s+|la\s+|los\s+|las\s+)?([a-z0-9 ]+?)(?:\s+con\s+|\s+usando\s+|$)/.exec(s);
  return m?.[1]?.trim() || undefined;
}

export function readSentence(sentence: string): RawTransaction {
  const s = norm(sentence);
  const kind = kindOfText(sentence);
  const amounts = amountsInText(sentence);
  const item: RawTransaction = { kind, confidence: { amount: 0.5, kind: 0.4 } };
  if (amounts.length) item.amountText = minorToText(amounts[0]);
  if (/\b(us\$|usd|dolar|dolares)\b/.test(s)) item.currencyHint = 'USD';
  else if (/\b(rd\$|pesos?|dop)\b/.test(s)) item.currencyHint = 'DOP';
  const ends = kind === 'internal_transfer' ? transferEnds(s) : {};
  if (ends.from) item.accountHint = ends.from;
  if (ends.to) item.toAccountHint = ends.to;
  if (!ends.from) {
    const cardHint = /\b(?:tarjeta|cuenta|banco)\s+(?:de(?:l)?\s+)?([a-z0-9 ]+?)(?:\s+(?:y|en|de|con|por)\b|$)/.exec(s);
    item.accountHint = cardHint ? cardHint[0] : s;
  }
  const cp = counterpartyOf(s, kind);
  if (cp) item.counterparty = cp;
  const target = targetOf(s, kind);
  if (target) item.targetName = target;
  item.description = sentence.trim().slice(0, 160);
  item.notes = 'Read on this device, without AI: check every field.';
  return item;
}

// Words that carry no meaning for matching accounts (they appear in every sentence)
export const STOP_HINT_WORDS: ReadonlySet<string> = new Set(['con', 'del', 'los', 'las', 'mis', 'por', 'para', 'una', 'que'].map(normalizeWord));

export function readTextLocally(text: string): RawTransaction[] {
  return splitSentences(text).map(readSentence);
}
