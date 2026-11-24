import { Injectable, computed, signal } from '@angular/core';
import { BANKS_MOCK, bankById } from '../data/banks';
import { bankIdOf } from '../domain/capture/bank';
import { CAPTURE_FEATURE_ID } from '../ai/capture-feature';
import { AiFailure } from '../ai/ai.types';
import { AiService } from '../ai/ai.service';
import { CaptureDraft, CaptureSource } from '../models/capture-draft.model';
import { buildDraft } from '../domain/capture/build';
import { minimizeText } from '../domain/capture/files';
import { readTextLocally } from '../domain/capture/local';
import { purchaseDetailsOf } from '../domain/capture/details';
import { bankTaxInText } from '../domain/capture/fee';
import { BankNotification, bankOfSender, localDateOf, readBankNotification, readBankText } from '../domain/capture/notification';
import { foldBankCharges, isPayroll } from '../domain/capture/direction';
import { rematchAccount } from '../domain/capture/rematch';
import { combinePatch, findTransferPair } from '../domain/capture/transfer-pair';
import { dedupeKey, findDuplicate, normalizeMerchant } from '../domain/capture/merchant';
import { CaptureOp, MissingField, planApproval } from '../domain/capture/plan';
import { RawTransaction, parseCaptureOutput } from '../domain/capture/schema';
import { localIso } from '../domain/dates';
import { AccountService } from './account.service';
import { AuditLogService } from './audit-log.service';
import { ReconciliationService } from './reconciliation.service';
import { BusinessService } from './business.service';
import { CaptureDraftService } from './capture-draft.service';
import { CategoryService } from './category.service';
import { CreditCardService } from './credit-card.service';
import { GoalService } from './goal.service';
import { IncomeSourceService } from './income-source.service';
import { LoanService } from './loan.service';
import { StorageService } from './storage.service';
import { TextRuleService } from './text-rule.service';
import { TransactionService } from './transaction.service';
import { TranslateService } from './translate.service';

// What travels to capture_parse: ONE document or ONE text per call
export type CapturePayload = { mode: 'image'; mediaType: string; data: string } | { mode: 'pdf'; mediaType: 'application/pdf'; data: string } | { mode: 'text'; text: string };

// What the tray shows next to the fields while the draft waits. Device only; deleted when the draft is
// approved or rejected, unless the user turned on "Keep receipt" (then only the thumbnail stays).
export interface CaptureOriginal {
  kind: 'image' | 'pdf' | 'text';
  thumb?: string; // data URL of a small JPEG
  text?: string; // the (minimized) text that was read
  name?: string;
  bytes?: number;
}

interface QueueItem {
  draftId: string; // the 'queued' placeholder this item will replace
  source: CaptureSource;
  payload: CapturePayload;
  fingerprint?: string;
  original: CaptureOriginal;
  meta?: { sender?: string; sentAt?: string; messageId?: string };
  createdAt: string;
}

export interface CapturePrefs {
  saveReceipts: boolean;
  mailEnabled: boolean;
  mailFilter: { senders: string[]; subjectWords: string[] };
  includePdf: boolean;
  lastMailScan?: string;
  notificationsEnabled: boolean; // bank-app notifications on this phone become drafts (Android only)
}

export const DEFAULT_CAPTURE_PREFS: CapturePrefs = { saveReceipts: false, mailEnabled: false, mailFilter: { senders: [], subjectWords: [] }, includePdf: false, notificationsEnabled: false };

export type SubmitResult = { ok: true; drafts: CaptureDraft[]; queued?: boolean } | { ok: false; code: AiFailure | 'unreadable' | 'write' };

// What happened to one bank notification: a new draft, ignored because it is not a movement, or already handled
export type NotificationOutcome = 'draft' | 'skipped' | 'seen' | 'error';

export type ApproveResult = { ok: true; movementIds: string[] } | { ok: false; missing: MissingField[] } | { ok: false; error: string };

