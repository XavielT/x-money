import { Injectable, computed, signal } from '@angular/core';
import { CategoryModel } from '../models/category.model';
import { TransactionType } from '../models/transaction.model';
import { DEFAULT_CATEGORIES_MOCK } from '../data/default-categories';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private _categories = signal<CategoryModel[]>([]);
  categories = this._categories.asReadonly();

  expenseCategories = computed(() => this._categories().filter((c) => c.type === 'expense'));
  incomeCategories = computed(() => this._categories().filter((c) => c.type === 'income'));

  constructor(private storage: StorageService) {
    const saved = this.storage.get<CategoryModel[]>('categories', []);
    // Merge in any default category the user doesn't have yet, so existing
    // installs pick up new defaults after an app update
    const missing = DEFAULT_CATEGORIES_MOCK.filter((d) => !saved.some((c) => c.id === d.id));
    this._categories.set([...saved, ...missing]);
    if (!saved.length || missing.length) this.persist();
  }

  byId(id: string): CategoryModel | undefined {
    return this._categories().find((c) => c.id === id);
  }

  ofType(type: TransactionType): CategoryModel[] {
    return this._categories().filter((c) => c.type === type);
  }

  isCustom(id: string): boolean {
    return id.startsWith('custom-');
  }

  add(name: string, icon: string, color: string, type: TransactionType): CategoryModel {
    const category: CategoryModel = {
      id: `custom-${crypto.randomUUID()}`,
      name,
      icon,
      color,
      type,
    };
    this._categories.update((list) => [...list, category]);
    this.persist();
    return category;
  }

  // Only user-created categories can be removed; transactions that pointed to
  // a removed category keep working and show as "Unknown"
  remove(id: string): void {
    if (!this.isCustom(id)) return;
    this._categories.update((list) => list.filter((c) => c.id !== id));
    this.persist();
  }

  private persist(): void {
    this.storage.set('categories', this._categories());
  }
}
