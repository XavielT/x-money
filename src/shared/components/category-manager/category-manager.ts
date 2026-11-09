import { Component, ElementRef, computed, signal } from '@angular/core';
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategoryFrequency, CategoryModel, Nature } from '../../models/category.model';
import { TransactionType } from '../../models/transaction.model';
import { CategoryError, categoryTree } from '../../domain/categories';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { CategoryService } from '../../services/category.service';
import { SettingsService } from '../../services/settings.service';
import { TranslateService } from '../../services/translate.service';
import { revealAndFocus } from '../../ui/reveal';

const ERROR_TEXT: Record<CategoryError, string> = {
  name: 'Give the category a name.',
  'not-found': 'Category not found.',
  'parent-missing': 'That parent category does not exist.',
  'parent-is-child': 'A subcategory cannot have subcategories (two levels at most).',
  'has-children': 'A category with subcategories cannot become a subcategory.',
  'type-mismatch': 'A subcategory must have the same type as its parent.',
  self: 'A category cannot be its own parent.',
  pattern: 'The pattern is not valid: amounts above zero, minimum not above maximum.',
  system: 'This category is managed by the app.',
};

// Settings -> Categories: the tree (categories and subcategories), their nature (fixed or
// variable), estimated frequency and, for irregular spending, the usual amount and times. The
// built-in categories are editable too. The nature is chosen here, never guessed from repetition.
@Component({
  selector: 'app-category-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, NgTemplateOutlet, TranslatePipe],
  templateUrl: './category-manager.html',
  styleUrl: './category-manager.scss',
})
export class CategoryManagerComponent {
  type = signal<TransactionType>('expense');
  tree = computed(() => categoryTree(this.categories.categories(), this.type()));
  editingId = signal<string | null>(null);
  message = signal('');

  fName = '';
  fIcon = '';
  fColor = '#ff7043';
  fNature: Nature = 'variable';
  fFrequency: CategoryFrequency | '' = '';
  fIrregular = false;
  fAmountMin: number | null = null;
  fAmountMax: number | null = null;
  fTimesMin: number | null = 0;
  fTimesMax: number | null = null;
  fPer: 'week' | 'month' = 'week';
  fParent = '';
  newSubName = '';
  newSubFor = signal<string | null>(null);

  readonly colors = ['#ff7043', '#ffca28', '#66bb6a', '#26a69a', '#42a5f5', '#7e57c2', '#ec407a', '#8d6e63'];

  constructor(
    public categories: CategoryService,
    public settings: SettingsService,
    private translate: TranslateService,
    private host: ElementRef<HTMLElement>
  ) {}

  isCustom(id: string): boolean {
    return this.categories.isCustom(id);
  }

  natureLabel(c: CategoryModel): string {
    return this.categories.natureOf(c.id) === 'fixed' ? 'Fixed' : 'Variable';
  }

  frequencyLabel(f: CategoryFrequency | undefined): string {
    return f === 'monthly' ? 'Monthly' : f === 'weekly' ? 'Weekly' : f === 'irregular' ? 'Irregular' : '';
  }

  patternText(c: CategoryModel): string {
    const p = c.irregular;
    if (!p) return '';
    const per = this.translate.instant(p.per === 'week' ? 'per week' : 'per month');
    return `${this.settings.currency()}${p.amountMin}–${p.amountMax} · ${p.timesMin}–${p.timesMax} ${per}`;
  }

  edit(c: CategoryModel): void {
    this.message.set('');
    if (this.editingId() === c.id) {
      this.editingId.set(null); // "edit" on the row already open closes it
      return;
    }
    this.editingId.set(c.id);
    this.fName = c.name;
    this.fIcon = c.icon;
    this.fColor = c.color;
    this.fNature = this.categories.natureOf(c.id);
    this.fFrequency = c.frequency ?? '';
    this.fIrregular = !!c.irregular;
    this.fAmountMin = c.irregular?.amountMin ?? null;
    this.fAmountMax = c.irregular?.amountMax ?? null;
    this.fTimesMin = c.irregular?.timesMin ?? 0;
    this.fTimesMax = c.irregular?.timesMax ?? null;
    this.fPer = c.irregular?.per ?? 'week';
    this.fParent = c.parentId ?? '';
    setTimeout(() => revealAndFocus(this.host.nativeElement.querySelector<HTMLElement>('.catman-edit'), 'input[name="fName"]'));
  }

  hasChildren(c: CategoryModel): boolean {
    return this.categories.children(c.id).length > 0;
  }

  // Top-level categories of the same type this one could hang under
  parentOptions(c: CategoryModel): CategoryModel[] {
    return this.categories.categories().filter((p) => p.type === c.type && !p.parentId && !p.system && p.id !== c.id);
  }

  cancel(): void {
    this.editingId.set(null);
  }

  save(): void {
    const id = this.editingId();
    const current = id ? this.categories.byId(id) : undefined;
    if (!id || !current) return;
    const result = this.categories.update(id, {
      name: this.fName,
      icon: this.fIcon.trim() || current.icon,
      color: this.fColor,
      nature: current.type === 'expense' ? this.fNature : undefined,
      frequency: this.fFrequency || undefined,
      irregular: this.fIrregular
        ? { amountMin: Number(this.fAmountMin), amountMax: Number(this.fAmountMax), timesMin: Number(this.fTimesMin ?? 0), timesMax: Number(this.fTimesMax), per: this.fPer }
        : undefined,
      ...(this.isCustom(id) && !this.hasChildren(current) ? { parentId: this.fParent || undefined } : {}),
    });
    if (!result.ok) {
      this.message.set(this.translate.instant(ERROR_TEXT[result.error]));
      return;
    }
    this.editingId.set(null);
  }

  startSub(c: CategoryModel): void {
    this.newSubFor.set(this.newSubFor() === c.id ? null : c.id);
    this.newSubName = '';
  }

  addSub(c: CategoryModel): void {
    const result = this.categories.addSub(c.id, this.newSubName, '');
    this.message.set(result.ok ? '' : this.translate.instant(ERROR_TEXT[result.error]));
    if (result.ok) {
      this.newSubFor.set(null);
      this.newSubName = '';
    }
  }

  remove(c: CategoryModel): void {
    if (!confirm(this.translate.instant('Delete this category? Its transactions will show as "Unknown".'))) return;
    if (!this.categories.remove(c.id)) this.message.set(this.translate.instant('Delete its subcategories first.'));
  }
}