const INCOME_CATEGORY: Record<string, string> = { payroll: 'cat-salary', 'bonus-commission': 'cat-salary', freelance: 'cat-freelance' };

// Smart capture: from a document, a transcript or an email to DRAFTS, and from an approved draft to
// movements through the same services as every other entry point (rule 11). Nothing in here writes a
// movement without approve(), and approve() is only reachable from the user's explicit action.
@Injectable({ providedIn: 'root' })
export class CaptureService {
  private _prefs = signal<CapturePrefs>(DEFAULT_CAPTURE_PREFS);
  prefs = this._prefs.asReadonly();
  private _busy = signal(false);
  busy = this._busy.asReadonly();
  queueSize = computed(() => this.drafts.queued().length);
  private running: Promise<number> | null = null;

  clock: () => Date = () => new Date();

  constructor(
    private storage: StorageService,
    readonly drafts: CaptureDraftService,
    private ai: AiService,
    private accounts: AccountService,
    private categories: CategoryService,
    private sources: IncomeSourceService,
    private rules: TextRuleService,
    private transactions: TransactionService,
    private cards: CreditCardService,
    private goals: GoalService,
    private loans: LoanService,
    private business: BusinessService,
    private audit: AuditLogService,
    private translate: TranslateService,
    private reconciliation: ReconciliationService
  ) {
    const saved = this.storage.get<Partial<CapturePrefs>>('capture-prefs', {});
    this._prefs.set({ ...DEFAULT_CAPTURE_PREFS, ...saved, mailFilter: { ...DEFAULT_CAPTURE_PREFS.mailFilter, ...(saved.mailFilter ?? {}) } });
    if (typeof window !== 'undefined') window.addEventListener('online', () => void this.processQueue());
  }

  setPrefs(patch: Partial<CapturePrefs>): void {
    const next = { ...this._prefs(), ...patch };
    this._prefs.set(next);
    this.storage.set('capture-prefs', next);
  }

  // ---------- context for the pure builders (the user's own data, never sent anywhere)

  private bankNameOf = (a: { bankId?: string }): string => bankById(a.bankId)?.name ?? '';

  private categoryByName = (name: string): string | undefined => {
    const n = normalizeMerchant(name);
    if (!n) return undefined;
    return this.categories.categories().find((c) => c.type === 'expense' && !c.system && [c.name, this.translate.instant(c.name)].some((x) => normalizeMerchant(x) === n))?.id;
  };

  private categoryFor = (text: string): string | undefined => {
    const target = this.rules.match(text, 'expense')?.target;
    return target && this.categories.byId(target) ? target : undefined;
  };

  private incomeSourceFor = (text: string): string | undefined => {
    const target = this.rules.match(text, 'income-source')?.target;
    if (target && this.sources.byId(target)?.active) return target;
    const words = new Set(normalizeMerchant(text).split(' ').filter((w) => w.length >= 3));
    const hit = this.sources.active().filter((s) => normalizeMerchant(s.name).split(' ').some((w) => w.length >= 3 && words.has(w)));
    if (hit.length === 1) return hit[0].id; // exactly one, never the closest
    // "PAGO NOMINA 1RA DE..." names no source of the user, but it IS the payroll: with exactly one payroll source, that is it
    if (!hit.length && isPayroll(text)) {
      const payroll = this.sources.active().filter((s) => s.kind === 'payroll');
      if (payroll.length === 1) return payroll[0].id;
    }
    return undefined;
  };

  // The usual amount of an income source: what it says it pays (expected net), else its last deposit. Never a truth, only a suggestion.
  private usualIncomeMinor = (sourceId: string): number | undefined => {
    const expected = this.sources.byId(sourceId)?.expectedNet;
    if (expected && expected > 0) return Math.round(expected * 100);
    const last = this.transactions
      .transactions()
      .filter((t) => t.type === 'income' && t.incomeSourceId === sourceId && t.status !== 'reversed' && !t.reversalOf)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return last ? Math.round(last.amount * 100) : undefined;
  };

