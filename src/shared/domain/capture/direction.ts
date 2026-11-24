// Which way the money went, and what that says about the type. Pure.
// A bank app tells the direction three ways (a printed sign, an arrow, a colour) and the model only transcribes them
// (`direction`). The TYPE (income, expense, transfer, card payment) is then settled here with rules the user can
// predict, never by a guess: when the evidence disagrees with the type the model chose, the draft is not approvable
// until the user picks (`direction-conflict`); when there was no type, the evidence picks it and the tray says so
// (`kind-inferred`).
import { CaptureKind } from '../../models/capture-draft.model';
import { Direction, parseMovementAmount, signOf } from './amount';
import { RawTransaction } from './schema';

const flat = (s: string | undefined): string => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// the AI writes its descriptions in English ("Payroll deposit credited to the account"), the bank in Spanish
export const PAYROLL_RE = /\b(nomina|salario|sueldo|quincena|payroll|salary)\b/;
const REFUND_RE = /\b(devolucion|reverso|reversado|reembolso|anulacion)\b/;
// money between the user's OWN accounts is a transfer, never income or expense (rule 1)
const OWN_TRANSFER_RE = /\b(?:transferencia|transf|traspaso)\.?\s+(?:propia|entre\s+(?:mis\s+)?cuentas)\b/;
const CARD_PAYMENT_OUT_RE = /\bpago\s+(?:de\s+)?(?:la\s+)?tarj(?:eta)?\b/;
// what a bank takes by itself: DGII 0.15% / 0.20%, commissions, monthly charges
export const BANK_CHARGE_RE = /\b(?:cobro\s+imp|pago\s+impuesto|impuesto\s+0|dgii|comision|cargo\s+mensual|cargo\s+por\s+cobertura|prorrateo\s+cargo)\b/;

export const isBankCharge = (text: string | undefined): boolean => BANK_CHARGE_RE.test(flat(text));
export const isPayroll = (text: string | undefined): boolean => PAYROLL_RE.test(flat(text));

export interface KindDecision {
  kind: CaptureKind;
  direction: Direction | null;
  inferred: boolean; // this device changed or chose the type (the tray says so)
  conflict: boolean; // the evidence contradicts the type: the user must choose
}

// The direction the evidence gives: the printed sign wins over what the model says it saw (an arrow can be misread, a minus cannot)
export function directionOf(raw: Pick<RawTransaction, 'amountText' | 'direction'>): Direction | null {
  const seen = raw.direction === 'in' || raw.direction === 'out' ? raw.direction : null; // whatever else came in is not a direction
  return (raw.amountText ? signOf(raw.amountText) : null) ?? seen;
}

const MOVES: readonly CaptureKind[] = ['expense', 'income', 'unknown'];

export function decideKind(raw: Pick<RawTransaction, 'kind' | 'amountText' | 'direction' | 'counterparty' | 'description'>): KindDecision {
  const direction = directionOf(raw);
  const text = flat([raw.counterparty, raw.description].filter(Boolean).join(' '));
  let kind = raw.kind;
  let inferred = false;

  const set = (k: CaptureKind): void => {
    if (k !== kind) inferred = true;
    kind = k;
  };

  if (MOVES.includes(kind)) {
    if (REFUND_RE.test(text)) {
      set('unknown'); // a refund is the user's call: it is neither plain income nor a new expense
    } else if (OWN_TRANSFER_RE.test(text)) {
      set('internal_transfer');
    } else if (CARD_PAYMENT_OUT_RE.test(text) && direction !== 'in') {
      set('card_payment');
    } else if (isPayroll(text) && direction !== 'out') {
      set('income');
    } else if (kind === 'unknown' && direction === 'in') {
      set('income');
    } else if (kind === 'unknown' && direction === 'out') {
      set('expense');
    }
  }

  // the type and the direction must agree; transfers and card payments can face either way
  const conflict = (kind === 'income' && direction === 'out') || (kind === 'expense' && direction === 'in');
  if (conflict) return { kind: 'unknown', direction, inferred: false, conflict: true };
  return { kind, direction, inferred: inferred && kind !== raw.kind, conflict: false };
}

// ---- a bank's own tax or commission printed as ITS OWN row ("COBRO IMP DGII 0.20%", ref 9243435424047) belongs to the
// movement it was charged on (ref 243435424047): the same reference with one leading digit. It is folded into that
// movement's `bankFeeText`, so the account loses amount + tax with ONE movement (the rule of the 2.20.5 bank tax).
// Only an exact, single parent is used; a row with no parent stays as its own expense.
const digits = (s: string | undefined): string => (s ?? '').replace(/\D/g, '');

export function parentReference(ref: string | undefined): string | null {
  const d = digits(ref);
  return d.length >= 10 && /^[89]/.test(d) ? d.slice(1) : null;
}

export function foldBankCharges(items: readonly RawTransaction[]): RawTransaction[] {
  const folded = new Set<number>();
  const out = items.map((x) => ({ ...x }));
  items.forEach((row, i) => {
    if (!isBankCharge([row.counterparty, row.description].filter(Boolean).join(' ')) || !row.amountText) return;
    const parent = parentReference(row.reference);
    if (!parent) return;
    const parents = items.map((p, j) => ({ p, j })).filter(({ p, j }) => j !== i && digits(p.reference) === parent && !isBankCharge([p.counterparty, p.description].filter(Boolean).join(' ')));
    if (parents.length !== 1) return;
    const { p, j } = parents[0];
    if (p.kind === 'income' || directionOf(p) === 'in') return; // a charge is taken on money that LEAVES
    // the tax (0.20%) and the commission of one payment both hang from its reference: they ADD UP as one fee
    const before = out[j].bankFeeText ? parseMovementAmount(out[j].bankFeeText!) : null;
    const now = parseMovementAmount(row.amountText);
    if (before && before.ok && now.ok) out[j].bankFeeText = ((before.minor + now.minor) / 100).toFixed(2);
    else if (!before) out[j].bankFeeText = row.amountText.replace(/^\s*[-−–+]\s*/, '');
    else return;
    folded.add(i);
  });
  return out.filter((_, i) => !folded.has(i));
}

// "TRANSFERENCIA A ABC..." -> "TRANSFERENCIA A ABC": the app cut the text, the dots are not part of the name
export const trimEllipsis = (s: string | undefined): string | undefined => {
  const t = s?.replace(/\s*(?:\.{2,}|…)+\s*$/u, '').trim();
  return t || undefined;
};
