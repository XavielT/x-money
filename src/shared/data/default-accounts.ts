import { AccountModel } from '../models/account.model';

export const DEFAULT_ACCOUNTS_MOCK: AccountModel[] = [
  { id: 'acc-cash', name: 'Cash', icon: '💵', initialBalance: 0 },
  { id: 'acc-card', name: 'Card', icon: '💳', initialBalance: 0 },
];
