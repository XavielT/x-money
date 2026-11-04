// Found while building smart capture (2.18.0). The server (xmoney-api/lib/validate.ts and the CHECK
// constraint `records_collection_format` of the schema) only accepts collection names made of
// [a-z0-9_]. Several collections registered with camelCase names in earlier versions can therefore NOT
// be pushed: the server rejects their records. This test fixes today's behavior so the problem is on
// record; the fix is a decision for the owner (see docs/INTEGRIDAD.md, "KNOWN GAP").
import { isCollection } from '../../../supabase/functions/xmoney-api/lib/validate.ts';
import { SYNCED_COLLECTIONS } from '../data-layer/registry';

describe('collection names the server accepts', () => {
  const rejected = Object.keys(SYNCED_COLLECTIONS)
    .filter((k) => !isCollection(k))
    .sort();

  it('KNOWN GAP: these registered collections have camelCase names, which the server rejects (they never sync)', () => {
    expect(rejected).toEqual(['budgetMoves', 'businessOperations', 'businessWithdrawals', 'incomeSources', 'insightSettings', 'insightStates', 'loanSettings', 'loanSimulations', 'textRules']);
  });

  it('collections added from 2.18.0 on use names the server accepts', () => {
    expect(isCollection('capture_drafts')).toBe(true);
    expect(rejected).not.toContain('capture_drafts');
    expect(rejected).not.toContain('goals');
    expect(rejected).not.toContain('loans');
  });
});
