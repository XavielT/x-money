import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MODULE_IDS, ModuleId } from '../../domain/modules';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { ModuleService } from '../../services/module.service';
import { TranslateService } from '../../services/translate.service';

interface ModuleRow {
  id: ModuleId;
  icon: string;
  name: string; // English phrase: the translation key
  description: string;
  countText: string; // English phrase with {n}
  route: string;
}

const ROWS: ModuleRow[] = [
  { id: 'income', icon: '💼', name: 'Income', description: 'Where your money comes from and when you expect it', countText: '{n} income source(s) saved', route: '/income' },
  { id: 'benefits', icon: '🎁', name: 'Benefits', description: 'What your job gives you that is not cash (fuel, insurance…)', countText: '{n} benefit(s) saved', route: '/benefits' },
  { id: 'business', icon: '🧰', name: 'Business', description: 'Buying and selling to resell, with its own capital apart', countText: '{n} operation(s) saved', route: '/business' },
  { id: 'loans', icon: '🏦', name: 'Loans', description: 'What you owe on loans and what it costs', countText: '{n} loan(s) registered', route: '/loans' },
  { id: 'goals', icon: '🎯', name: 'Goals', description: 'Money you set aside for a goal', countText: '{n} goal(s) saved', route: '/goals' },
  { id: 'insights', icon: '💡', name: 'Smart alerts', description: 'Alerts and analysis of your money', countText: '', route: '/insights' },
];

// Settings → Features: one switch per module. Turning one off only hides shortcuts and Home cards; the data stays saved and
// keeps being counted (payment notices and goal reminders keep showing: they are obligations).
@Component({
  selector: 'app-module-switches',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './module-switches.html',
  styleUrl: './module-switches.scss',
})
export class ModuleSwitchesComponent {
  rows = computed(() => ROWS.filter((r) => (MODULE_IDS as readonly string[]).includes(r.id)));

  constructor(
    public modules: ModuleService,
    private translate: TranslateService
  ) {}

  count(row: ModuleRow): string {
    const n = this.modules.counts()[row.id];
    return n > 0 && row.countText ? this.translate.instant(row.countText, { n: String(n) }) : '';
  }

  toggle(row: ModuleRow, event: Event): void {
    const input = event.target as HTMLInputElement;
    const on = input.checked;
    if (!on && this.modules.counts()[row.id] > 0) {
      const ok = confirm(this.translate.instant("Your data stays saved and is still counted. You just won't see the shortcuts."));
      if (!ok) {
        input.checked = true;
        return;
      }
    }
    this.modules.set(row.id, on);
  }
}
