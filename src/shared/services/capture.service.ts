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
import { BankNotification, readBankNotification } from '../domain/capture/notification';
import { dedupeKey, findDuplicate, normalizeMerchant } from '../domain/capture/merchant';
import { CaptureOp, MissingField, planApproval } from '../domain/capture/plan';
import { RawTransaction, parseCaptureOutput } from '../domain/capture/schema';
import { localIso } from '../domain/dates';
import { AccountService } from './account.service';
import { AuditLogService } from './audit-log.service';
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
    private translate: TranslateService
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
    return hit.length === 1 ? hit[0].id : undefined; // exactly one, never the closest
  };

  private build(raw: RawTransaction[], source: CaptureSource, extra: { text?: string; fingerprint?: string; meta?: QueueItem['meta'] }): CaptureDraft[] {
    const now = this.clock();
    return raw.map((r) => {
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
    const raw = readTextLocally(text);
    return this.finish(this.build(raw, source, { text, fingerprint, meta }), original);
  }

  private finish(list: CaptureDraft[], original: CaptureOriginal, notes?: string): SubmitResult {
    if (!list.length) return { ok: false, code: 'unreadable' };
    const withNotes = notes ? list.map((d) => ({ ...d, notes: d.notes ?? notes })) : list;
    for (const d of withNotes) this.drafts.add(d);
    this.saveOriginal(withNotes.map((d) => d.id), original);
    return { ok: true, drafts: withNotes };
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

  edit(id: string, patch: Partial<CaptureDraft>): CaptureDraft | undefined {
    const current = this.drafts.byId(id);
    if (!current || current.status === 'approved') return undefined;
    const merged = { ...current, ...patch };
    // a field the user fixed is no longer in doubt
    const doubts = new Set(merged.doubts);
    if (patch.amountMinor !== undefined) {
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
    if (patch.kind && patch.kind !== 'unknown') doubts.delete('kind-unknown');
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

const op0Entity = (op: CaptureOp): 'transaction' | 'goal' | 'loan' | 'business' | 'account' => (op.t === 'new-account' ? 'account' : op.t === 'goal-entry' ? 'goal' : op.t === 'loan-payment' ? 'loan' : op.t === 'business-purchase' ? 'business' : 'transaction');
