import { Component, HostListener, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { AiService } from '../../../shared/ai/ai.service';
import { AiFailure } from '../../../shared/ai/ai.types';
import { SpeechService } from '../../../shared/capture/speech.service';
import { ShareReceiverService } from '../../../shared/capture/share-receiver.service';
import { Prepared, prepareFile } from '../../../shared/capture/prepare';
import { CaptureSource } from '../../../shared/models/capture-draft.model';
import { MAX_FILES_AT_ONCE, MAX_TEXT_CHARS, Redaction, clampRedaction } from '../../../shared/domain/capture/files';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { CaptureService } from '../../../shared/services/capture.service';
import { TranslateService } from '../../../shared/services/translate.service';

interface Item {
  id: number;
  file?: Blob & { name?: string };
  text?: string;
  source: CaptureSource;
  preview?: string; // data URL of the image as it will be sent (with the black boxes)
  redactions: Redaction[];
  kind: 'image' | 'pdf' | 'text';
  name: string;
}

const REASONS: Record<string, string> = {
  empty: 'The file is empty.',
  unsupported: 'That file type is not supported. Use a JPEG, PNG or WebP image, or a PDF.',
  'too-large': 'The file is too large (5 MB at most). Crop it or take a smaller picture.',
  'too-many-pages': 'The PDF has more than 10 pages. Send only the pages you need.',
  malformed: 'The PDF could not be read.',
  decode: 'The image could not be opened.',
};

// "Capture": the single entry point. Image (gallery, camera, paste, drop), PDF, pasted text, voice.
// Every capture shows what will be sent before sending (unless the user asked to hide that step) and
// produces DRAFTS for the review tray: nothing is registered here.
@Component({
  selector: 'app-capture',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './capture.html',
  styleUrl: './capture.scss',
})
export class CaptureComponent implements OnInit, OnDestroy {
  items = signal<Item[]>([]);
  text = signal('');
  message = signal('');
  notice = signal('');
  sending = signal(false);
  listening = signal(false);
  voiceAvailable = signal(false);
  dragging = signal(false);
  private nextId = 1;
  private unsubscribe: (() => void) | null = null;

  documentsOn = computed(() => !!this.ai.prefs().documentsEnabled);
  maxChars = MAX_TEXT_CHARS;

  constructor(
    public ai: AiService,
    public capture: CaptureService,
    private speech: SpeechService,
    private share: ShareReceiverService,
    private translate: TranslateService
  ) {}

  async ngOnInit(): Promise<void> {
    this.voiceAvailable.set(Capacitor.isNativePlatform() || (await this.speech.available()));
    await this.takeShared();
    this.unsubscribe = this.share.onShared(() => void this.takeShared());
    void this.capture.processQueue();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
    this.speech.stop();
  }

  // ----- inputs

  private async takeShared(): Promise<void> {
    const { shareHandoff } = await import('../../../shared/capture/share-handoff');
    const shared = [...shareHandoff.items.splice(0), ...(await this.share.pending())];
    for (const s of shared) {
      if (s.kind === 'text' && s.text) this.text.set((this.text() + '\n' + s.text).trim().slice(0, MAX_TEXT_CHARS));
      else if (s.base64) await this.add(this.fromBase64(s.base64, s.mimeType, s.name), 'image');
    }
    if (shared.length) this.notice.set(this.translate.instant('Shared content received. Check it and send it to be read.'));
  }

  private fromBase64(b64: string, type: string, name?: string): Blob & { name?: string } {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return Object.assign(new Blob([bytes], { type }), { name });
  }

  async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // The picker only grants access to the files while the input holds them: read every one NOW (the reads start
    // together), and only then clear the input. Reading them one by one made the second image fail (NotReadableError).
    const reads = files.map((f) => f.arrayBuffer().then((b) => new File([b], f.name, { type: f.type })).catch(() => null));
    input.value = '';
    const copies = (await Promise.all(reads)).filter((f): f is File => f !== null);
    if (copies.length < files.length) this.message.set(this.translate.instant('Some files could not be read. Pick them again.'));
    await this.addMany(copies);
  }

  @HostListener('document:paste', ['$event'])
  async onPaste(event: ClipboardEvent): Promise<void> {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length) {
      event.preventDefault();
      await this.addMany(files);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragging.set(false);
    await this.addMany(Array.from(event.dataTransfer?.files ?? []));
  }

  private async addMany(files: File[]): Promise<void> {
    this.message.set('');
    for (const f of files) {
      if (this.items().length >= MAX_FILES_AT_ONCE) {
        this.message.set(this.translate.instant('At most 10 files at a time.'));
        break;
      }
      await this.add(f, 'image');
    }
    // "do not ask again" hides the preview: the files go straight away
    if (this.ai.prefs().skipPreview && this.items().length && this.documentsOn()) await this.sendAll();
  }

  private async add(file: Blob & { name?: string }, source: CaptureSource): Promise<void> {
    const prepared = await prepareFile(file);
    if (!prepared.ok) {
      this.message.set(this.translate.instant(REASONS[prepared.reason] ?? REASONS['decode']));
      return;
    }
    const kind = prepared.original.kind === 'pdf' ? 'pdf' : 'image';
    const item: Item = { id: this.nextId++, file, source: kind === 'pdf' ? 'pdf' : source, kind, name: file.name || (kind === 'pdf' ? 'document.pdf' : 'image'), redactions: [] };
    if (kind === 'image') item.preview = prepared.original.thumb;
    this.items.update((l) => [...l, item]);
  }

  // ----- redaction: draw black boxes on the preview before sending

  // Drawing only happens inside the full-screen cover editor, never on the thumbnail: dragging on the list
  // has to scroll the page, and a stray swipe must not hide part of the image.
  covering = signal<number | null>(null);
  live = signal<Redaction | null>(null); // the box being dragged, shown while the finger moves
  coverItem = computed(() => this.items().find((i) => i.id === this.covering()) ?? null);
  private drag: { id: number; x: number; y: number; box: DOMRect } | null = null;

  openCover(item: Item): void {
    this.covering.set(item.id);
  }

  closeCover(): void {
    this.cancelBox();
    this.covering.set(null);
  }

  startBox(event: PointerEvent, item: Item): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.drag = { id: item.id, x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height, box };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  private rectTo(event: PointerEvent): Redaction | null {
    const d = this.drag;
    if (!d) return null;
    const x2 = (event.clientX - d.box.left) / d.box.width;
    const y2 = (event.clientY - d.box.top) / d.box.height;
    return clampRedaction({ x: Math.min(d.x, x2), y: Math.min(d.y, y2), w: Math.abs(x2 - d.x), h: Math.abs(y2 - d.y) });
  }

  moveBox(event: PointerEvent): void {
    if (this.drag) this.live.set(this.rectTo(event));
  }

  cancelBox(): void {
    this.drag = null;
    this.live.set(null);
  }

  endBox(event: PointerEvent, item: Item): void {
    const d = this.drag;
    const r = d && d.id === item.id ? this.rectTo(event) : null;
    this.cancelBox();
    if (r) this.items.update((l) => l.map((i) => (i.id === item.id ? { ...i, redactions: [...i.redactions, r] } : i)));
  }

  undoBox(item: Item): void {
    this.items.update((l) => l.map((i) => (i.id === item.id ? { ...i, redactions: i.redactions.slice(0, -1) } : i)));
  }

  clearBoxes(item: Item): void {
    this.items.update((l) => l.map((i) => (i.id === item.id ? { ...i, redactions: [] } : i)));
  }

  remove(item: Item): void {
    this.items.update((l) => l.filter((i) => i.id !== item.id));
  }

  // ----- voice and text

  async dictate(): Promise<void> {
    this.message.set('');
    this.listening.set(true);
    try {
      const heard = await this.speech.listen();
      this.text.set((this.text() + ' ' + heard).trim().slice(0, MAX_TEXT_CHARS)); // shown, editable, nothing sent yet
    } catch (e) {
      const code = (e as Error).message;
      this.message.set(this.translate.instant(code === 'denied' ? 'Microphone access was denied. You can enable it in the settings of your phone, or type the sentence (the keyboard has a microphone too).' : code === 'no-speech' ? 'Nothing was heard. Try again or type it.' : code === 'aborted' ? '' : 'Voice is not available here. Type the sentence: the keyboard has a microphone.'));
    } finally {
      this.listening.set(false);
    }
  }

  stopDictating(): void {
    this.speech.stop();
  }

  // ----- sending (one explicit action)

  async sendAll(): Promise<void> {
    if (this.sending()) return;
    this.sending.set(true);
    this.message.set('');
    this.notice.set('');
    let drafts = 0;
    let queued = 0;
    const failures: string[] = [];
    try {
      for (const item of [...this.items()]) {
        const prepared: Prepared | null = item.file ? await prepareFile(item.file, item.redactions) : null;
        if (!prepared || !prepared.ok) {
          failures.push(this.translate.instant(REASONS[prepared && !prepared.ok ? prepared.reason : 'decode'] ?? REASONS['decode']));
          continue;
        }
        const r = await this.capture.submit({ source: item.kind === 'pdf' ? 'pdf' : 'image', payload: prepared.payload, original: prepared.original, fingerprint: prepared.fingerprint });
        if (r.ok) {
          drafts += r.queued ? 0 : r.drafts.length;
          queued += r.queued ? 1 : 0;
          this.remove(item);
        } else failures.push(this.reason(r.code));
      }
      if (this.text().trim()) {
        const r = await this.capture.captureText(this.text(), 'text');
        if (r.ok) {
          drafts += r.queued ? 0 : r.drafts.length;
          queued += r.queued ? 1 : 0;
          this.text.set('');
        } else failures.push(this.reason(r.code));
      }
    } finally {
      this.sending.set(false);
    }
    if (failures.length) this.message.set([...new Set(failures)].join(' '));
    if (drafts) this.notice.set(this.translate.instant('{n} draft(s) waiting for your review.', { n: String(drafts) }));
    else if (queued) this.notice.set(this.translate.instant('No connection: the capture waits on this device and is read when the connection returns.'));
  }

  reason(code: AiFailure | 'unreadable' | 'write'): string {
    const map: Record<string, string> = {
      'documents-off': 'Smart capture is off. Turn it on in Settings to read images and PDFs, or type the movement.',
      unreadable: 'Nothing could be read. Enter the movement by hand.',
      write: 'This device cannot save changes right now.',
    };
    return map[code] ? this.translate.instant(map[code]) : this.ai.messageOf(code as AiFailure);
  }

  // the exact content of the text capture, as it travels
  textPreview = computed(() => ({ mode: 'text', text: this.text() }));

  setSkipPreview(on: boolean): void {
    this.ai.setSkipPreview(on);
  }
}
