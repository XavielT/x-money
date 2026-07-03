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
    if (saved.length) {
      this._categories.set(saved);
    } else {
      this._categories.set(DEFAULT_CATEGORIES_MOCK);
      this.persist();
    }
  }

  byId(id: string): CategoryModel | undefined {
    return this._categories().find((c) => c.id === id);
  }

  ofType(type: TransactionType): CategoryModel[] {
    return this._categories().filter((c) => c.type === type);
  }

  private persist(): void {
    this.storage.set('categories', this._categories());
  }
}
