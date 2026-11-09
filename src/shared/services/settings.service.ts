import { Injectable, signal } from '@angular/core';
import { BACKUP_KEYS, BackupCounts, ImportError, buildBackup, parseBackup } from '../data-layer/backup';
import { BaseIncome, BudgetSettings } from '../models/budget.model';
import { ModuleChoices, ModuleId, cleanChoices } from '../domain/modules';
import { AuditLogService } from './audit-log.service';
import { StorageService } from './storage.service';

// Dismissed/confirmed suggestions (so they are not offered again). Synced with the settings.
export interface SuggestionMemory {
  transferDismissed: string[];
  incomeDismissed: string[];
  incomeConfirmed: string[];
}

interface SettingsState {
  currency: string;
  taxPercent?: number; // bank transfer tax (DGII), editable because it changes
  suggestions?: SuggestionMemory;
  budget?: BudgetSettings; // distribution base and risk threshold (2.10.0)
  dashboard?: DashboardSettings;
  antMax?: number; // ceiling of a "small purchase"; empty = the usual relative rule
  modules?: ModuleChoices; // what the user chose for each switchable module; a missing key = automatic (2.22.0)
}

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = { base: 'avg3', riskAt: 90 };

// Dashboard preferences (2.11.0)
export interface DashboardSettings {
  cushion: number; // the balance below which the cash-flow projection warns (0 = off)
  includeVariableIncome: boolean; // add the average of variable income to the projection (off by default)
  unusualMin: number; // unusual expenses below this amount are never flagged
}

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = { cushion: 0, includeVariableIncome: false, unusualMin: 500 };

const NO_SUGGESTIONS: SuggestionMemory = { transferDismissed: [], incomeDismissed: [], incomeConfirmed: [] };

export type ImportResult = { ok: true; counts: BackupCounts } | { ok: false; error: ImportError };

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private _currency = signal<string>('$');
  currency = this._currency.asReadonly();

  // 0.20% since the 2026 update (was 0.15%) — user-editable in Settings
  private _taxPercent = signal<number>(0.2);
  taxPercent = this._taxPercent.asReadonly();

  private _budget = signal<BudgetSettings>(DEFAULT_BUDGET_SETTINGS);
  budget = this._budget.asReadonly();

  private _dashboard = signal<DashboardSettings>(DEFAULT_DASHBOARD_SETTINGS);
  dashboard = this._dashboard.asReadonly();

  private _antMax = signal<number | undefined>(undefined);
  antMax = this._antMax.asReadonly();

  private _modules = signal<ModuleChoices>({});
  // explicit choices only; ModuleService decides what is on
  modules = this._modules.asReadonly();

  private _suggestions = signal<SuggestionMemory>(NO_SUGGESTIONS);
  suggestions = this._suggestions.asReadonly();

  constructor(
    private storage: StorageService,
    private audit: AuditLogService
  ) {
    this.load(this.storage.get<SettingsState>('settings', { currency: '$' }));
    this.storage.watch('settings', (v) => this.load((v as SettingsState | undefined) ?? { currency: '$' }));
  }

  private load(saved: SettingsState): void {
    this._currency.set(saved.currency);
    this._taxPercent.set(saved.taxPercent ?? 0.2);
    this._suggestions.set({ ...NO_SUGGESTIONS, ...(saved.suggestions ?? {}) });
    this._budget.set({ ...DEFAULT_BUDGET_SETTINGS, ...(saved.budget ?? {}) });
    this._antMax.set(saved.antMax);
    this._dashboard.set({ ...DEFAULT_DASHBOARD_SETTINGS, ...(saved.dashboard ?? {}) });
    this._modules.set(cleanChoices(saved.modules));
  }

  // Hides or shows the shortcuts of a module. It never touches the module's data.
  setModule(id: ModuleId, on: boolean): void {
    this._modules.set({ ...this._modules(), [id]: on });
    this.persist();
  }

  setDashboard(patch: Partial<DashboardSettings>): void {
    const next = { ...this._dashboard(), ...patch };
    if (!Number.isFinite(next.cushion) || next.cushion < 0 || !Number.isFinite(next.unusualMin) || next.unusualMin < 0) return;
    this._dashboard.set(next);
    this.persist();
  }

  setBudgetBase(base: BaseIncome): void {
    this._budget.set({ ...this._budget(), base });
    this.persist();
  }

  setRiskAt(percent: number): void {
    if (!Number.isFinite(percent) || percent < 10 || percent > 200) return;
    this._budget.set({ ...this._budget(), riskAt: percent });
    this.persist();
  }

  setAntMax(amount: number | undefined): void {
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) return;
    this._antMax.set(amount);
    this.persist();
  }

  setCurrency(symbol: string): void {
    this._currency.set(symbol);
    this.persist();
  }

  setTaxPercent(percent: number): void {
    if (!isFinite(percent) || percent < 0 || percent > 10) return;
    this._taxPercent.set(percent);
    this.persist();
  }

  dismissTransferSuggestion(key: string): void {
    this.remember({ transferDismissed: [...this._suggestions().transferDismissed, key] });
  }

  dismissIncomeSuggestion(key: string): void {
    this.remember({ incomeDismissed: [...this._suggestions().incomeDismissed, key] });
  }

  confirmIncomeSuggestion(key: string): void {
    this.remember({ incomeConfirmed: [...this._suggestions().incomeConfirmed, key] });
  }

  private remember(patch: Partial<SuggestionMemory>): void {
    this._suggestions.set({ ...this._suggestions(), ...patch });
    this.persist();
  }

  private persist(): void {
    this.storage.set<SettingsState>('settings', {
      currency: this._currency(),
      taxPercent: this._taxPercent(),
      suggestions: this._suggestions(),
      budget: this._budget(),
      antMax: this._antMax(),
      dashboard: this._dashboard(),
      ...(Object.keys(this._modules()).length ? { modules: this._modules() } : {}),
    });
  }

  // Full backup as a JSON string (used for the export file). Carries the schema version.
  exportData(): string {
    return buildBackup((key) => this.storage.get<unknown>(key, null));
  }

  // Validates a backup and reports what it holds, without touching anything
  previewImport(json: string): ImportResult {
    const parsed = parseBackup(json);
    return parsed.ok ? { ok: true, counts: parsed.counts } : parsed;
  }

  // Restores a backup. Old backups (no schema version) go through the migrations; anything
  // malformed is rejected before a single key is written. Keys the backup does not contain
  // keep their current data. Goes through the data layer, so it syncs like any write.
  importData(json: string): ImportResult {
    const parsed = parseBackup(json);
    if (!parsed.ok) return parsed;
    for (const key of BACKUP_KEYS) {
      if (parsed.data[key] !== undefined) this.storage.set(key, parsed.data[key]);
    }
    this.audit.log({
      type: 'import',
      entity: 'backup',
      entityId: 'backup',
      after: { ...parsed.counts, fromSchemaVersion: parsed.fromVersion },
      origin: 'import',
    });
    return { ok: true, counts: parsed.counts };
  }

  wipeData(): void {
    this.storage.clearAll();
  }
}
