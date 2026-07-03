import { AccountModel } from '../models/account.model';

export const DEFAULT_ACCOUNTS_MOCK: AccountModel[] = [
  { id: 'acc-cash', name: 'Cash', icon: '💵', type: 'cash', initialBalance: 0 },
  { id: 'acc-card', name: 'Card', icon: '💳', type: 'card', initialBalance: 0 },
];
