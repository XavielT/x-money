// Every query of the Postgres Db must be a constant string with user data only in params.
import { PgDb, type Exec } from '../../supabase/functions/xmoney-api/lib/pg-db.ts';

const EVIL = `x'); drop table xmoney.records; --`;

function recorder() {
  const calls: { text: string; params: unknown[] }[] = [];
  const exec: Exec = async (text, params) => {
    calls.push({ text, params });
    return [{ count: 1, window_start: 1, rev: '1', n: 0, data: {}, schema_version: 1 }];
  };
  return { calls, db: new PgDb(exec, async (fn) => fn(exec)) };
}

describe('PgDb is parameterized', () => {
  it('never puts user-controlled text into the SQL string', async () => {
    const { calls, db } = recorder();
    const account = {
      id: EVIL, email: EVIL, passwordHash: EVIL, passwordSalt: EVIL, kdfParams: { alg: EVIL, iterations: 1 },
      recoveryHash: EVIL, enabled: true, aiEnabled: false, failedAttempts: 0, lockedUntil: null, createdAt: 1, lastLoginAt: null,
    };
    const session = {
      id: EVIL, accountId: EVIL, refreshHash: EVIL, prevRefreshHash: EVIL, deviceId: EVIL, deviceLabel: EVIL,
      createdAt: 1, lastUsedAt: 1, expiresAt: 1, revokedAt: null,
    };
    await db.findAccountByEmail(EVIL);
    await db.findAccountById(EVIL);
    await db.insertAccount(account);
    await db.updateAccount(EVIL, { passwordHash: EVIL, recoveryHash: EVIL, failedAttempts: 3, lockedUntil: 5 });
    await db.insertSession(session);
    await db.findSessionById(EVIL);
    await db.findSessionByRefreshHash(EVIL);
    await db.updateSession(EVIL, { refreshHash: EVIL, prevRefreshHash: EVIL, revokedAt: 9 });
    await db.listSessions(EVIL);
    await db.revokeSessions(EVIL, 1, EVIL);
    await db.hitRateLimit(EVIL, 1, 2);
    await db.peekRateLimit(EVIL, 1, 2);
    await db.getRecords(EVIL, [{ collection: EVIL, id: EVIL }]);
    await db.upsertRecord({
      accountId: EVIL, collection: EVIL, id: EVIL, data: { a: EVIL }, schemaVersion: 1, clientUpdatedAt: 1, deviceId: EVIL, deletedAt: null,
    });
    await db.pullRecords(EVIL, 0, 10);
    await db.countRecords(EVIL);
    await db.getSchemaVersion(EVIL);
    await db.raiseSchemaVersion(EVIL, 2, 1);
    await db.tx(async (inner) => {
      await inner.findAccountByEmail(EVIL);
    });

    expect(calls.length).toBeGreaterThan(18);
    for (const call of calls) {
      expect(call.text).not.toContain('drop table');
      expect(call.text).not.toContain(EVIL);
      const placeholders = new Set(call.text.match(/\$\d+/g) ?? []);
      expect(placeholders.size).toBeLessThanOrEqual(call.params.length);
    }
    // the hostile values did travel, as parameters
    expect(calls.some((c) => c.params.includes(EVIL))).toBe(true);
  });

  it('passes jsonb values as objects (the driver serializes them; a pre-stringified value is stored as a JSON string)', async () => {
    const { calls, db } = recorder();
    await db.getRecords('a', [{ collection: 'c', id: 'i' }]);
    await db.upsertRecord({ accountId: 'a', collection: 'c', id: 'i', data: { x: 1 }, schemaVersion: 1, clientUpdatedAt: 1, deviceId: 'd', deletedAt: null });
    expect(calls[0].params[1]).toEqual([{ collection: 'c', id: 'i' }]);
    expect(calls[1].params[3]).toEqual({ x: 1 });
  });

  it('patches only whitelisted columns', async () => {
    const { calls, db } = recorder();
    await db.updateAccount('a', { email: 'evil@example.com', passwordHash: 'h' } as never);
    expect(calls[0].text).toContain('password_hash = $2');
    expect(calls[0].text).not.toContain('email');
  });
});