  // 2.25.1 read every LINE of a bank e-mail on its own (a card ending, a phone number, a day became amounts). Those drafts are
  // gone and their messages are read again with the right reader. Only the drafts of that reader, only pending ones, once.
  repairLegacyEmailDrafts(): number {
    if (this.storage.get<boolean>('capture-legacy-email-repaired', false)) return 0;
    const bad = this.drafts.drafts().filter((d) => d.source === 'email' && (d.status === 'pending' || d.status === 'duplicate') && d.notes === 'Read on this device, without AI: check every field.');
    const n = this.drafts.remove(bad.map((d) => d.id));
    this.estimateWaitingIncome();
    this.storage.set('capture-legacy-email-repaired', true);
    return n;
  }

  // A payroll notice ("Payroll deposit credited...") has no amount because the notice has none. A waiting income draft with no amount
  // whose source is known (or is the only payroll source) gets that source's usual amount, as a marked ESTIMATE. It runs whenever the
  // sources change, so creating the payroll source also settles the notices that were already waiting. Returns how many it settled.
  estimateWaitingIncome(): number {
    let done = 0;
    for (const d of this.drafts.pending()) {
      if (d.kind !== 'income' || d.amountMinor || d.status !== 'pending') continue;
      const sourceId = d.resolvedIncomeSourceId ?? this.incomeSourceFor([d.counterparty, d.description].filter(Boolean).join(' '));
      const usual = sourceId ? this.usualIncomeMinor(sourceId) : undefined;
      if (!sourceId || !usual) continue;
      this.drafts.update(d.id, { resolvedIncomeSourceId: sourceId, amountMinor: usual, doubts: [...d.doubts.filter((x) => x !== 'amount-missing'), 'amount-estimated'], confidence: { ...d.confidence, amount: 0.3 } });
      done++;
    }
    return done;
  }

  private build(raw: RawTransaction[], source: CaptureSource, extra: { text?: string; fingerprint?: string; meta?: QueueItem['meta'] }): CaptureDraft[] {
    const now = this.clock();
    // the tax a bank prints in its own notice ("Impuestos: DOP 4.00") is read from the text when the reader did not
    // return it; only when the text holds ONE movement, so a tax is never attached to the wrong one
    const localTax = raw.length === 1 && extra.text ? bankTaxInText(extra.text) : undefined;
    // a list of movements: the bank's tax rows are folded into the movement they were charged on
    return foldBankCharges(raw).map((r0) => {
      const r = localTax && !r0.bankFeeText ? { ...r0, bankFeeText: localTax } : r0;
      const draft = buildDraft(r, {
        source,
        today: localIso(now),
        nowIso: now.toISOString(),
        newId: () => crypto.randomUUID(),
        accounts: this.accounts.accounts(),
        bankNameOf: this.bankNameOf,
        goals: this.goals.goals().filter((g) => g.status === 'active'),
        loans: this.loans.active(),
        categoryFor: this.categoryFor,
        categoryByName: this.categoryByName,
        incomeSourceFor: this.incomeSourceFor,
        usualIncomeMinor: this.usualIncomeMinor,
        bankIdOf: (name) => bankIdOf(name, BANKS_MOCK),
        text: extra.text,
        fileFingerprint: extra.fingerprint,
        sender: extra.meta?.sender,
        sentAt: extra.meta?.sentAt,
        messageId: extra.meta?.messageId,
      });
      return this.markDuplicate(draft);
    });
  }

  private markDuplicate(draft: CaptureDraft): CaptureDraft {
    const match = findDuplicate(draft, this.drafts.drafts(), this.transactions.transactions(), this.accounts.accounts());
    if (!match) return draft;
    // exige una decisión explícita: it waits as 'duplicate' until the user discards or registers it anyway
    return { ...draft, status: 'duplicate', duplicateOf: match.of, doubts: draft.doubts.includes('possible-duplicate') ? draft.doubts : [...draft.doubts, 'possible-duplicate'] };
  }

