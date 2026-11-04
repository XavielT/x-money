import { Injectable, signal } from '@angular/core';
import { BenefitModel, BenefitUse } from '../models/benefit.model';
import { MonthUsage, monthUsage, monthlySaving, totalMonthlySaving, validBenefit, yearToDateSaving } from '../domain/benefits';
import { localIso } from '../domain/dates';
import { round2 } from '../utils/money';
import { AuditLogService } from './audit-log.service';
import { StorageService } from './storage.service';

export type BenefitError = 'invalid' | 'not-found' | 'read-only' | 'amount' | 'date';
export type BenefitResult = { ok: true; id: string } | { ok: false; error: BenefitError };

// Rule 4, by construction: this service depends ONLY on storage and the audit log. It has no
// path to accounts, movements, income or net worth, so nothing recorded here can become
// available money, income or payment capacity. A "use" is a note, not a movement.
@Injectable({ providedIn: 'root' })
export class BenefitService {
  private _benefits = signal<BenefitModel[]>([]);
  benefits = this._benefits.asReadonly();

  clock: () => Date = () => new Date();

  constructor(
    private storage: StorageService,
    private audit: AuditLogService
  ) {
    this._benefits.set(this.storage.get<BenefitModel[]>('benefits', []));
    this.storage.watch('benefits', (v) => this._benefits.set((v as BenefitModel[] | undefined) ?? []));
  }

  byId(id: string): BenefitModel | undefined {
    return this._benefits().find((b) => b.id === id);
  }

  today(): string {
    return localIso(this.clock());
  }

  // ----- estimates (always labelled "Estimate · not available money" on screen)

  usageOf(b: BenefitModel, year: number, month: number): MonthUsage {
    return monthUsage(b, year, month);
  }

  savingOf(b: BenefitModel, year: number, month: number): number {
    return monthlySaving(b, year, month);
  }

  monthlySaving(year: number, month: number): number {
    return totalMonthlySaving(this._benefits(), year, month);
  }

  yearSaving(year: number, upToMonth: number): number {
    return yearToDateSaving(this._benefits(), year, upToMonth);
  }

  // ----- writes

  add(data: Omit<BenefitModel, 'id' | 'uses'>): BenefitResult {
    if (this.storage.readOnly()) return { ok: false, error: 'read-only' };
    if (!validBenefit(data)) return { ok: false, error: 'invalid' };
    const benefit: BenefitModel = { ...this.clean(data), id: crypto.randomUUID(), uses: [] };
    this.save([...this._benefits(), benefit]);
    this.audit.log({ type: 'benefit', entity: 'benefit', entityId: benefit.id, after: { name: benefit.name, kind: benefit.kind, monthlyValue: benefit.monthlyValue } });
    return { ok: true, id: benefit.id };
  }

  update(benefit: BenefitModel): BenefitResult {
    if (this.storage.readOnly()) return { ok: false, error: 'read-only' };
    const existing = this.byId(benefit.id);
    if (!existing) return { ok: false, error: 'not-found' };
    if (!validBenefit(benefit)) return { ok: false, error: 'invalid' };
    const next: BenefitModel = { ...this.clean(benefit), id: existing.id, uses: existing.uses };
    this.save(this._benefits().map((b) => (b.id === next.id ? next : b)));
    this.audit.log({ type: 'benefit', entity: 'benefit', entityId: next.id, before: { name: existing.name, monthlyValue: existing.monthlyValue }, after: { name: next.name, monthlyValue: next.monthlyValue } });
    return { ok: true, id: next.id };
  }

  remove(id: string): BenefitResult {
    if (this.storage.readOnly()) return { ok: false, error: 'read-only' };
    const existing = this.byId(id);
    if (!existing) return { ok: false, error: 'not-found' };
    this.save(this._benefits().filter((b) => b.id !== id));
    this.audit.log({ type: 'benefit', entity: 'benefit', entityId: id, before: { name: existing.name } });
    return { ok: true, id };
  }

  // Notes a use. It does NOT create a movement and does not touch any balance.
  addUse(benefitId: string, use: Omit<BenefitUse, 'id'>): BenefitResult {
    if (this.storage.readOnly()) return { ok: false, error: 'read-only' };
    const b = this.byId(benefitId);
    if (!b) return { ok: false, error: 'not-found' };
    if (!Number.isFinite(use.amount) || use.amount <= 0) return { ok: false, error: 'amount' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(use.date)) return { ok: false, error: 'date' };
    const entry: BenefitUse = { id: crypto.randomUUID(), date: use.date, amount: round2(use.amount), note: use.note?.trim() || undefined };
    this.save(this._benefits().map((x) => (x.id === benefitId ? { ...x, uses: [entry, ...x.uses] } : x)));
    return { ok: true, id: entry.id };
  }

  removeUse(benefitId: string, useId: string): void {
    if (this.storage.readOnly()) return;
    this.save(this._benefits().map((x) => (x.id === benefitId ? { ...x, uses: x.uses.filter((u) => u.id !== useId) } : x)));
  }

  private clean<T extends Omit<BenefitModel, 'id' | 'uses'>>(b: T): T {
    return {
      ...b,
      name: b.name.trim(),
      provider: b.provider?.trim() || undefined,
      monthlyValue: round2(b.monthlyValue),
      monthlyLimit: b.monthlyLimit ? round2(b.monthlyLimit) : undefined,
      validFrom: b.validFrom || undefined,
      validTo: b.validTo || undefined,
      incomeSourceId: b.incomeSourceId || undefined,
      notes: b.notes?.trim() || undefined,
    };
  }

  private save(list: BenefitModel[]): void {
    this._benefits.set(list);
    this.storage.set('benefits', list);
  }
}
