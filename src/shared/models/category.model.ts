import { TransactionType } from './transaction.model';

// Fixed = the same obligation every period (rent, internet, subscriptions). Variable = it moves
// with your choices. The nature belongs to the category (and a movement can override it); it is
// NEVER inferred from repetition: an occasional expense that repeats stays variable (rule 8).
export type Nature = 'fixed' | 'variable';

export type CategoryFrequency = 'monthly' | 'weekly' | 'irregular';

// A pattern for spending that happens a variable number of times: e.g. work lunches,
// RD$250-400 per occasion, 0 to 4 times a week. Times may be zero.
export interface IrregularPattern {
  amountMin: number;
  amountMax: number;
  timesMin: number;
  timesMax: number;
  per: 'week' | 'month';
}

export interface CategoryModel {
  id: string;
  name: string;
  icon: string; // emoji
  color: string;
  type: TransactionType;
  system?: boolean; // app-managed (e.g. reconciliation adjustment): hidden from pickers
  nature?: Nature; // expense categories; absent = the default of its id, else variable (schema v3 sets it)
  parentId?: string; // subcategory: at most two levels, the parent has no parent
  frequency?: CategoryFrequency; // estimated, informational
  irregular?: IrregularPattern;
}
