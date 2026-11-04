import { Component, EventEmitter, Input, OnChanges, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AiAssistService, Suggestion } from '../../ai/ai-assist.service';
import { AiService } from '../../ai/ai.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { CategoryService } from '../../services/category.service';
import { TextRuleService } from '../../services/text-rule.service';
import { AiConsentSheetComponent } from '../ai-consent-sheet/ai-consent-sheet';
import { AiLabelComponent } from '../ai-label/ai-label';

// Under the note of an expense: the category the user already chose for the same word (a local rule,
// no AI involved) and, on request, up to 3 candidates from AI. Tapping one only fills the form.
@Component({
  selector: 'app-ai-category-hint',
  standalone: true,
  imports: [CommonModule, TranslatePipe, AiLabelComponent, AiConsentSheetComponent],
  template: `
    <div class="hint" *ngIf="rule() || ai.prefs().enabled">
      <button type="button" class="hint-chip" *ngIf="rule() as r" (click)="pick(r.target)">💡 {{ r.label }} <small>({{ 'learned' | t }})</small></button>
      <button type="button" class="hint-link" *ngIf="ai.prefs().enabled && moduleOn() && note.trim().length > 2" (click)="ask()" [disabled]="busy()">✨ {{ 'Suggest a category with AI' | t }}</button>
      <button type="button" class="hint-chip" *ngFor="let s of aiPicks()" (click)="pick(s.target)">{{ s.label }} <small>{{ s.confidence * 100 | number: '1.0-0' }}%</small></button>
      <app-ai-label *ngIf="aiPicks().length"></app-ai-label>
      <small class="hint-error" *ngIf="message()">{{ message() }}</small>
    </div>
    <app-ai-consent-sheet *ngIf="consent()" [title]="'Suggest a category for an expense' | t" [description]="'The text of the notes to classify (cleaned of identifiers) and your category names.' | t" [preview]="previewBody()" (confirmed)="confirm()" (cancelled)="consent.set(false)"></app-ai-consent-sheet>
  `,
  styles: [
    `
      .hint {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        margin: 4px 0 8px;
      }
      .hint-chip {
        border: 1px solid var(--income);
        background: transparent;
        color: var(--text);
        border-radius: 14px;
        padding: 3px 10px;
        font-size: 0.78rem;
      }
      .hint-link {
        background: transparent;
        border: none;
        color: var(--main-ultra-light);
        font-size: 0.78rem;
        text-decoration: underline;
      }
      .hint-error {
        color: var(--expense);
      }
    `,
  ],
})
export class AiCategoryHintComponent implements OnChanges {
  @Input() note = '';
  @Output() picked = new EventEmitter<string>();

  rule = signal<Suggestion | null>(null);
  aiPicks = signal<Suggestion[]>([]);
  busy = signal(false);
  consent = signal(false);
  message = signal('');

  constructor(
    public ai: AiService,
    private assist: AiAssistService,
    private rules: TextRuleService,
    private categories: CategoryService
  ) {}

  moduleOn(): boolean {
    return this.ai.moduleEnabled('expenses');
  }

  ngOnChanges(): void {
    const r = this.rules.match(this.note, 'expense');
    this.rule.set(r ? { source: 'rule', target: r.target, label: this.assistName(r.target), confidence: 1 } : null);
    this.aiPicks.set([]);
    this.message.set('');
  }

  private assistName(id: string): string {
    return this.categories.byId(id)?.name ?? '';
  }

  previewBody(): unknown {
    return this.ai.preview('expense-categorize', { items: [this.note.trim().slice(0, 120)], options: ['…your category names…'] });
  }

  pick(categoryId: string): void {
    this.picked.emit(categoryId);
    this.rules.learn('expense', this.note, categoryId); // accepted: the next time no AI is needed
  }

  async ask(): Promise<void> {
    this.message.set('');
    this.busy.set(true);
    const r = await this.assist.suggestCategories([this.note]);
    this.busy.set(false);
    if (r.failure === 'consent-needed') {
      this.consent.set(true);
      return;
    }
    if (r.failure) this.message.set(this.ai.messageOf(r.failure));
    this.aiPicks.set(r.results[0].filter((s) => s.source === 'ai' && !!s.target));
  }

  async confirm(): Promise<void> {
    this.ai.acknowledge('expense-categorize');
    this.consent.set(false);
    await this.ask();
  }
}
