// Matching the bank a screenshot names to the catalog of the app. Pure. Only a clear match counts:
// every distinctive word of the catalog name must be in the text ("Banco Popular Dominicano" -> popular,
// "BHD León" -> bhd); anything else stays unmatched and the user chooses.
import { normalizeWord } from './words';

export interface BankRef {
  id: string;
  name: string;
}

const GENERIC = new Set(['banco', 'bank', 'de', 'del', 'la', 'el', 'qik']);

const wordsOf = (s: string): string[] => s.split(/\s+/).map(normalizeWord).filter(Boolean);

export function bankIdOf(name: string | undefined, banks: readonly BankRef[]): string | undefined {
  if (!name) return undefined;
  const have = new Set(wordsOf(name));
  const squashed = wordsOf(name).join('');
  const hits = banks.filter((b) => {
    if (b.id === 'other') return false;
    const key = wordsOf(b.name).filter((w) => !GENERIC.has(w) || w === 'qik');
    const words = key.length ? key : wordsOf(b.name);
    return words.every((w) => have.has(w) || squashed === w) || squashed === normalizeWord(b.id);
  });
  return hits.length === 1 ? hits[0].id : undefined; // two candidates is not a match
}
