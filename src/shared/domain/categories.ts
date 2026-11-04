// Category nature and the two-level tree. Pure.
// Rule 8: the nature of an expense is a property of its category (or a per-movement override
// chosen by the user). It is never inferred from how often something repeats: an occasional
// expense that happens every week is still variable.
import { CategoryModel, Nature } from '../models/category.model';
import { TransactionModel } from '../models/transaction.model';

// What each built-in category is by default. Anything not listed is variable (the conservative
// choice: variable costs are the ones a person can still move).
export const DEFAULT_NATURE: Readonly<Record<string, Nature>> = {
  'cat-bills': 'fixed',
  'cat-subscriptions': 'fixed',
  'cat-electricity': 'fixed',
  'cat-internet': 'fixed',
  'cat-utilities': 'fixed',
  'cat-rent': 'fixed',
  'cat-obligations': 'fixed',
};

export const natureOfCategory = (c: Pick<CategoryModel, 'id' | 'nature'> | undefined): Nature => c?.nature ?? DEFAULT_NATURE[c?.id ?? ''] ?? 'variable';

type Lookup = (id: string) => CategoryModel | undefined;

// Nature of one movement: its own override, else its subcategory, else its category's.
export function natureOfTransaction(t: Pick<TransactionModel, 'nature' | 'categoryId' | 'subcategoryId'>, byId: Lookup): Nature {
  if (t.nature) return t.nature;
  const sub = t.subcategoryId ? byId(t.subcategoryId) : undefined;
  if (sub?.nature) return sub.nature;
  const cat = t.categoryId ? byId(t.categoryId) : undefined;
  // a subcategory without its own nature follows its parent
  return natureOfCategory(sub && !sub.nature ? byId(sub.parentId ?? '') ?? cat : cat);
}

export type CategoryError = 'name' | 'not-found' | 'parent-missing' | 'parent-is-child' | 'has-children' | 'type-mismatch' | 'self' | 'pattern' | 'system';

export const childrenOf = (categories: readonly CategoryModel[], id: string): CategoryModel[] => categories.filter((c) => c.parentId === id);

// The category and its subcategories (what a budget on the parent covers)
export const treeIds = (categories: readonly CategoryModel[], id: string): string[] => [id, ...childrenOf(categories, id).map((c) => c.id)];

// At most two levels: a parent must exist, be top-level, have the same type, and a category that
// has children cannot become a child.
export function validateParent(categories: readonly CategoryModel[], id: string | undefined, parentId: string | undefined, type: CategoryModel['type']): CategoryError | null {
  if (!parentId) return null;
  if (parentId === id) return 'self';
  const parent = categories.find((c) => c.id === parentId);
  if (!parent) return 'parent-missing';
  if (parent.parentId) return 'parent-is-child';
  if (parent.type !== type) return 'type-mismatch';
  if (id && childrenOf(categories, id).length) return 'has-children';
  return null;
}

export interface IrregularInput {
  amountMin: number;
  amountMax: number;
  timesMin: number;
  timesMax: number;
  per: 'week' | 'month';
}

// min <= max, amounts above zero, times may be zero
export function validPattern(p: IrregularInput | undefined): boolean {
  if (!p) return true;
  const nums = [p.amountMin, p.amountMax, p.timesMin, p.timesMax];
  if (!nums.every((n) => Number.isFinite(n))) return false;
  return p.amountMin > 0 && p.amountMax >= p.amountMin && p.timesMin >= 0 && p.timesMax >= p.timesMin && (p.per === 'week' || p.per === 'month');
}

// Groups for display: top-level categories with their children, the given type only, no system ones
export interface CategoryNode {
  category: CategoryModel;
  children: CategoryModel[];
}

export function categoryTree(categories: readonly CategoryModel[], type: CategoryModel['type']): CategoryNode[] {
  const ofType = categories.filter((c) => c.type === type && !c.system);
  return ofType.filter((c) => !c.parentId || !ofType.some((p) => p.id === c.parentId)).map((category) => ({ category, children: ofType.filter((c) => c.parentId === category.id) }));
}
