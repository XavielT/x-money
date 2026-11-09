import { Component, Input, OnChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AiAssistService, NarrateOutcome } from '../../ai/ai-assist.service';
import { AiService } from '../../ai/ai.service';
import { AI_CATALOG } from '../../ai/catalog';
import { Prepared } from '../../ai/inputs';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AiConsentSheetComponent } from '../ai-consent-sheet/ai-consent-sheet';
import { AiLabelComponent } from '../ai-label/ai-label';

// One AI function that narrates. The calculated text is ALWAYS on screen (it is the deterministic
// alternative); with AI on, a button writes it in natural language. The text of the model only
// appears after the validator accepted it, with its figures put by this device, and it is labelled.
import { SETTINGS_LINKS } from '../../config/settings-links';

@Component({
  selector: 'app-ai-card',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, AiLabelComponent, AiConsentSheetComponent],
  templateUrl: './ai-card.html',
  styleUrl: './ai-card.scss',
})
export class AiCardComponent implements OnChanges {
  readonly settingsLinks = SETTINGS_LINKS;
  @Input({ required: true }) featureId = '';
  @Input() arg: unknown = undefined;
  @Input() showTitle = true;

  prepared = signal<Prepared | null>(null);
  outcome = signal<NarrateOutcome | null>(null);
  busy = signal(false);
  consent = signal(false);
  message = signal('');

  constructor(
    public ai: AiService,
    private assist: AiAssistService
  ) {}

  get label(): string {
    return AI_CATALOG.find((f) => f.id === this.featureId)?.labelKey ?? this.featureId;
  }

  // the module switch the function needs (to tell the user which one is off)
  get moduleOn(): boolean {
    const m = AI_CATALOG.find((f) => f.id === this.featureId)?.module;
    return !m || this.ai.moduleEnabled(m);
  }

  ngOnChanges(): void {
    this.prepared.set(this.assist.prepare(this.featureId, this.arg));
    this.outcome.set(null);
    this.message.set('');
  }

  previewBody(): unknown {
    const p = this.prepared();
    return p ? this.ai.preview(this.featureId, p.wire) : {};
  }

  async write(): Promise<void> {
    this.message.set('');
    this.busy.set(true);
    const r = await this.assist.narrate(this.featureId, this.arg);
    this.busy.set(false);
    if (r.failure === 'consent-needed') {
      this.consent.set(true);
      return;
    }
    this.outcome.set(r);
    if (r.failure) this.message.set(this.ai.messageOf(r.failure));
  }

  async confirm(): Promise<void> {
    this.ai.acknowledge(this.featureId);
    this.consent.set(false);
    await this.write();
  }
}
