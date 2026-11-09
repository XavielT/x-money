import { describe, expect, it } from 'vitest';
import { MODULE_IDS, cleanChoices, resolveModule } from './modules';

describe('resolveModule', () => {
  it('no data and no explicit choice: off (unless it is on by default)', () => {
    expect(resolveModule(undefined, false)).toBe(false);
    expect(resolveModule(undefined, false, true)).toBe(true);
  });
  it('data and no explicit choice: on', () => {
    expect(resolveModule(undefined, true)).toBe(true);
  });
  it('explicit off wins over data', () => {
    expect(resolveModule(false, true)).toBe(false);
    expect(resolveModule(false, true, true)).toBe(false);
  });
  it('explicit on wins over no data', () => {
    expect(resolveModule(true, false)).toBe(true);
  });
});

describe('cleanChoices', () => {
  it('keeps known booleans and drops the rest', () => {
    expect(cleanChoices({ goals: true, loans: false, nope: true, income: 'yes', insights: 1 })).toEqual({ goals: true, loans: false });
  });
  it('tolerates anything that is not an object', () => {
    expect(cleanChoices(undefined)).toEqual({});
    expect(cleanChoices(null)).toEqual({});
    expect(cleanChoices('x')).toEqual({});
  });
  it('the module list has the six switchable ones and not AI or capture', () => {
    expect([...MODULE_IDS]).toEqual(['income', 'benefits', 'business', 'loans', 'goals', 'insights']);
  });
});
