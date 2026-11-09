import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GoalKind, GoalModel, PlanCadence } from '../../../shared/models/goal.model';
import { OperationCategory } from '../../../shared/models/business-operation.model';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AccountService } from '../../../shared/services/account.service';
import { GoalResult, GoalService } from '../../../shared/services/goal.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { TranslateService } from '../../../shared/services/translate.service';
import { Reminder } from '../../../shared/domain/goals';

interface Template {
  kind: GoalKind;
  icon: string;
  label: string; // translation key
}

// Templates only prefill the form; nothing about a goal is inferred from its kind
const TEMPLATES: Template[] = [
  { kind: 'emergency', icon: '🛟', label: 'Emergency fund' },
  { kind: 'vehicle', icon: '🚗', label: 'Vehicle' },
  { kind: 'business-capital', icon: '🧰', label: 'Business capital' },
  { kind: 'travel', icon: '✈️', label: 'Travel' },
  { kind: 'repairs', icon: '🛠️', label: 'Repairs' },
  { kind: 'investments', icon: '📈', label: 'Investments' },
  { kind: 'custom', icon: '⭐', label: 'Custom' },
];

const ERRORS: Record<string, string> = {
  name: 'Give the goal a name.',
  target: 'The target must be greater than zero.',
  date: 'The target date must be in the future.',
  plan: 'The plan needs an amount greater than zero.',
  months: 'Choose between 1 and 12 months.',
  amount: 'The amount must be greater than zero.',
  exceeds: 'That is more than what is set aside in this goal.',
  archived: 'This goal is archived.',
  kind: 'Only business-capital goals can be used for inventory.',
  account: 'Choose an existing account.',
  'read-only': 'This device is read-only right now.',
  'not-found': 'That entry was not found.',
};

import { ModuleOffComponent } from '../../../shared/components/module-off/module-off';

@Component({
  selector: 'app-goals',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, ModuleOffComponent],
  templateUrl: './goals.html',
  styleUrl: './goals.scss',
})
export class GoalsComponent {
  templates = TEMPLATES;
  message = signal('');

  openId = signal<string | null>(null);
  formOpen = signal(false);
  editingId: string | null = null;

  // Goal form
  fKind: GoalKind = 'custom';
  fName = '';
  fCustomKind = '';
  fTarget: number | null = null;
  fDate = '';
  fPlanAmount: number | null = null;
  fCadence: PlanCadence = 'monthly';
  fAccountId = '';
  fMonths = 3;
  monthChoices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // Quick entry (per open goal)
  eAmount: number | null = null;
  eNote = '';
  // "Use for inventory"
  inventoryOpen = signal(false);
  iName = '';
  iCategory: OperationCategory = 'part';
  iCost: number | null = null;
  iAccountId = '';

  list = computed(() =>
    this.goalService.goals().map((goal) => ({
      goal,
      progress: this.goalService.progress(goal),
      status: this.goalService.status(goal),
      projection: this.goalService.projection(goal),
      viability: this.goalService.viabilityOf(goal),
    }))
  );
  personalList = computed(() => this.list().filter((r) => r.goal.kind !== 'business-capital' && r.goal.status !== 'archived'));
  commercialList = computed(() => this.list().filter((r) => r.goal.kind === 'business-capital' && r.goal.status !== 'archived'));
  archivedList = computed(() => this.list().filter((r) => r.goal.status === 'archived'));
  open = computed(() => this.list().find((r) => r.goal.id === this.openId()) ?? null);
  openEmergency = computed(() => {
    const row = this.open();
    return row && row.goal.kind === 'emergency' ? this.goalService.emergencyOf(row.goal) : null;
  });
  accountOptions = computed(() => this.accounts.activeAccounts().filter((a) => (a.currency ?? 'DOP') === 'DOP'));

  constructor(
    private translate: TranslateService,
    public goalService: GoalService,
    public accounts: AccountService,
    public settings: SettingsService
  ) {}