  // ---------- originals (device only)

  private originals(): Record<string, CaptureOriginal> {
    return this.storage.get<Record<string, CaptureOriginal>>('capture-originals', {});
  }

  originalOf(draftId: string): CaptureOriginal | undefined {
    return this.originals()[draftId];
  }

  private saveOriginal(ids: string[], original: CaptureOriginal): void {
    const all = this.originals();
    for (const id of ids) all[id] = original;
    this.storage.set('capture-originals', all);
  }

  // After approving or rejecting: the file goes away; only the thumbnail may stay (an approved draft, "Keep receipt")
  private releaseOriginal(draft: CaptureDraft, keepThumb: boolean): void {
    const all = this.originals();
    const o = all[draft.id];
    if (!o) return;
    if (keepThumb && o.thumb) {
      all[draft.id] = { kind: o.kind, thumb: o.thumb, name: o.name };
      this.drafts.update(draft.id, { hasReceipt: true });
    } else {
      delete all[draft.id];
    }
    this.storage.set('capture-originals', all);
  }

  // ---------- the queue of captures made without connection

  private queue(): QueueItem[] {
    return this.storage.get<QueueItem[]>('capture-queue', []);
  }

  private setQueue(list: QueueItem[]): void {
    this.storage.set('capture-queue', list);
  }

  // ---------- entry: one capture

  // `fingerprint`: hash of the ORIGINAL file (the same file twice is caught before any call is spent)
  async submit(input: { source: CaptureSource; payload: CapturePayload; original: CaptureOriginal; fingerprint?: string; meta?: QueueItem['meta'] }): Promise<SubmitResult> {
    if (this.storage.readOnly()) return { ok: false, code: 'write' };
    const { source, payload, original, fingerprint, meta } = input;
    const text = payload.mode === 'text' ? payload.text : undefined;

    if (fingerprint) {
      const same = this.drafts.drafts().find((d) => d.fileFingerprint === fingerprint && d.status !== 'rejected' && d.status !== 'failed');
      if (same) {
        const dup: CaptureDraft = { id: crypto.randomUUID(), createdAt: this.clock().toISOString(), source, status: 'duplicate', kind: 'unknown', confidence: {}, doubts: ['possible-duplicate'], fileFingerprint: fingerprint, duplicateOf: { type: 'draft', id: same.id }, notes: 'This is the same file as an earlier capture.' };
        this.drafts.add(dup);
        this.saveOriginal([dup.id], original);
        return { ok: true, drafts: [dup] };
      }
    }

    const p = this.ai.prefs();
    const aiOn = p.documentsEnabled && !!p.documentsConsentAt;
    if (!aiOn) {
      // the alternative with no AI: a sentence is read on the device; an image or a PDF cannot be
      if (payload.mode !== 'text') return { ok: false, code: 'documents-off' };
      return this.finishLocal(text!, source, original, fingerprint, meta);
    }
    if (this.ai.captureStatus() === 'offline') return this.enqueue(input);

    const result = await this.ai.run(CAPTURE_FEATURE_ID, payload);
    if (!result.ok) {
      if (result.code === 'offline') return this.enqueue(input);
      // a sentence still has the local reading; a document does not
      if (payload.mode === 'text' && result.code !== 'invalid-output') return this.finishLocal(text!, source, original, fingerprint, meta);
      return { ok: false, code: result.code };
    }
    const parsed = parseCaptureOutput(result.raw);
    if (!parsed.ok) return { ok: false, code: 'invalid-output' };
    return this.finish(this.build(parsed.value.items, source, { text, fingerprint, meta }), original, parsed.value.notes);
  }

