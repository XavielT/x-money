// Local resolution of a draft against the user's own accounts: which account or card a document is
// about, and when it is not clear, the candidates instead of a guess. Pure.
import { AccountModel } from '../../models/account.model';
import { TransactionCurrency } from '../../models/transaction.model';
import { normalizeWord } from './words';

const accepts = (a: AccountModel, currency: TransactionCurrency | undefined): boolean => {
  if (!currency) return true;
  const c = a.currency ?? 'DOP';
  return c === 'dual' || c === currency;
};

export const last4Of = (raw: string | undefined): string | undefined => {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : undefined; // only 4 digits are ever kept
};

export type AccountResolution =
  | { status: 'resolved'; accountId: string; by: 'last4' | 'hint' }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'none' };

const words = (s: string): string[] => s.split(/\s+/).map(normalizeWord).filter((w) => w.length >= 3);

// `hint`: free words from the document or the voice ("tarjeta del Popular"); used only when the last 4
// digits did not settle it. Bank words come from the catalog of the user's own accounts.
export function resolveAccount(accounts: readonly AccountModel[], last4: string | undefined, currency: TransactionCurrency | undefined, hint: string | undefined, bankNameOf: (a: AccountModel) => string): AccountResolution {
  const live = accounts.filter((a) => !a.archived);
  if (last4) {
    const byDigits = live.filter((a) => a.last4 === last4 && accepts(a, currency));
    if (byDigits.length === 1) return { status: 'resolved', accountId: byDigits[0].id, by: 'last4' };
    if (byDigits.length > 1) return { status: 'ambiguous', candidates: byDigits.map((a) => a.id) };
  }
  if (hint) {
    const hw = new Set(words(hint));
    const scored = live
      .filter((a) => accepts(a, currency))
      .map((a) => ({ a, hits: [...new Set([...words(bankNameOf(a)), ...words(a.name)])].filter((w) => hw.has(w)).length }))
      .filter((x) => x.hits > 0);
    if (scored.length) {
      const top = Math.max(...scored.map((x) => x.hits));
      let best = scored.filter((x) => x.hits === top);
      // a tie is broken only by the kind of account the words name ("tarjeta" -> a card, "ahorros" -> savings)
      if (best.length > 1) {
        const kind = hw.has('tarjeta') ? 'card' : hw.has('ahorro') || hw.has('ahorros') ? 'savings' : null;
        const narrowed = kind ? best.filter((x) => x.a.type === kind) : [];
        if (narrowed.length) best = narrowed;
      }
      if (best.length === 1) return { status: 'resolved', accountId: best[0].a.id, by: 'hint' };
      return { status: 'ambiguous', candidates: best.map((x) => x.a.id) };
    }
  }
  return { status: 'none' };
}

// Which of the user's named things (goals, loans, income sources) a spoken or written name points to:
// exactly one match or nothing. Never the "closest" one.
export function resolveByName<T extends { id: string; name: string }>(items: readonly T[], text: string | undefined): T | undefined {
  if (!text) return undefined;
  const tw = new Set(words(text));
  if (!tw.size) return undefined;
  const scored = items.map((i) => ({ i, hits: words(i.name).filter((w) => tw.has(w)).length })).filter((x) => x.hits > 0);
  if (!scored.length) return undefined;
  const top = Math.max(...scored.map((x) => x.hits));
  const best = scored.filter((x) => x.hits === top);
  return best.length === 1 ? best[0].i : undefined;
}
