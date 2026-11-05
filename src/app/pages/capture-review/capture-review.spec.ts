// The review tray on a phone: typing in a field must not rebuild the card (the field lost its focus and its
// decimal point after every key), and a new-account draft says which bank and card it is.
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiGateway, GatewayResult, GatewayUsage } from '../../../shared/ai/ai-gateway';
import { AI_GATEWAY, AiService } from '../../../shared/ai/ai.service';
import { AiWireRequest } from '../../../shared/ai/ai.types';
import { AuthService } from '../../../shared/services/auth.service';
import { CaptureService } from '../../../shared/services/capture.service';
import { CategoryService } from '../../../shared/services/category.service';
import { StorageService } from '../../../shared/services/storage.service';
import { MemoryStorage } from '../../../shared/testing/memory-storage';
import { CaptureReviewComponent } from './capture-review';

const card = {
  kind: 'account_setup',
  confidence: {},
  bankName: 'Banreservas',
  accountName: 'Visa',
  accountType: 'credit_card',
  accountLast4: '7108',
  currencyHint: 'DOP',
};

class Gateway implements AiGateway {
  async run(_: AiWireRequest): Promise<GatewayResult> {
    return { ok: true, output: JSON.stringify({ transactions: [card] }), usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' };
  }
  async usage(): Promise<GatewayUsage> {
    return { ok: true, usage: { requests: 0, tokens: 0, requestCap: 300, tokenCap: 400000, month: '2026-11' } };
  }
}

async function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: StorageService, useValue: new MemoryStorage().seed({ accounts: [], transactions: [] }) as unknown as StorageService }, { provide: AuthService, useValue: { mode: signal('signed-in') } }, { provide: AI_GATEWAY, useValue: new Gateway() }],
  });
  TestBed.inject(CategoryService);
  TestBed.inject(AiService).setDocuments(true);
  const r = await TestBed.inject(CaptureService).submit({ source: 'image', payload: { mode: 'image', mediaType: 'image/jpeg', data: 'QUJD' }, original: { kind: 'image', thumb: 'data:image/jpeg;base64,QUJD' }, fingerprint: crypto.randomUUID() });
  const [draft] = (r as { drafts: { id: string }[] }).drafts;
  const fixture = TestBed.createComponent(CaptureReviewComponent);
  fixture.componentInstance.open.set(draft.id);
  fixture.detectChanges();
  return { fixture, id: draft.id };
}

describe('review captures', () => {
  beforeEach(() => vi.useRealTimers());

  it('typing a balance keeps the same input element: the field is not rebuilt, so it keeps focus and its decimal point', async () => {
    const { fixture, id } = await setup();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    for (const typed of ['1', '17', '179', '1799', '1799.4', '1799.43']) {
      input.value = typed;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(root.querySelector('input[type="number"]')).toBe(input);
    }
    expect(fixture.componentInstance.capture.drafts.byId(id)?.balanceMinor).toBe(179943);
  });

  it('a new-account draft shows its bank, last 4 and type, and the opening balance is not painted as an expense', async () => {
    const { fixture, id } = await setup();
    const c = fixture.componentInstance;
    const d = c.capture.drafts.byId(id)!;
    expect(c.accountSub(d)).toBe('Banreservas · ····7108 · Credit card');
    // no balance yet: in doubt (red); once entered it is a plain number
    expect((fixture.nativeElement as HTMLElement).querySelector('.review-amount')?.classList.contains('doubt')).toBe(true);
    c.setBalance(d, 1799.43);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.review-amount')?.classList.contains('doubt')).toBe(false);
  });
});
