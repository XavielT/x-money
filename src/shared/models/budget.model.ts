// A monthly limit for ONE category or subcategory (kept as it was; subcategories use the same shape).
export interface BudgetModel {
  id: string;
  categoryId: string; // a category id or a subcategory id
  monthlyLimit: number;
}

// Blocks that group categories to distribute the money (2.10.0). The savings, emergency, business
// capital and debt blocks are fed by hand for now; later modules connect their real use.
export type BucketKind =
  | 'essential'
  | 'food'
  | 'transport'
  | 'entertainment'
  | 'family-home'
  | 'savings'
  | 'emergency'
  | 'business-capital'
  | 'debt-payments'
  | 'free';

export const MANUAL_BUCKETS: readonly BucketKind[] = ['savings', 'emergency', 'business-capital', 'debt-payments'];

export interface BudgetBucketModel {
  id: string; // 'bucket-<kind>'
  kind: BucketKind;
  categoryIds: string[]; // editable mapping; unmapped categories fall into "free"
  mode: 'percent' | 'amount';
  value: number; // % of the base income, or an amount, per month
  manualByMonth?: Record<string, number>; // 'YYYY-MM' -> amount put in by hand (manual blocks)
}

export type MoveRef = { type: 'bucket' | 'category'; id: string };

// Money moved from one block (or category) to another inside ONE month. Audited and undoable.
export interface BudgetMoveModel {
  id: string;
  month: string; // 'YYYY-MM'
  from: MoveRef;
  to: MoveRef;
  amount: number;
  createdAt: string;
  undone?: boolean;
}

export type BaseIncome = 'guaranteed' | 'avg3' | 'actual';

export interface BudgetSettings {
  base: BaseIncome; // which income the percentages apply to (default: average of 3 months)
  riskAt: number; // "risk of exceeding": projected >= this % of the limit (default 90)
}