  private finishLocal(text: string, source: CaptureSource, original: CaptureOriginal, fingerprint?: string, meta?: QueueItem['meta']): SubmitResult {
    if (source === 'email') {
      // a bank e-mail is ONE notice, never a list of lines (a phone number or a card ending is not a movement)
      const sent = meta?.sentAt ? Date.parse(meta.sentAt) : NaN;
      const one = readBankText({ text, bankName: bankOfSender(meta?.sender), dateIso: Number.isFinite(sent) ? localDateOf(sent) : localIso(this.clock()) });
      return one ? this.finish(this.build([one], source, { text, fingerprint, meta }), original) : { ok: false, code: 'unreadable' };
    }
    const raw = readTextLocally(text);
    return this.finish(this.build(raw, source, { text, fingerprint, meta }), original);
  }

  private finish(list: CaptureDraft[], original: CaptureOriginal, notes?: string): SubmitResult {
    if (!list.length) return { ok: false, code: 'unreadable' };
    const withNotes = notes ? list.map((d) => ({ ...d, notes: d.notes ?? notes })) : list;
    for (const d of withNotes) this.drafts.add(d);
    this.saveOriginal(withNotes.map((d) => d.id), original);
    this.linkPairs();
    return { ok: true, drafts: withNotes.map((n) => this.drafts.byId(n.id) ?? n) }; // as read, with the pair flags
  }

  // ---------- both sides of one transfer

  // Marks the pending drafts that look like the two sides of the same transfer. Idempotent; it only flags, it never combines.
  linkPairs(): number {
    let linked = 0;
    const all = this.drafts.pending();
    for (const first of all) {
      const d = this.drafts.byId(first.id); // fresh: an earlier turn of this loop may have flagged it
      if (!d || d.pairedWith) continue;
      const other = findTransferPair(d, all);
      const fresh = other ? this.drafts.byId(other.id) : undefined;
      if (!other || !fresh || fresh.pairedWith) continue;
      for (const [a, b] of [[d, fresh], [fresh, d]] as const) {
        this.drafts.update(a.id, { pairedWith: b.id, doubts: a.doubts.includes('transfer-pair') ? a.doubts : [...a.doubts, 'transfer-pair'] });
      }
      linked++;
    }
    return linked;
  }

  // The user's tap: the two sides become ONE transfer (or card payment). The absorbed side goes to the history as rejected.
  combineAsTransfer(id: string): boolean {
    const a = this.drafts.byId(id);
    const b = a?.pairedWith ? this.drafts.byId(a.pairedWith) : undefined;
    if (!a || !b || a.status !== 'pending' || b.status !== 'pending') return false;
    const plan = combinePatch(a, b);
    if (!plan) return false;
    if (!this.edit(plan.keep, plan.patch)) return false;
    this.drafts.update(plan.absorb, { pairedWith: undefined, notes: 'Combined with the other side of the same transfer.' });
    this.reject(plan.absorb);
    return true;
  }

  // The user says these are not the same transfer: the flag goes away and is not raised again for this pair
  unpair(id: string): void {
    const a = this.drafts.byId(id);
    if (!a?.pairedWith) return;
    const other = this.drafts.byId(a.pairedWith);
    for (const d of [a, other]) if (d) this.drafts.update(d.id, { pairedWith: undefined, doubts: d.doubts.filter((x) => x !== 'transfer-pair'), notPairedWith: [...(d.notPairedWith ?? []), d === a ? a.pairedWith! : a.id] });
  }

  private enqueue(input: { source: CaptureSource; payload: CapturePayload; original: CaptureOriginal; fingerprint?: string; meta?: QueueItem['meta'] }): SubmitResult {
    const queue = this.queue();
    if (queue.length >= 10) return { ok: false, code: 'offline' }; // a bounded queue: the device storage is not a mailbox
    const now = this.clock().toISOString();
    const placeholder: CaptureDraft = { id: crypto.randomUUID(), createdAt: now, source: input.source, status: 'queued', kind: 'unknown', confidence: {}, doubts: [], fileFingerprint: input.fingerprint, messageId: input.meta?.messageId, sender: input.meta?.sender, sentAt: input.meta?.sentAt };
    this.drafts.add(placeholder);
    this.setQueue([...queue, { draftId: placeholder.id, source: input.source, payload: input.payload, fingerprint: input.fingerprint, original: input.original, meta: input.meta, createdAt: now }]);
    this.saveOriginal([placeholder.id], input.original);
    return { ok: true, drafts: [placeholder], queued: true };
  }

