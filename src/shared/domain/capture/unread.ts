// Amounts that are IN a text the user sent but in NO draft that came back. A reader (the AI or the offline one) can skip a
// row of a long list without saying so; this finds it so the user is told instead of trusting a list that is short. Pure.
// Only what is plainly money counts: an amount with two decimals, at least 1.00, that is not a balance, a date, a phone, a
// reference or a percentage. It never adds anything: it only points at what was not read.
import { CaptureDraft } from '../../models/capture-draft.model';
import { minorFromNumberToken } from './amount';
import { withoutNonMoney } from './local';

const MONEY = /\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?!\d)|\d+[.,]\d{2}(?!\d)/g;
const BALANCE_WORDS = /(balance|saldo|disponible|limite|total)/;

type Carrier = Pick<CaptureDraft, 'amountMinor' | 'bankFeeMinor' | 'taxAmountMinor' | 'subtotalMinor' | 'balanceMinor' | 'creditLimitMinor' | 'lines'>;

export function amountsIn(text: string): number[] {
  const flat = withoutNonMoney(text);
  const found: number[] = [];
  for (const m of flat.matchAll(MONEY)) {
    const before = flat.slice(Math.max(0, (m.index ?? 0) - 24), m.index ?? 0);
    if (BALANCE_WORDS.test(before)) continue;
    const minor = minorFromNumberToken(m[0]);
    if (minor !== null && minor >= 100 && !found.includes(minor)) found.push(minor);
  }
  return found;
}

export function unreadAmounts(text: string, drafts: readonly Carrier[]): number[] {
  const read = new Set<number>();
  for (const d of drafts) {
    for (const v of [d.amountMinor, d.bankFeeMinor, d.taxAmountMinor, d.subtotalMinor, d.balanceMinor, d.creditLimitMinor]) if (v) read.add(v);
    for (const l of d.lines ?? []) if (l.amountMinor) read.add(l.amountMinor);
  }
  return amountsIn(text).filter((m) => !read.has(m));
}
