import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AccountService } from '../../services/account.service';
import { AUDIT_LIMIT, AuditEvent, AuditLogService, AuditType } from '../../services/audit-log.service';
import { CategoryService } from '../../services/category.service';
import { SettingsService } from '../../services/settings.service';
import { TransactionService } from '../../services/transaction.service';
import { ChangeDescription, DescribeContext, describeChange } from '../../domain/describe-change';
import { TranslateService } from '../../services/translate.service';

const LABELS: Record<AuditType, string> = {
  create: 'Created',
  edit: 'Edited',
  reverse: 'Reversed',
  delete: 'Deleted',
  'convert-transfer': 'Converted to transfer',
  'undo-convert': 'Conversion undone',
  'balance-adjustment': 'Balance adjustment',
  reconcile: 'Reconciled',
  import: 'Backup imported',
  migration: 'Data migrated',
  'account-archive': 'Account archived',
  'account-unarchive': 'Account restored',
  'recurring-post': 'Recurring posted',
  'income-pattern': 'Income pattern confirmed',
  'audit-trim': 'Older events trimmed',
  'card-config': 'Card data changed',
  'statement-bank-figures': 'Statement bank figures',
  'statement-interest': 'Card interest registered',
  'card-payment-convert': 'Converted to card payment',
  'income-source': 'Income source changed',
  'income-received': 'Expected income confirmed',
  'income-classify': 'Income classified',
  benefit: 'Benefit changed',
  category: 'Category changed',
  'budget-move': 'Money moved between budgets',
  'budget-move-undo': 'Budget move undone',
  bucket: 'Budget block changed',
  'business-operation': 'Business operation changed',
  'business-sale': 'Business sale',
  'business-withdrawal': 'Profit withdrawn',
  loan: 'Loan changed',
  'loan-payment': 'Loan payment',
  goal: 'Goal changed',
  'goal-entry': 'Goal contribution or withdrawal',
};

// Settings -> Your data -> Change history: read-only list of everything that changed money data, one plain sentence each
// (append-only, capped at 2,000 events). Filter by account and by type.
@Component({
  selector: 'app-change-history',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './change-history.html',
  styleUrl: './change-history.scss',
})
export class ChangeHistoryComponent {
  types = Object.keys(LABELS) as AuditType[];
  accountFilter = signal('');
  typeFilter = signal('');
  shown = signal(50);
  message = signal('');
  limit = AUDIT_LIMIT;

  filtered = computed(() =>
    [...this.audit.events()]
      .reverse()
      .filter((e) => (!this.accountFilter() || e.accountId === this.accountFilter()) && (!this.typeFilter() || e.type === this.typeFilter()))
  );

  visible = computed(() => this.filtered().slice(0, this.shown()));
  trimmed = computed(() => this.audit.events().some((e) => e.type === 'audit-trim'));

  constructor(
    public audit: AuditLogService,
    public accountService: AccountService,
    private transactions: TransactionService,
    private categories: CategoryService,
    private settings: SettingsService,
    private translate: TranslateService
  ) {}

  private ctx: DescribeContext = {
    t: (key, params) => this.translate.instant(key, params),
    accountName: (id) => this.accountName(id),
    categoryName: (id) => (id && this.categories.byId(id)?.name) || '',
    symbol: (currency) => (currency === 'USD' ? 'US$' : this.settings.currency()),
  };

  // The sentence shown for an event (never the raw payload; that stays folded under "Show details")
  describe(e: AuditEvent): ChangeDescription {
    return describeChange(e, this.ctx);
  }

  label(type: AuditType): string {
    return LABELS[type];
  }

  accountName(id: string | undefined): string {
    return (id && this.accountService.byId(id)?.name) || '';
  }

  when(iso: string): string {
    return new Date(iso).toLocaleString(this.translate.locale());
  }

  undo(e: AuditEvent): void {
    const result = this.transactions.undoConversion(e.id);
    this.message.set(this.translate.instant(result.ok ? 'Conversion undone.' : 'The movement changed since, so it cannot be undone.'));
  }
}