  // Runs the captures that waited for the connection; the placeholder is replaced by the real drafts
  // Re-entrant: when the connection returns (the 'online' event) and a screen asks at the same time,
  // both get the SAME run, so a capture is never read twice
  processQueue(): Promise<number> {
    if (this.running) return this.running;
    if (this.ai.captureStatus() !== 'ready') return Promise.resolve(0);
    this.running = this.drain().finally(() => (this.running = null));
    return this.running;
  }

  private async drain(): Promise<number> {
    let done = 0;
    {
      for (const item of this.queue()) {
        if (this.ai.captureStatus() !== 'ready') break;
        const placeholder = this.drafts.byId(item.draftId);
        if (!placeholder || placeholder.status !== 'queued') {
          this.setQueue(this.queue().filter((q) => q.draftId !== item.draftId));
          continue;
        }
        const result = await this.ai.run(CAPTURE_FEATURE_ID, item.payload);
        if (!result.ok && (result.code === 'offline' || result.code === 'timeout' || result.code === 'provider_error' || result.code === 'rate_limited')) break; // try again later
        this.setQueue(this.queue().filter((q) => q.draftId !== item.draftId));
        const parsed = result.ok ? parseCaptureOutput(result.raw) : null;
        if (!result.ok || !parsed || !parsed.ok) {
          this.drafts.update(item.draftId, { status: 'failed', failure: result.ok ? 'invalid-output' : result.code });
          continue;
        }
        const text = item.payload.mode === 'text' ? item.payload.text : undefined;
        const list = this.build(parsed.value.items, item.source, { text, fingerprint: item.fingerprint, meta: item.meta });
        this.dropPlaceholder(item.draftId);
        this.finish(list, item.original, parsed.value.notes);
        done++;
      }
    }
    return done;
  }

  private dropPlaceholder(id: string): void {
    // a placeholder is not a proposal: it is replaced, so it leaves the list instead of becoming history
    const all = this.originals();
    delete all[id];
    this.storage.set('capture-originals', all);
    this.drafts.drop(id);
  }

  // ---------- the tray: edit, approve, reject

  // Drafts that were waiting for an account that did not exist yet get it now (a card added after its notice
  // arrived). Only empty accounts are filled, only when exactly one account fits; returns how many were settled.
  rematch(): number {
    let done = 0;
    for (const d of this.drafts.pending()) {
      const patch = rematchAccount(d, this.accounts.accounts(), this.bankNameOf);
      if (patch && this.edit(d.id, patch)) done++;
    }
    return done;
  }

  edit(id: string, patch: Partial<CaptureDraft>): CaptureDraft | undefined {
    const current = this.drafts.byId(id);
    if (!current || current.status === 'approved') return undefined;
    const merged = { ...current, ...patch };
    // a field the user fixed is no longer in doubt
    const doubts = new Set(merged.doubts);
    if (patch.amountMinor !== undefined) {
      doubts.delete('amount-estimated');
      doubts.delete('amount-missing');
      doubts.delete('amount-unverified');
    }
    if (patch.currency) doubts.delete('currency-ambiguous');
    if (patch.occurredAt) {
      doubts.delete('date-missing');
      doubts.delete('date-assumed');
      doubts.delete('date-future');
    }
    if (patch.resolvedAccountId || patch.resolvedToAccountId) {
      doubts.delete('account-ambiguous');
      doubts.delete('account-missing');
    }
    if (patch.kind && patch.kind !== 'unknown') {
      doubts.delete('kind-unknown');
      doubts.delete('kind-inferred');
      doubts.delete('direction-conflict');
    }
    const dedupe = dedupeKey(merged);
    return this.drafts.update(id, { ...patch, doubts: [...doubts], dedupeKey: dedupe });
  }

