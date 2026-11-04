import { Injectable, computed, signal } from '@angular/core';
import { CategoryModel, Nature } from '../models/category.model';
import { TransactionType } from '../models/transaction.model';
import { DEFAULT_CATEGORIES_MOCK } from '../data/default-categories';
import { CategoryError, categoryTree, childrenOf, natureOfCategory, validPattern, validateParent } from '../domain/categories';
import { AuditLogService } from './audit-log.service';
import { StorageService } from './storage.service';

export type CategoryPatch = Partial<Pick<CategoryModel, 'name' | 'icon' | 'color' | 'nature' | 'frequency' | 'irregular' | 'parentId'>>;
export type CategoryResult = { ok: true; id: string } | { ok: false; error: CategoryError };

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private _categories = signal<CategoryModel[]>([]);
  categories = this._categories.asReadonly();

  // Pickers show top-level categories; subcategories are chosen under their parent
  expenseCategories = computed(() => this._categories().filter((c) => c.type === 'expense' && !c.system && !c.parentId));
  incomeCategories = computed(() => this._categories().filter((c) => c.type === 'income' && !c.system && !c.parentId));
  expenseTree = computed(() => categoryTree(this._categories(), 'expense'));

  constructor(
    private storage: StorageService,
    private audit: AuditLogService
  ) {
    const saved = this.storage.get<CategoryModel[]>('categories', []);
    // Merge in any default category the user doesn't have yet, so existing
    // installs pick up new defaults after an app update
    const missing = DEFAULT_CATEGORIES_MOCK.filter((d) => !saved.some((c) => c.id === d.id));
    this._categories.set([...saved, ...missing]);
    if (!saved.length || missing.length) this.persist();
    this.storage.watch('categories', (v) => this._categories.set((v as CategoryModel[] | undefined) ?? []));
  }

  byId(id: string): CategoryModel | undefined {
    return this._categories().find((c) => c.id === id);
  }

  // Top-level categories of a type (what the pickers list)
  ofType(type: TransactionType): CategoryModel[] {
    return this._categories().filter((c) => c.type === type && !c.system && !c.parentId);
  }

  children(id: string): CategoryModel[] {
    return childrenOf(this._categories(), id);
  }

  parentOf(id: string): CategoryModel | undefined {
    const parentId = this.byId(id)?.parentId;
    return parentId ? this.byId(parentId) : undefined;
  }

  natureOf(id: string | undefined): Nature {
    return natureOfCategory(id ? this.byId(id) : undefined);
  }

  isCustom(id: string): boolean {
    return id.startsWith('custom-');
  }

  add(name: string, icon: string, color: string, type: TransactionType, parentId?: string): CategoryModel {
    const category: CategoryModel = {
      id: `custom-${crypto.randomUUID()}`,
      name,
      icon,
      color,
      type,
      nature: type === 'expense' ? 'variable' : undefined, // the conservative default
      parentId: parentId && validateParent(this._categories(), undefined, parentId, type) === null ? parentId : undefined,
    };
    this._categories.update((list) => [...list, category]);
    this.persist();
    return category;
  }

  // A subcategory of a top-level category: it shares its type and, until changed, its nature
  addSub(parentId: string, name: string, icon: string): CategoryResult {
    const parent = this.byId(parentId);
    if (!parent) return { ok: false, error: 'parent-missing' };
    const error = validateParent(this._categories(), undefined, parentId, parent.type);
    if (error) return { ok: false, error };
    if (!name.trim()) return { ok: false, error: 'name' };
    const sub = this.add(name.trim(), icon || parent.icon, parent.color, parent.type, parentId);
    return { ok: true, id: sub.id };
  }

  // Built-in and custom categories are both editable: name, icon, color, nature, frequency, pattern
  update(id: string, patch: CategoryPatch): CategoryResult {
    const existing = this.byId(id);
    if (!existing) return { ok: false, error: 'not-found' };
    if (existing.system) return { ok: false, error: 'system' };
    if (patch.name !== undefined && !patch.name.trim()) return { ok: false, error: 'name' };
    if ('irregular' in patch && !validPattern(patch.irregular)) return { ok: false, error: 'pattern' };
    if ('parentId' in patch) {
      const error = validateParent(this._categories(), id, patch.parentId, existing.type);
      if (error) return { ok: false, error };
    }
    const next: CategoryModel = { ...existing, ...patch, name: (patch.name ?? existing.name).trim() };
    for (const key of Object.keys(patch) as (keyof CategoryPatch)[]) if (patch[key] === undefined) delete next[key];
    this._categories.update((list) => list.map((c) => (c.id === id ? next : c)));
    this.persist();
    const changed = Object.keys(patch);
    this.audit.log({ type: 'category', entity: 'category', entityId: id, before: { name: existing.name, nature: existing.nature }, after: { name: next.name, nature: next.nature, changed } });
    return { ok: true, id };
  }

  // Only user-created categories can be removed, and not while they have subcategories; transactions
  // that pointed to a removed category keep working and show as "Unknown"
  remove(id: string): boolean {
    if (!this.isCustom(id) || this.children(id).length) return false;
    this._categories.update((list) => list.filter((c) => c.id !== id));
    this.persist();
    return true;
  }

  private persist(): void {
    this.storage.set('categories', this._categories());
  }
}
