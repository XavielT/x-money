// 2.18.2: turning a switch on in Settings is enough. The app turns AI on for the account on the server
// (the user's own choice) when a switch goes on, and a call that finds the account not enabled yet turns it
// on once and retries. Everything runs against a simulated gateway.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { beforeEach } from 'vitest';
import { MemoryStorage } from '../testing/memory-storage';
import { AuthService } from '../services/auth.service';
import { StorageService } from '../services/storage.service';
import { AiGateway, GatewayResult, GatewayUsage } from './ai-gateway';
import { AI_GATEWAY, AiService } from './ai.service';
import { AiWireRequest } from './ai.types';

const ok: GatewayResult = { ok: true, output: 'pong', usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', requestId: 'x' };

class FakeGateway implements AiGateway {
  enabled = false; // the flag of the account on the server
  enableCalls = 0;
  enableWorks = true;
  runs: AiWireRequest[] = [];
  async run(request: AiWireRequest): Promise<GatewayResult> {
    this.runs.push(request);
    return this.enabled ? ok : { ok: false, code: 'unauthorized' };
  }
  async usage(): Promise<GatewayUsage> {
    return this.enabled ? { ok: true, usage: { requests: 1, tokens: 2, requestCap: 300, tokenCap: 400000, month: '2026-11' } } : { ok: false, code: 'unauthorized' };
  }
  async enable() {
    this.enableCalls++;
    if (this.enableWorks) this.enabled = true;
    return { ok: this.enableWorks };
  }
}

let gateway: FakeGateway;
let mode: ReturnType<typeof signal<string>>;

function service(): AiService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: StorageService, useValue: new MemoryStorage() as unknown as StorageService }, { provide: AuthService, useValue: { mode } }, { provide: AI_GATEWAY, useValue: gateway }],
  });
  return TestBed.inject(AiService);
}

beforeEach(() => {
  gateway = new FakeGateway();
  mode = signal('signed-in');
  window.dispatchEvent(new Event('online'));
});

const flush = () => new Promise((r) => setTimeout(r));

describe('the switch of the user is the switch of the account', () => {
  it('turning the general switch on turns AI on for the account, with no operator involved', async () => {
    const s = service();
    s.setEnabled(true);
    await flush();
    expect(gateway.enableCalls).toBe(1);
    expect(gateway.enabled).toBe(true);
    s.setEnabled(false);
    await flush();
    expect(gateway.enableCalls).toBe(1); // turning it off is local: the stored flag does no harm
  });

  it('turning smart capture on does the same, independently of the general switch', async () => {
    const s = service();
    s.setDocuments(true);
    await flush();
    expect(gateway.enabled).toBe(true);
    expect(s.prefs().enabled).toBe(false);
  });

  it('a call that finds the account not enabled yet turns it on once and retries it', async () => {
    const s = service();
    s.setDocuments(true); // consent recorded here...
    gateway.enabled = false; // ...but the server flag was not set (it was offline at that moment)
    gateway.enableCalls = 0;
    const r = await s.run('capture_parse', { mode: 'text', text: 'x' });
    expect(r).toMatchObject({ ok: true });
    expect(gateway.enableCalls).toBe(1);
    expect(gateway.runs).toHaveLength(2); // the refused one and the retry
  });

  it('without a session or without a connection it does not call; if enabling fails, the answer stays unauthorized', async () => {
    const s = service();
    mode.set('signed-out');
    s.setEnabled(true);
    await flush();
    expect(gateway.enableCalls).toBe(0);
    mode.set('signed-in');
    s.setDocuments(true);
    await flush();
    gateway.enabled = false;
    gateway.enableWorks = false;
    expect(await s.run('capture_parse', { mode: 'text', text: 'x' })).toEqual({ ok: false, code: 'unauthorized' });
  });

  it('the usage of the month is read after turning it on too', async () => {
    const s = service();
    expect(await s.refreshUsage()).toBe(true);
    expect(gateway.enabled).toBe(true);
  });
});
