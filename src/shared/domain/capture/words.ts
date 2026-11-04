// Spanish amounts said aloud ("dos mil doscientos cincuenta con cincuenta") and the search for every
// amount a text contains, in digits or in words. Pure. What it does not understand it returns as
// null: the caller marks the amount "verify", it never guesses.
import { minorFromNumberToken } from './amount';

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
};

export const normalizeWord = (w: string): string =>
  w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9$]/g, '');

const isNumberWord = (w: string): boolean => w in UNITS || w in TENS || w in HUNDREDS || w === 'mil' || w === 'millon' || w === 'millones';

// A run of number words -> value, or null when the grammar does not hold ("mil mil", "cinco cinco")
function valueOf(words: readonly string[]): number | null {
  let total = 0;
  let current = 0;
  let stage = 0; // 0 nothing yet in this group, 1 after hundreds, 2 after tens, 3 group closed by a unit
  let lastScale = Infinity;
  let sawAny = false;
  for (const w of words) {
    if (w === 'y') continue;
    sawAny = true;
    if (w in HUNDREDS) {
      if (stage !== 0) return null;
      current += HUNDREDS[w];
      stage = 1;
    } else if (w in TENS) {
      if (stage > 1) return null;
      current += TENS[w];
      stage = 2;
    } else if (w in UNITS) {
      const v = UNITS[w];
      if (stage === 3) return null;
      if (stage === 2 && v >= 10) return null;
      current += v;
      stage = 3;
    } else if (w === 'mil') {
      if (lastScale <= 1000) return null;
      total += (current || 1) * 1000;
      current = 0;
      stage = 0;
      lastScale = 1000;
    } else if (w === 'millon' || w === 'millones') {
      if (lastScale <= 1_000_000) return null;
      total += (current || 1) * 1_000_000;
      current = 0;
      stage = 0;
      lastScale = 1_000_000;
    } else {
      return null;
    }
  }
  return sawAny ? total + current : null;
}

// "mil quinientos pesos" -> 150000 (minor units); "... con cincuenta" -> cents. Null = not understood.
export function wordsToMinor(text: string): number | null {
  const tokens = text.split(/\s+/).map(normalizeWord).filter(Boolean);
  const runs = numberRuns(tokens);
  const first = runs[0];
  return first ? first.minor : null;
}

interface Run {
  minor: number;
  start: number;
  end: number;
}

// Maximal runs of number words in a token list. "un"/"una" alone is an article, not a quantity.
function numberRuns(tokens: readonly string[]): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!isNumberWord(tokens[i])) {
      i++;
      continue;
    }
    let j = i;
    const words: string[] = [];
    while (j < tokens.length) {
      const t = tokens[j];
      if (isNumberWord(t)) words.push(t);
      else if (t === 'y' && j + 1 < tokens.length && isNumberWord(tokens[j + 1]) && words.length && tokens[j + 1] in UNITS && (words[words.length - 1] in TENS)) words.push(t);
      else break;
      j++;
    }
    let end = j;
    let cents = 0;
    if (tokens[j] === 'con' && j + 1 < tokens.length && isNumberWord(tokens[j + 1])) {
      let k = j + 1;
      const centWords: string[] = [];
      while (k < tokens.length && (isNumberWord(tokens[k]) || (tokens[k] === 'y' && k + 1 < tokens.length && isNumberWord(tokens[k + 1])))) centWords.push(tokens[k++]);
      const c = valueOf(centWords);
      if (c !== null && c < 100) {
        cents = c;
        end = k;
      }
    }
    const only = words.length === 1 ? words[0] : '';
    const article = only === 'un' || only === 'una' || only === 'uno';
    const value = valueOf(words);
    if (value !== null && !article && !(only === 'cero')) runs.push({ minor: value * 100 + cents, start: i, end });
    i = Math.max(end, i + 1);
  }
  return runs;
}

// Every amount in a text, as minor units: digit amounts and word amounts. Used by the cross check
// ("the amount the model returned must appear in the text it was read from").
export function amountsInText(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.match(/\d[\d.,   ]*\d|\d/g) ?? []) {
    const minor = minorFromNumberToken(m);
    if (minor !== null) found.add(minor);
    // "1 500" or "12 000" may also have been two numbers: accept the spaced form only as a whole
  }
  const tokens = text.split(/\s+/).map(normalizeWord).filter(Boolean);
  for (const r of numberRuns(tokens)) found.add(r.minor);
  return [...found];
}

// Does the minor amount appear in the text (digits or words)? A "k" (5k, 5 mil) is not guessed.
export const amountAppearsIn = (minor: number, text: string): boolean => amountsInText(text).includes(minor);
