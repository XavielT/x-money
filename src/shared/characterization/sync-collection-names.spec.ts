// Found while building smart capture (2.18.0) and fixed in the same version. The server
// (xmoney-api/lib/validate.ts and the CHECK constraint `records_collection_format` of the schema) only
// accepts collection names made of [a-z0-9_], but nine collections had been registered with camelCase
// keys, so their records were rejected and never left the device. The sync layer now translates the
// names at the boundary with the server; the keys of the app, the outbox and the backups do not change.
import { isCollection } from '../../../supabase/functions/xmoney-api/lib/validate.ts';
import { countServer } from '../data-layer/link';
import { RENAMED_COLLECTIONS, SYNCED_COLLECTIONS, toClientKey, toServerName } from '../data-layer/registry';

const NINE = ['budgetMoves', 'businessOperations', 'businessWithdrawals', 'incomeSources', 'insightSettings', 'insightStates', 'loanSettings', 'loanSimulations', 'textRules'];

describe('collection names on the wire', () => {
  it('every synced collection travels with a name the server accepts', () => {
    for (const key of Object.keys(SYNCED_COLLECTIONS)) expect(isCollection(toServerName(key)), key).toBe(true);
  });

  it('the translation is reversible and never merges two collections', () => {
    const names = Object.keys(SYNCED_COLLECTIONS).map(toServerName);
    expect(new Set(names).size).toBe(names.length);
    for (const key of Object.keys(SYNCED_COLLECTIONS)) expect(toClientKey(toServerName(key))).toBe(key);
  });

  it('only the nine camelCase keys change; the rest, "conflicts" and unknown names pass through', () => {
    expect([...RENAMED_COLLECTIONS].sort()).toEqual(NINE);
    expect(toServerName('incomeSources')).toBe('income_sources');
    expect(toServerName('textRules')).toBe('text_rules');
    expect(toServerName('transactions')).toBe('transactions');
    expect(toServerName('capture_drafts')).toBe('capture_drafts');
    expect(toClientKey('income_sources')).toBe('incomeSources');
    expect(toClientKey('conflicts')).toBe('conflicts');
    expect(toClientKey('something_new')).toBe('something_new');
  });

  it('the counts the server reports (snake_case) are read back under the keys of the app', () => {
    expect(countServer({ income_sources: 3, transactions: 5, text_rules: 2 })).toMatchObject({ incomeSources: 3, transactions: 5, textRules: 2, goals: 0 });
    expect(countServer({ incomeSources: 4 })).toMatchObject({ incomeSources: 4 }); // an older shape still reads
  });
});
