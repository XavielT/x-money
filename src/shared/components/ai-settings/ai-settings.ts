import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AI_MODULES, AiFailure, AiModule } from '../../ai/ai.types';
import { AiService } from '../../ai/ai.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AiConsentSheetComponent } from '../ai-consent-sheet/ai-consent-sheet';

const MODULE_LABELS: Record<AiModule, string> = {
  income: 'Income',
  expenses: 'Expenses',
  budgets: 'Budgets',
  business: 'Business',
  cards: 'Cards and accounts',
  loans: 'Loans',
  savings: 'Savings',
  dashboard: 'Dashboard',
};

// Settings → "Artificial intelligence": the general switch (off by default), a switch per module,
// the monthly use, clearing the cache, seeing exactly what is sent and testing the connection.
@Component({
  selector: 'app-ai-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, AiConsentSheetComponent],
  templateUrl: './ai-settings.html',
  styleUrl: './ai-settings.scss',
})
export class AiSettingsComponent {
  modules = AI_MODULES;
  showSent = signal(false);
  consent = signal(false);
  testing = signal(false);
  testResult = signal<{ ok: boolean; text: string } | null>(null);
  cleared = signal(false);

  constructor(public ai: AiService) {}

  moduleLabel(m: AiModule): string {
    return MODULE_LABELS[m];
  }

  statusKey(): string {
    return (
      { off: 'AI is off.', 'no-session': 'Sign in (Settings → Account) to use AI.', offline: 'No connection right now.', limit: 'The monthly limit was reached.', ready: 'Ready.' } as Record<string, string>
    )[this.ai.status()];
  }

  toggle(on: boolean): void {
    this.ai.setEnabled(on);
    if (on) void this.ai.refreshUsage();
  }

  sentPreview(): unknown {
    return this.ai.preview('ping', {});
  }

  clearCache(): void {
    this.ai.clearCache();
    this.cleared.set(true);
  }

  async test(): Promise<void> {
    this.testResult.set(null);
    this.testing.set(true);
    const r = await this.ai.run('ping', {});
    this.testing.set(false);
    if (r.ok) this.testResult.set({ ok: true, text: 'The connection works.' });
    else if (r.code === 'consent-needed') this.consent.set(true);
    else this.testResult.set({ ok: false, text: this.ai.messageOf(r.code as AiFailure) });
    if (r.ok) void this.ai.refreshUsage();
  }

  async confirmTest(): Promise<void> {
    this.ai.acknowledge('ping');
    this.consent.set(false);
    await this.test();
  }
}
