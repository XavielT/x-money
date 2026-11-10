import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RecurringFrequency, RecurringModel } from '../../../../shared/models/recurring.model';
import { SettingsHeaderComponent } from '../../../../shared/components/settings-header/settings-header';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { CategoryService } from '../../../../shared/services/category.service';
import { RecurringService } from '../../../../shared/services/recurring.service';
import { SettingsService } from '../../../../shared/services/settings.service';
import { TranslateService } from '../../../../shared/services/translate.service';

// Settings > Recurring transactions: pause, edit or delete the rules that post movements by themselves.
@Component({
  selector: 'app-settings-recurring',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, SettingsHeaderComponent],
  templateUrl: './recurring.html',
  styleUrl: '../settings.scss',
})
export class SettingsRecurringComponent {
  editingRuleId: string | null = null;
  editAmount: number | null = null;
  editFrequency: RecurringFrequency = 'monthly';

  constructor(
    public recurringService: RecurringService,
    public categoryService: CategoryService,
    public settingsService: SettingsService,
    private translate: TranslateService
  ) {}

  frequencyLabel(frequency: string): string {
    const labels: Record<string, string> = {
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
      yearly: 'Yearly',
    };
    return this.translate.instant(labels[frequency] ?? frequency);
  }

  startEditRecurring(rule: RecurringModel): void {
    this.editingRuleId = rule.id;
    this.editAmount = rule.amount;
    this.editFrequency = rule.frequency;
  }

  saveEditRecurring(): void {
    if (!this.editingRuleId || this.editAmount == null || this.editAmount <= 0) return;
    this.recurringService.update(this.editingRuleId, Number(this.editAmount), this.editFrequency);
    this.editingRuleId = null;
  }

  removeRecurring(id: string): void {
    if (!confirm(this.translate.instant('Delete this recurring transaction? Already posted movements stay.'))) return;
    this.recurringService.remove(id);
  }
}