  reject(id: string): boolean {
    const d = this.drafts.byId(id);
    if (!d || d.status === 'approved') return false;
    this.drafts.update(id, { status: 'rejected', reviewedAt: this.clock().toISOString() });
    this.releaseOriginal(d, false);
    return true;
  }

  // The user looked at the duplicate warning and wants it registered anyway: it becomes a normal pending draft
  registerAnyway(id: string): boolean {
    const d = this.drafts.byId(id);
    if (!d || d.status !== 'duplicate') return false;
    this.drafts.update(id, { status: 'pending', duplicateOf: undefined, fileFingerprint: undefined, doubts: d.doubts.filter((x) => x !== 'possible-duplicate') });
    return true;
  }

  // Approve ONE draft. Only the user's tap reaches this; there is no "approve all" without a selection.
  approve(id: string, options: { confirmLarge?: boolean } = {}): ApproveResult {
    if (this.storage.readOnly()) return { ok: false, error: 'read-only' };
    const d = this.drafts.byId(id);
    if (!d) return { ok: false, error: 'not-found' };
    if (d.status === 'duplicate') return { ok: false, error: 'duplicate-decision' }; // needs the explicit decision first
    if (d.status !== 'pending') return { ok: false, error: 'not-pending' };
    // what was bought goes with the movement: the draft's own, plus whatever the other drafts of the same purchase have and this one lacks
    const details = purchaseDetailsOf(d, this.drafts.drafts(), (id) => this.originalOf(id)?.text);
    const plan = planApproval(d, { accounts: this.accounts.accounts(), confirmLarge: options.confirmLarge, defaultIncomeCategory: (sid) => this.incomeCategory(sid), details });
    if (!plan.ok) return { ok: false, missing: plan.missing };
    const ids: string[] = [];
    for (const op of plan.ops) {
      const r = this.run(op);
      if (!r.ok) return { ok: false, error: r.error };
      ids.push(r.id);
    }
    for (const mid of ids) {
      this.audit.log({ type: 'create', entity: op0Entity(plan.ops[0]), entityId: mid.replace(/^account:/, ''), origin: `capture:${d.source}`, after: { draftId: d.id, source: d.source } });
    }
    this.drafts.update(id, { status: 'approved', createdMovementIds: ids, reviewedAt: this.clock().toISOString() });
    this.learn(d);
    this.releaseOriginal(d, this._prefs().saveReceipts);
    return { ok: true, movementIds: ids };
  }

  // A batch of the ones the user marked, never everything. Each one is independent: one that cannot
  // be approved is reported and left waiting.
  approveMany(ids: readonly string[]): { approved: string[]; blocked: { id: string; reason: ApproveResult }[] } {
    const approved: string[] = [];
    const blocked: { id: string; reason: ApproveResult }[] = [];
    for (const id of ids) {
      const r = this.approve(id);
      if (r.ok) approved.push(id);
      else blocked.push({ id, reason: r });
    }
    return { approved, blocked };
  }

  private incomeCategory(sourceId: string | undefined): string {
    const kind = sourceId ? this.sources.byId(sourceId)?.kind : undefined;
    return (kind && INCOME_CATEGORY[kind]) || 'cat-other-income';
  }

  private learn(d: CaptureDraft): void {
    const who = d.counterparty ?? d.description;
    if (!who) return;
    if ((d.kind === 'expense' || d.kind === 'invoice_purchase') && d.resolvedCategoryId) this.rules.learn('expense', who, d.resolvedCategoryId);
    if (d.kind === 'income' && d.resolvedIncomeSourceId) this.rules.learn('income-source', who, d.resolvedIncomeSourceId);
  }

