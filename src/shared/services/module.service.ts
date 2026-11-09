import { Injectable, computed } from '@angular/core';
import { MODULE_IDS, MODULES_ON_BY_DEFAULT, ModuleId, resolveModule } from '../domain/modules';
import { BenefitService } from './benefit.service';
import { BusinessService } from './business.service';
import { GoalService } from './goal.service';
import { IncomeSourceService } from './income-source.service';
import { LoanService } from './loan.service';
import { SettingsService } from './settings.service';

// Which switchable modules the user sees. Integrity rule: a module that is off only hides shortcuts, Home cards and
// indicators. Its data stays saved and is still counted everywhere (net worth, budgets, business capital), and payment
// notices (cards, loans) and goal reminders are shown whether the module is on or off: they are obligations.
@Injectable({ providedIn: 'root' })
export class ModuleService {
  constructor(
    private settings: SettingsService,
    private incomeSources: IncomeSourceService,
    private benefits: BenefitService,
    private business: BusinessService,
    private loans: LoanService,
    private goals: GoalService
  ) {}

  // how many records each module holds (0 = no data)
  counts = computed<Record<ModuleId, number>>(() => ({
    income: this.incomeSources.sources().length,
    benefits: this.benefits.benefits().length,
    business: this.business.operations().length,
    loans: this.loans.loans().filter((l) => l.status !== 'voided').length,
    goals: this.goals.activeCount(),
    insights: 0,
  }));

  state = computed<Record<ModuleId, boolean>>(() => {
    const counts = this.counts();
    const explicit = this.settings.modules();
    const out = {} as Record<ModuleId, boolean>;
    for (const id of MODULE_IDS) out[id] = resolveModule(explicit[id], counts[id] > 0, MODULES_ON_BY_DEFAULT.includes(id));
    return out;
  });

  isOn(id: ModuleId): boolean {
    return this.state()[id];
  }

  // the user chose at least one switch (used by the get-started card)
  touched = computed(() => Object.keys(this.settings.modules()).length > 0);

  set(id: ModuleId, on: boolean): void {
    this.settings.setModule(id, on);
  }
}
