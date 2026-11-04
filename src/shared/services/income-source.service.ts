import { Injectable, computed, signal } from '@angular/core';
import { IncomeSourceModel } from '../models/income-source.model';
import { validSchedule } from '../domain/income';
import { AccountService } from './account.service';
import { AuditLogService } from './audit-log.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';

export type SourceError = 'name' | 'schedule' | 'amount' | 'account' | 'read-only' | 'not-found' | 'in-use';
export type SourceResult = { ok: true; id: string } | { ok: false; error: SourceError };

export type NewIncomeSource = Omit<IncomeSourceModel, 'id' | 'createdAt'>;

const money = (n: number | undefined) => n === undefined || (Number.isFinite(n) && n >= 0);

// The catalog of income sources. A source only describes a stream of income; the movements
// stay in `transactions` and point to it. Deleting is refused while movements point to a source
// (deactivate it instead), so no income silently becomes "unclassified".
@Injectable({ providedIn: 'root' })
export class IncomeSourceService {
  private _sources = signal<IncomeSourceModel[]>([]);
  sources = this._sources.asReadonly();
  active = computed(() => this._sources().filter((s) => s.active));

  constructor(
    private storage: StorageService,
    private accounts: AccountService,
    private transactions: TransactionService,
    private audit: AuditLogService
  ) {
    this._sources.set(this.storage.get<IncomeSourceModel[]>('incomeSources', []));
    this.storage.watch('incomeSources', (v) => this._sources.set((v as IncomeSourceModel[] | undefined) ?? []));
  }

  byId(id: string | undefined): IncomeSourceModel | undefined {
    return id ? this._sources().find((s) => s.id === id) : undefined;
  }

  private check(data: NewIncomeSource): SourceError | null {
    if (!data.name.trim() || (data.kind === 'custom' && !data.customKind?.trim())) return 'name';
    if (!validSchedule(data.schedule)) return 'schedule';
    if (!money(data.expectedGross) || !money(data.expectedNet)) return 'amount';
    if (data.expectedGross !== undefined && data.expectedNet !== undefined && data.expectedGross < data.expectedNet) return 'amount';
    if (data.defaultAccountId && !this.accounts.byId(data.defaultAccountId)) return 'account';
    return null;
  }

  private clean(data: NewIncomeSource): NewIncomeSource {
    return {
      ...data,
      name: data.name.trim(),
      customKind: data.kind === 'custom' ? data.customKind?.trim() : undefined,
      expectedGross: data.expectedGross || undefined,
      expectedNet: data.expectedNet || undefined,
      defaultAccountId: data.defaultAccountId || undefined,
    };
  }

  add(data: NewIncomeSource): SourceResult {
    if (this.storage.readOnly()) return { ok: false, error: 'read-only' };
    const error = this.check(data);
    if (error) return { ok: false, error };
    const source: IncomeSourceModel = { ...this.clean(data), id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    this.save([...this._sources(), source]);
    this.audit.log({ type: 'income-source', entity: 'income-source', entityId: source.id, after: { name: source.name, kind: source.kind, stability: source.stability }, origin: 'manual' });
    return { ok: true, id: source.id };
  }

  update(source: IncomeSourceModel): SourceResult {
    if (this.storage.readOnly()) return { ok: false, error: 'read-only' };
    const existing = this.byId(source.id);
    if (!existing) return { ok: false, error: 'not-found' };
    const error = this.check(source);
    if (error) return { ok: false, error };
    const next: IncomeSourceModel = { ...this.clean(source), id: existing.id, createdAt: existing.createdAt, skippedDates: existing.skippedDates };
    this.save(this._sources().map((s) => (s.id === next.id ? next : s)));
    this.audit.log({ type: 'income-source', entity: 'income-source', entityId: next.id, before: { name: existing.name, stability: existing.stability, active: existing.active }, after: { name: next.name, stability: next.stability, active: next.active } });
    return { ok: true, id: next.id };
  }

  setActive(id: string, active: boolean): void {
    const s = this.byId(id);
    if (s && s.active !== active) this.update({ ...s, active });
  }

  // "It did not happen": the expected date stops asking
  skipDate(id: string, date: string): void {
    const s = this.byId(id);
    if (!s || this.storage.readOnly() || (s.skippedDates ?? []).includes(date)) return;
    this.save(this._sources().map((x) => (x.id === id ? { ...x, skippedDates: [...(x.skippedDates ?? []), date].slice(-60) } : x)));
  }

  inUse(id: string): boolean {
    return this.transactions.transactions().some((t) => t.incomeSourceId === id);
  }

  remove(id: string): SourceResult {
    if (this.storage.readOnly()) return { ok: false, error: 'read-only' };
    const s = this.byId(id);
    if (!s) return { ok: false, error: 'not-found' };
    if (this.inUse(id)) return { ok: false, error: 'in-use' };
    this.save(this._sources().filter((x) => x.id !== id));
    this.audit.log({ type: 'income-source', entity: 'income-source', entityId: id, before: { name: s.name, kind: s.kind } });
    return { ok: true, id };
  }

  private save(list: IncomeSourceModel[]): void {
    this._sources.set(list);
    this.storage.set('incomeSources', list);
  }
}