  // One operation through the same function every other entry point uses
  private run(op: CaptureOp): { ok: true; id: string } | { ok: false; error: string } {
    switch (op.t) {
      case 'new-account': {
        // the account of a screenshot: its balance is the OPENING balance, no movement is written
        const a = op.account;
        const id = this.accounts.add({
          name: a.name,
          type: a.type,
          cardKind: a.cardKind,
          bankKind: a.bankKind,
          bankId: a.bankId,
          last4: a.last4,
          currency: a.currency,
          initialBalance: a.initialBalance,
          card: a.creditLimit ? (a.currency === 'USD' ? { creditLimitUsd: a.creditLimit } : { creditLimit: a.creditLimit }) : undefined,
        });
        return { ok: true, id: 'account:' + id };
      }
      case 'balance-check': {
        // the app's own figure is never edited: a difference becomes a visible, audited adjustment (the same one as Reconcile)
        const view = this.reconciliation.view(op.accountId, op.currency, op.date, op.bankBalance);
        const adj = this.reconciliation.createAdjustment(op.accountId, op.currency, op.date, view.difference);
        if (adj && !adj.ok) return { ok: false, error: adj.error };
        this.accounts.setReconciledAt(op.accountId, op.date);
        return { ok: true, id: 'account:' + op.accountId };
      }
      case 'transaction': {
        const r = this.transactions.add({ ...op.tx });
        return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error };
      }
      case 'card-payment': {
        const r = this.cards.pay({ cardId: op.cardId, fromAccountId: op.fromAccountId, amount: op.amount, date: op.date, currency: op.currency, note: op.note, fee: op.fee });
        return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error };
      }
      case 'goal-entry': {
        const r = this.goals.addEntry(op.goalId, { type: 'contribution', amount: op.amount, date: op.date, note: op.note });
        return r.ok ? { ok: true, id: `${op.goalId}:${r.id}` } : { ok: false, error: r.error };
      }
      case 'loan-payment': {
        const r = this.loans.pay(op.loanId, { amount: op.amount, date: op.date, accountId: op.accountId, note: op.note });
        return r.ok ? { ok: true, id: `${op.loanId}:${r.id}` } : { ok: false, error: String(r.error) };
      }
      case 'business-purchase': {
        const r = this.business.addOperation({ name: op.name, category: 'other', totalCost: op.totalCost, acquiredAt: op.date, accountId: op.accountId, supplier: op.supplier, notes: op.notes, quantity: 1 });
        return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error };
      }
    }
  }


  // A notification a bank app posted on the phone. Read on the device with no AI and no network: the
  // wording of bank notices is fixed enough, and what cannot be read is left empty for the tray. It is
  // ONLY a draft (rule 11); the same notification is never turned into a second draft, even after the
  // first one was rejected.
  ingestNotification(n: BankNotification & { id: string }): NotificationOutcome {
    if (this.storage.readOnly()) return 'error';
    const messageId = `notification:${n.id}`;
    if (this.drafts.hasMessage(messageId)) return 'seen';
    const raw = readBankNotification(n);
    if (!raw) return 'skipped';
    const text = minimizeText(`${n.title}
${n.text}`.trim());
    const meta = { sender: raw.bankName, sentAt: new Date(n.postedAt).toISOString(), messageId };
    const result = this.finish(this.build([raw], 'notification', { text, meta }), { kind: 'text', text });
    return result.ok ? 'draft' : 'error';
  }

  // ---------- text entry points

  // A voice transcript or pasted text. The text is reduced first (signature, legal footer, long numbers).
  async captureText(text: string, source: 'voice' | 'text' = 'text'): Promise<SubmitResult> {
    const reduced = minimizeText(text);
    if (!reduced) return { ok: false, code: 'unreadable' };
    return this.submit({ source, payload: { mode: 'text', text: reduced }, original: { kind: 'text', text: reduced } });
  }
}

const op0Entity = (op: CaptureOp): 'transaction' | 'goal' | 'loan' | 'business' | 'account' => (op.t === 'new-account' || op.t === 'balance-check' ? 'account' : op.t === 'goal-entry' ? 'goal' : op.t === 'loan-payment' ? 'loan' : op.t === 'business-purchase' ? 'business' : 'transaction');
