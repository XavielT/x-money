// docs/LENGUAJE.md: one name per concept. The terms the glossary replaced must not come back in a template, a component or
// the Spanish map, and the Spanish map has no repeated key.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OLD_TERMS = [
  'Reconcile',
  'Reconcile account',
  'Liquid net worth',
  'Net worth (after card debt)',
  'What adds up',
  'Initial balance',
  'Liquid account (counts in liquid net worth)',
  'Bank fee / tax (optional)',
  'Risk threshold (% of the limit)',
  'Small purchase: up to (empty = automatic)',
];

const SRC = 'src';
const MAP = 'src/shared/services/translations-es.ts';

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = dir + '/' + entry.name;
    if (entry.isDirectory()) files(path, out);
    else if (/\.(ts|html)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe('plain language (docs/LENGUAJE.md)', () => {
  it('no old glossary term is used as a text key in a template or a component', () => {
    const found: string[] = [];
    for (const file of files(SRC)) {
      if (file.endsWith('.spec.ts') || file === MAP) continue;
      const text = readFileSync(file, 'utf8');
      for (const term of OLD_TERMS) if (text.includes("'" + term + "'") || text.includes('"' + term + '"')) found.push(file + ': ' + term);
    }
    expect(found).toEqual([]);
  });

  it('the Spanish map does not keep the old terms', () => {
    const text = readFileSync(MAP, 'utf8');
    expect(OLD_TERMS.filter((t) => text.includes("  '" + t + "':"))).toEqual([]);
  });

  it('the Spanish map has no repeated key', () => {
    const keys = [...readFileSync(MAP, 'utf8').matchAll(/^ {2}'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1]);
    const seen = new Set<string>();
    const dup = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    expect(keys.length).toBeGreaterThan(1500);
    expect(dup).toEqual([]);
  });

  it('the new names exist in Spanish', () => {
    const text = readFileSync(MAP, 'utf8');
    for (const key of ['Match with the bank', 'Money in your accounts', 'After paying your cards', 'See how it adds up', 'Opening balance', 'Counts as money you can use', 'Bank charge (optional)']) {
      expect(text).toContain("  '" + key + "':");
    }
  });
});
