import { Injectable, signal } from '@angular/core';
import { mailUrl } from '../config/app-config';
import { ApiError } from '../data-layer/api-client';
import { cleanSenders } from '../domain/capture/mail';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { CaptureService } from './capture.service';

export interface MailStatus {
  configured: boolean; // the server has the Google secrets
  connected: boolean;
  email: string | null;
  lastReadAt: number | null;
}

interface ScanReply {
  ok: true;
  skipped: number;
  messages: { id: string; from: string; subject: string; date: string; text: string; pdf?: { name: string; base64: string } }[];
}

export type MailFailure = 'no-session' | 'offline' | 'not-configured' | 'not-connected' | 'empty-filter' | 'reconnect' | 'error';

export type ScanResult = { ok: true; drafts: number; messages: number; skipped: number } | { ok: false; code: MailFailure };

// The Gmail connector of smart capture, seen from the app: it only starts the flow and asks "connected:
// yes/no". The tokens never reach the device. A scan brings back REDUCED TEXT of the messages that match
// the user's filter; each one then goes through the same capture gate as everything else (the switch,
// the consent, the limits), so no mail is read by the AI unless the capture switch is on.
@Injectable({ providedIn: 'root' })
export class MailCaptureService {
  private _status = signal<MailStatus | null>(null);
  status = this._status.asReadonly();
  private _scanning = signal(false);
  scanning = this._scanning.asReadonly();

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private capture: CaptureService
  ) {}

  private fail(error: unknown): MailFailure {
    if (!(error instanceof ApiError)) return 'error';
    if (error.status === 0) return 'offline';
    if (error.status === 401) return 'no-session';
    if (error.status === 501) return 'not-configured';
    if (error.code === 'not_connected') return 'not-connected';
    if (error.code === 'empty_filter') return 'empty-filter';
    if (error.code === 'reconnect') return 'reconnect';
    return 'error';
  }

  private call<T>(action: string, body: object = {}): Promise<T> {
    return this.api.client.call<T>(action, body, { base: mailUrl() });
  }

  async refresh(): Promise<MailStatus | null> {
    if (this.auth.mode() !== 'signed-in') return null;
    try {
      const r = await this.call<{ ok: true } & MailStatus>('status');
      this._status.set({ configured: !!r.configured, connected: !!r.connected, email: r.email ?? null, lastReadAt: r.lastReadAt ?? null });
    } catch {
      return null;
    }
    return this._status();
  }

  // The URL of the Google consent screen (opened by the caller in the browser)
  async connectUrl(): Promise<{ ok: true; url: string } | { ok: false; code: MailFailure }> {
    try {
      const r = await this.call<{ ok: true; url: string }>('start');
      return /^https:\/\/accounts\.google\.com\//.test(r.url) ? { ok: true, url: r.url } : { ok: false, code: 'error' };
    } catch (e) {
      return { ok: false, code: this.fail(e) };
    }
  }

  async disconnect(): Promise<boolean> {
    try {
      await this.call('disconnect');
      this._status.set({ configured: true, connected: false, email: null, lastReadAt: null });
      return true;
    } catch {
      return false;
    }
  }

  // Looks for new notices of the user's banks. At most 30 messages per search; messages whose sender
  // does not match the filter never become a draft.
  async scan(): Promise<ScanResult> {
    const prefs = this.capture.prefs();
    if (this.auth.mode() !== 'signed-in') return { ok: false, code: 'no-session' };
    const senders = cleanSenders(prefs.mailFilter.senders);
    if (!senders.length) return { ok: false, code: 'empty-filter' };
    this._scanning.set(true);
    try {
      const r = await this.call<ScanReply>('scan', { filter: { senders, subjectWords: prefs.mailFilter.subjectWords }, includePdf: prefs.includePdf });
      let drafts = 0;
      for (const m of r.messages) {
        if (this.capture.drafts.hasMessage(m.id)) continue; // already read: the same mail twice is not two drafts
        const meta = { sender: m.from, sentAt: m.date, messageId: m.id };
        const result = m.pdf
          ? await this.capture.submit({ source: 'email', payload: { mode: 'pdf', mediaType: 'application/pdf', data: m.pdf.base64 }, original: { kind: 'pdf', name: m.pdf.name }, meta })
          : await this.capture.submit({ source: 'email', payload: { mode: 'text', text: `${m.subject}\n${m.text}`.slice(0, 6000) }, original: { kind: 'text', text: m.text.slice(0, 1200) }, meta });
        if (result.ok) drafts += result.drafts.length;
      }
      this.capture.setPrefs({ lastMailScan: new Date().toISOString() });
      void this.refresh();
      return { ok: true, drafts, messages: r.messages.length, skipped: r.skipped };
    } catch (e) {
      return { ok: false, code: this.fail(e) };
    } finally {
      this._scanning.set(false);
    }
  }
}
