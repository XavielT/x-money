// 2.18.2: AI is the user's own switch. An authenticated account turns it on (or off) itself with the
// `enable` / `disable` actions; no operator has to touch the database. Everything else about access stays:
// no session is 401, an account whose AI is off is 403 for run and usage, and a disabled account never
// authenticates at all.
import { createAi } from '../../supabase/functions/xmoney-ai/lib/handler.ts';
import { MemoryAiStore } from '../../supabase/functions/xmoney-ai/lib/store.ts';

function build(principal: { accountId: string; aiEnabled: boolean } | null) {
  const store = new MemoryAiStore();
  const calls: unknown[] = [];
  const current = { principal };
  const ai = createAi({
    authenticate: async () => (current.principal ? { ...current.principal, requestCap: null, tokenCap: null } : null),
    store,
    provider: { name: 'fake', complete: async (req) => (calls.push(req), { text: 'pong', inputTokens: 1, outputTokens: 1 }) },
    models: { fast: 'f', smart: 's' },
    now: () => Date.UTC(2026, 10, 20),
  });
  const act = (action: string, body: Record<string, unknown> = {}) => ai.handle({ action, body, authorization: 'Bearer x' });
  return { ai, store, calls, act, current };
}

describe('the account turns AI on and off by itself', () => {
  it('enable works for an authenticated account whose AI is off, and writes the flag for ITS OWN account only', async () => {
    const s = build({ accountId: 'acc-1', aiEnabled: false });
    expect(await s.act('run', { feature: 'ping', input: {}, locale: 'en', requestId: 'r1' })).toMatchObject({ status: 403, body: { code: 'unauthorized' } });
    expect(await s.act('enable')).toEqual({ status: 200, body: { ok: true, aiEnabled: true } });
    expect(s.store.enabled.get('acc-1')).toBe(true);
    expect([...s.store.enabled.keys()]).toEqual(['acc-1']);
    // the next request authenticates with the flag on (the real authenticator reads it from the database)
    s.current.principal = { accountId: 'acc-1', aiEnabled: true };
    expect((await s.act('run', { feature: 'ping', input: {}, locale: 'en', requestId: 'r2' })).status).toBe(200);
  });

  it('disable turns it off again', async () => {
    const s = build({ accountId: 'acc-1', aiEnabled: true });
    expect(await s.act('disable')).toEqual({ status: 200, body: { ok: true, aiEnabled: false } });
    expect(s.store.enabled.get('acc-1')).toBe(false);
  });

  it('without a session nothing can be turned on', async () => {
    const s = build(null);
    expect((await s.act('enable')).status).toBe(401);
    expect(s.store.enabled.size).toBe(0);
  });

  it('run and usage still refuse an account whose AI is off, and never call the provider', async () => {
    const s = build({ accountId: 'acc-1', aiEnabled: false });
    expect((await s.act('usage')).status).toBe(403);
    expect((await s.act('run', { feature: 'ping', input: {}, locale: 'en', requestId: 'r1' })).status).toBe(403);
    expect(s.calls).toHaveLength(0);
  });
});
