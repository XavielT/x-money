// What changing an account's opening balance does to its current balance. The balance is never stored (integrity rule 9):
// it is the opening balance plus the movements, so moving the opening balance moves the whole history by the same amount.
// Only the currency the account STARTS in is affected (a dual card starts in RD$; its US$ side has no opening balance).
import { addMoney, round2 } from '../utils/money';

export interface OpeningChange {
  changed: boolean;
  before: number;
  after: number;
}

// `current` is the balance now, in the account's opening currency; the result keeps its sign (a card with debt is negative).
export function balanceAfterOpeningChange(current: number, oldOpening: number, newOpening: number): OpeningChange {
  const before = round2(current);
  const oldO = round2(oldOpening);
  const newO = round2(newOpening);
  if (oldO === newO) return { changed: false, before, after: before };
  return { changed: true, before, after: addMoney(before, addMoney(newO, -oldO)) };
}