  money(n: number): string {
    return `${this.settings.currency()}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  goalName(id: string): string {
    return this.goalService.byId(id)?.name ?? '';
  }

  iconOf(kind: GoalKind): string {
    return TEMPLATES.find((t) => t.kind === kind)?.icon ?? '⭐';
  }

  viabilityLabel(status: string): string {
    return (
      { reachable: 'Reachable', tight: 'Tight', unreachable: 'Not reachable', 'no-date': 'No target date', achieved: 'Achieved' } as Record<string, string>
    )[status] ?? status;
  }

  private report(r: GoalResult, done?: () => void): boolean {
    if (r.ok) {
      this.message.set('');
      done?.();
      return true;
    }
    this.message.set(this.translate.instant(ERRORS[r.error] ?? 'That could not be saved.'));
    return false;
  }

  // ----- goal form
  newGoal(kind: GoalKind = 'custom'): void {
    this.editingId = null;
    this.fKind = kind;
    this.fName = kind === 'custom' ? '' : this.translate.instant(TEMPLATES.find((t) => t.kind === kind)!.label);
    this.fCustomKind = '';
    this.fTarget = null;
    this.fDate = '';
    this.fPlanAmount = null;
    this.fCadence = 'monthly';
    this.fAccountId = '';
    this.fMonths = 3;
    this.formOpen.set(true);
    this.message.set('');
  }

  editGoal(g: GoalModel): void {
    this.editingId = g.id;
    this.fKind = g.kind;
    this.fName = g.name;
    this.fCustomKind = g.customKind ?? '';
    this.fTarget = g.target;
    this.fDate = g.targetDate ?? '';
    this.fPlanAmount = g.plan?.amount ?? null;
    this.fCadence = g.plan?.cadence ?? 'monthly';
    this.fAccountId = g.accountId ?? '';
    this.fMonths = g.emergencyMonths ?? 3;
    this.formOpen.set(true);
    this.message.set('');
  }

  saveGoal(): void {
    const plan = this.fPlanAmount ? { amount: Number(this.fPlanAmount), cadence: this.fCadence, startDate: this.goalService.today() } : undefined;
    const base = {
      name: this.fName,
      target: Number(this.fTarget ?? 0),
      targetDate: this.fDate || undefined,
      plan,
      accountId: this.fAccountId || undefined,
      ...(this.fKind === 'custom' ? { customKind: this.fCustomKind } : {}),
      ...(this.fKind === 'emergency' ? { emergencyMonths: Number(this.fMonths) } : {}),
    };
    const result = this.editingId
      ? this.goalService.update(this.editingId, { ...base, plan: base.plan })
      : this.goalService.add({ ...base, kind: this.fKind });
    this.report(result, () => {
      this.formOpen.set(false);
      if (result.ok) this.openId.set(result.id);
    });
  }

  // ----- entries
  toggle(id: string): void {
    this.openId.set(this.openId() === id ? null : id);
    this.eAmount = null;
    this.eNote = '';
    this.inventoryOpen.set(false);
    this.message.set('');
  }

  addEntry(g: GoalModel, type: 'contribution' | 'withdrawal'): void {
    const r = this.goalService.addEntry(g.id, { type, amount: Number(this.eAmount ?? 0), date: this.goalService.today(), note: this.eNote || undefined });
    this.report(r, () => {
      this.eAmount = null;
      this.eNote = '';
    });
  }

  reverse(g: GoalModel, entryId: string): void {
    if (!confirm(this.translate.instant('Reverse this entry? It stays in the history.'))) return;
    this.report(this.goalService.reverseEntry(g.id, entryId));
  }

  setStatus(g: GoalModel, status: GoalModel['status']): void {
    this.report(this.goalService.setStatus(g.id, status));
  }

  // ----- reminders: one tap confirms, nothing is ever contributed on its own
  confirmReminder(r: Reminder): void {
    this.report(this.goalService.confirmReminder(r));
  }

  skipReminder(r: Reminder): void {
    this.goalService.skipReminder(r.goalId, r.date);
  }

  acceptTarget(g: GoalModel): void {
    this.report(this.goalService.acceptEmergencyTarget(g.id));
  }

  // ----- inventory
  openInventory(g: GoalModel): void {
    this.inventoryOpen.set(true);
    this.iName = '';
    this.iCategory = 'part';
    this.iCost = null;
    this.iAccountId = this.accountOptions()[0]?.id ?? '';
  }

  buyInventory(g: GoalModel): void {
    const r = this.goalService.useForInventory(g.id, {
      name: this.iName,
      category: this.iCategory,
      totalCost: Number(this.iCost ?? 0),
      acquiredAt: this.goalService.today(),
      accountId: this.iAccountId,
    });
    this.report(r, () => this.inventoryOpen.set(false));
  }
}
