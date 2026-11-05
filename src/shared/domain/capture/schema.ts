// The shape the model must answer with, checked AGAIN on the device (the server checked it first).
// Everything the model says is untrusted text: lengths are cut, control characters are removed, only
// known keys survive, and no number comes back as a number: amounts arrive as the text on the document
// and are converted by the code (amount.ts).
import { ACCOUNT_SETUP_TYPES, AccountSetupType, CAPTURE_KINDS, CaptureKind } from '../../models/capture-draft.model';

export interface RawLine {
  description: string;
  quantity?: number;
  amountText?: string;
}

export interface RawTransaction {
  kind: CaptureKind;
  amountText?: string;
  currencyHint?: 'DOP' | 'USD';
  dateText?: string;
  counterparty?: string;
  description?: string;
  bankName?: string;
  accountLast4?: string;
  accountHint?: string; // words for the main account ("ahorros", "Popular"), as heard or read
  toAccountLast4?: string;
  toAccountHint?: string; // the other account: destination of a transfer, the card of a card payment
  targetName?: string; // goal or loan named in the sentence
  categoryCandidate?: string;
  accountType?: AccountSetupType; // account_setup: what kind of product the screenshot shows
  accountName?: string;
  balanceText?: string; // the current balance as printed (for a credit card: what is owed)
  creditLimitText?: string;
  reference?: string;
  invoiceNumber?: string;
  taxId?: string;
  fiscalNumber?: string;
  taxAmountText?: string;
  bankFeeText?: string; // transfer or card payment receipts: the tax or commission the bank charged, as printed
  subtotalText?: string;
  lines?: RawLine[];
  confidence: Record<string, number>;
  notes?: string;
}

export interface RawCapture {
  items: RawTransaction[];
  notes?: string;
}

export const MAX_ITEMS = 20;
export const MAX_RAW_LINES = 30;

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || undefined;
};

const STRING_FIELDS: readonly [keyof RawTransaction, number][] = [
  ['amountText', 40], ['dateText', 60], ['counterparty', 80], ['description', 160], ['bankName', 40], ['accountHint', 60], ['toAccountHint', 60],
  ['targetName', 60], ['categoryCandidate', 40], ['accountName', 60], ['balanceText', 40], ['creditLimitText', 40], ['reference', 40], ['invoiceNumber', 40], ['taxId', 20], ['fiscalNumber', 20], ['taxAmountText', 40], ['bankFeeText', 40], ['subtotalText', 40], ['notes', 240],
];

function digits4(v: unknown): string | undefined {
  const d = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D/g, '') : '';
  return d.length >= 4 ? d.slice(-4) : undefined;
}

function item(raw: unknown): RawTransaction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind = CAPTURE_KINDS.includes(r['kind'] as CaptureKind) ? (r['kind'] as CaptureKind) : 'unknown';
  const out: RawTransaction = { kind, confidence: {} };
  for (const [k, max] of STRING_FIELDS) {
    const s = clean(r[k], max);
    if (s) (out as unknown as Record<string, unknown>)[k] = s;
  }
  if (r['currencyHint'] === 'DOP' || r['currencyHint'] === 'USD') out.currencyHint = r['currencyHint'];
  if (ACCOUNT_SETUP_TYPES.includes(r['accountType'] as AccountSetupType)) out.accountType = r['accountType'] as AccountSetupType;
  const l4 = digits4(r['accountLast4']);
  if (l4) out.accountLast4 = l4;
  const t4 = digits4(r['toAccountLast4']);
  if (t4) out.toAccountLast4 = t4;
  if (Array.isArray(r['lines'])) {
    out.lines = r['lines']
      .slice(0, MAX_RAW_LINES)
      .map((l): RawLine | null => {
        if (!l || typeof l !== 'object') return null;
        const description = clean((l as Record<string, unknown>)['description'], 120);
        if (!description) return null;
        const q = (l as Record<string, unknown>)['quantity'];
        const line: RawLine = { description };
        if (typeof q === 'number' && Number.isFinite(q) && q > 0 && q < 100000) line.quantity = q;
        const a = clean((l as Record<string, unknown>)['amountText'], 40);
        if (a) line.amountText = a;
        return line;
      })
      .filter((l): l is RawLine => !!l);
  }
  const conf = r['confidence'];
  if (conf && typeof conf === 'object' && !Array.isArray(conf)) {
    for (const [k, v] of Object.entries(conf as Record<string, unknown>).slice(0, 30)) {
      if (/^[a-zA-Z]{1,30}$/.test(k) && typeof v === 'number' && Number.isFinite(v)) out.confidence[k] = Math.min(1, Math.max(0, v));
    }
  }
  return out;
}

// Reads the answer of the model. Anything that is not the agreed shape is a failed capture, never
// a partial guess: the caller shows a clear message and the manual form.
export function parseCaptureOutput(text: string): { ok: true; value: RawCapture } | { ok: false } {
  let data: unknown;
  const body = (text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false };
  const list = (data as Record<string, unknown>)['transactions'];
  if (!Array.isArray(list) || list.length > MAX_ITEMS) return { ok: false };
  const items = list.map(item).filter((i): i is RawTransaction => !!i);
  if (items.length !== list.length) return { ok: false };
  return { ok: true, value: { items, notes: clean((data as Record<string, unknown>)['notes'], 300) } };
}
