import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TransactionType } from '../../../shared/models/transaction.model';
import { TransactionService } from '../../../shared/services/transaction.service';
import { CategoryService } from '../../../shared/services/category.service';
import { AccountService } from '../../../shared/services/account.service';
import { SettingsService } from '../../../shared/services/settings.service';

@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './transaction-form.html',
  styleUrl: './transaction-form.scss',
})
export class TransactionFormComponent {
  editId: string | null = null;

  type = signal<TransactionType>('expense');
  categoryId = signal<string>('');
  amount: number | null = null;
  accountId = '';
  date = '';
  note = '';

  categoriesForType = computed(() => this.categoryService.ofType(this.type()));

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private transactionService: TransactionService,
    public categoryService: CategoryService,
    public accountService: AccountService,
    public settings: SettingsService
  ) {
    this.date = this.todayIso();
    this.accountId = this.accountService.accounts()[0]?.id ?? '';

    this.editId = this.route.snapshot.paramMap.get('id');
    if (this.editId) {
      const existing = this.transactionService.byId(this.editId);
      if (existing) {
        this.type.set(existing.type);
        this.categoryId.set(existing.categoryId);
        this.amount = existing.amount;
        this.accountId = existing.accountId;
        this.date = existing.date;
        this.note = existing.note ?? '';
      } else {
        this.editId = null;
      }
    }
  }

  setType(type: TransactionType): void {
    if (this.type() === type) return;
    this.type.set(type);
    this.categoryId.set(''); // categories differ per type
  }

  selectCategory(id: string): void {
    this.categoryId.set(id);
  }

  isValid(): boolean {
    return (
      this.amount != null &&
      this.amount > 0 &&
      !!this.categoryId() &&
      !!this.accountId &&
      !!this.date
    );
  }

  save(): void {
    if (!this.isValid()) return;
    const data = {
      type: this.type(),
      amount: Number(this.amount),
      categoryId: this.categoryId(),
      accountId: this.accountId,
      date: this.date,
      note: this.note.trim() || undefined,
    };
    if (this.editId) {
      this.transactionService.update({ ...data, id: this.editId });
    } else {
      this.transactionService.add(data);
    }
    this.router.navigate(['/transactions']);
  }

  delete(): void {
    if (!this.editId) return;
    if (!confirm('Delete this transaction?')) return;
    this.transactionService.remove(this.editId);
    this.router.navigate(['/transactions']);
  }

  cancel(): void {
    history.back();
  }

  private todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  }
}
