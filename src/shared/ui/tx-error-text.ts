import { TxErrorCode } from '../domain/validation';

// What each rejection of a movement says (bilingual through TranslateService)
export const TX_ERROR_TEXT: Record<TxErrorCode, string> = {
  amount: 'Enter an amount greater than zero.',
  fee: 'The fee cannot be negative.',
  date: 'Enter a valid date.',
  'date-far-future': 'This date is more than a year ahead.',
  account: 'Choose an existing account.',
  'account-archived': 'That account is archived. Choose another one or restore it first.',
  currency: 'This account does not accept that currency.',
  'to-account': 'Choose the destination account.',
  'same-account': 'Origin and destination must be different accounts (a debit card and its bank account are the same money).',
  'cross-currency': 'Transfers between RD$ and US$ accounts are not supported yet: they need both amounts.',
  'partial-exceeds': 'The parts exceed the declared total.',
  reconciled: 'This movement is reconciled with your bank statement.',
  linked: 'This movement is linked to others. Reverse it instead of deleting it.',
  reversed: 'Reversed movements cannot be changed.',
  'already-reversed': 'This movement was already reversed.',
  'not-found': 'Movement not found.',
  'not-a-pair': 'These movements cannot be converted.',
  changed: 'The movement changed since, so it cannot be undone.',
  'read-only': 'Update X Money to save changes.',
};
