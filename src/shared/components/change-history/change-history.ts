import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AccountService } from '../../services/account.service';
import { AUDIT_LIMIT, AuditEvent, AuditLogService, AuditType } from '../../services/audit-log.service';
import { TransactionService } from '../../services/transaction.service';
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
};

// Settings -> Change history: read-only list of everything that changed money data
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
    private translate: TranslateService
  ) {}

  label(type: AuditType): string {
    return LABELS[type];
  }

  accountName(id: string | undefined): string {
    return (id && this.accountService.byId(id)?.name) || '';
  }

  when(iso: string): string {
    return new Date(iso).toLocaleString(this.translate.locale());
  }

  // One line: the new value, or "before -> after" for edits
  summary(e: AuditEvent): string {
    const pick = (v: unknown): string => {
      if (!v || typeof v !== 'object') return '';
      const o = v as Record<string, unknown>;
      return [o['type'], o['amount'], o['date'], o['note'], o['name']].filter((x) => x !== undefined && x !== '').join(' ');
    };
    if (e.type === 'edit') return `${pick(e.before)} → ${pick(e.after)}`;
    if (e.type === 'convert-transfer') return `${this.accountName(e.accountId)} → ${this.accountName((e.after as { toAccountId?: string })?.toAccountId)}`;
    if (e.type === 'reconcile' || e.type === 'balance-adjustment') return JSON.stringify(e.after);
    if (e.type === 'import' || e.type === 'migration' || e.type === 'recurring-post' || e.type === 'audit-trim') return JSON.stringify(e.after ?? e.before);
    return pick(e.before) || pick(e.after);
  }

  undo(e: AuditEvent): void {
    const result = this.transactions.undoConversion(e.id);
    this.message.set(this.translate.instant(result.ok ? 'Conversion undone.' : 'The movement changed since, so it cannot be undone.'));
  }
}
