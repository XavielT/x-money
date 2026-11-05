import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AiService } from '../../ai/ai.service';
import { CAPTURE_DAILY_LIMIT } from '../../ai/ai.types';
import { parseSenderText } from '../../domain/capture/mail';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { CaptureService } from '../../services/capture.service';
import { MailCaptureService, MailFailure } from '../../services/mail-capture.service';
import { TranslateService } from '../../services/translate.service';

const MAIL_MESSAGES: Record<MailFailure, string> = {
  'no-session': 'Sign in (Settings → Account) first.',
  offline: 'No connection right now.',
  'not-configured': 'Mail reading is not set up on the server yet (see docs/SETUP-CAPTURA.md).',
  'not-connected': 'Connect your mail first.',
  'empty-filter': 'Add at least one sender (a bank address or domain) first: nothing else is ever read.',
  reconnect: 'The connection expired or was revoked. Connect again.',
  error: 'The mail search failed. Try again later.',
};

// Settings → "Smart capture": its own switch (off by default) with a consent that says exactly what
// leaves the device, independent of the general AI switch; the receipt option; and the mail connector.
@Component({
  selector: 'app-capture-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './capture-settings.html',
  styleUrl: '../ai-settings/ai-settings.scss',
})
export class CaptureSettingsComponent implements OnInit {
  consent = signal(false);
  sendersText = signal('');
  subjectText = signal('');
  message = signal('');
  limit = CAPTURE_DAILY_LIMIT;

  constructor(
    public ai: AiService,
    public capture: CaptureService,
    public mail: MailCaptureService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const f = this.capture.prefs().mailFilter;
    this.sendersText.set(f.senders.join(', '));
    this.subjectText.set(f.subjectWords.join(', '));
    if (this.capture.prefs().mailEnabled) void this.mail.refresh();
  }

  // Turning it ON goes through the consent; turning it OFF withdraws the consent at once
  toggle(on: boolean, box?: HTMLInputElement): void {
    if (on) {
      this.consent.set(true);
      if (box) box.checked = false; // it only turns on after "I understand, turn it on"
    } else {
      this.ai.setDocuments(false);
      this.capture.setPrefs({ mailEnabled: false });
    }
  }

  accept(): void {
    this.ai.setDocuments(true);
    this.consent.set(false);
  }

  cancel(): void {
    this.consent.set(false);
  }

  toggleMail(on: boolean): void {
    this.capture.setPrefs({ mailEnabled: on });
    if (on) void this.mail.refresh();
  }

  saveFilter(): void {
    const senders = parseSenderText(this.sendersText());
    const subjectWords = this.subjectText()
      .split(/[,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 2 && s.length <= 40)
      .slice(0, 20);
    this.capture.setPrefs({ mailFilter: { senders, subjectWords } });
    this.sendersText.set(senders.join(', '));
    this.message.set(this.translate.instant('Filter saved.'));
  }

  async connect(): Promise<void> {
    this.message.set('');
    const r = await this.mail.connectUrl();
    if (!r.ok) this.message.set(this.translate.instant(MAIL_MESSAGES[r.code]));
    else window.open(r.url, '_blank', 'noopener');
  }

  async disconnect(): Promise<void> {
    this.message.set(this.translate.instant((await this.mail.disconnect()) ? 'Disconnected: the stored token was deleted and the access was revoked.' : 'It could not be disconnected. Try again.'));
  }

  async search(): Promise<void> {
    this.message.set('');
    const r = await this.mail.scan();
    this.message.set(r.ok ? this.translate.instant('{n} message(s) read, {d} draft(s) created.').replace('{n}', String(r.messages)).replace('{d}', String(r.drafts)) : this.translate.instant(MAIL_MESSAGES[r.code]));
  }

  captureStatusKey(): string {
    return (
      {
        off: 'Smart capture is off.',
        'no-session': 'Sign in (Settings → Account) to read documents.',
        offline: 'No connection right now: captures wait on this device.',
        'capture-limit': 'The daily limit of captures was reached.',
        limit: 'The monthly AI limit was reached.',
        ready: 'Ready.',
      } as Record<string, string>
    )[this.ai.captureStatus()];
  }
}
