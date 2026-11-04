// The AI features of the modules (prompt 11), all in the server whitelist. The client names one;
// the instructions, the model tier, the token ceiling and the SHAPE of the input are decided here.
// There are two kinds: "narrate" (text with {{markers}}, the figures are put by the app) and
// "json" (classification, grouping, ranking: the app parses the answer strictly and the user
// confirms it). No feature accepts free instructions and none reads the database.
import type { FeatureDef, Locale, Tier } from './features.ts';

const KEY = /^[a-z][a-z0-9_]{0,40}$/;
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const short = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function numMap(v: unknown, max: number): boolean {
  if (!isRec(v)) return false;
  const e = Object.entries(v);
  return e.length <= max && e.every(([k, n]) => KEY.test(k) && finite(n));
}

function strMap(v: unknown, max: number, valueMax: number): boolean {
  if (!isRec(v)) return false;
  const e = Object.entries(v);
  return e.length <= max && e.every(([k, s]) => KEY.test(k) && short(s, valueMax));
}

// The input of every narration: calculated aggregates plus the names of the markers the model may use
export function checkNarration(input: unknown): string | null {
  if (!isRec(input)) return 'an object is expected';
  const allowed = new Set(['figures', 'counts', 'series', 'labels', 'placeholders', 'context']);
  if (Object.keys(input).some((k) => !allowed.has(k))) return 'unknown field';
  if (!Array.isArray(input['placeholders']) || input['placeholders'].length > 80 || !input['placeholders'].every((p) => typeof p === 'string' && KEY.test(p))) return 'placeholders';
  if (input['figures'] !== undefined && !numMap(input['figures'], 80)) return 'figures';
  if (input['counts'] !== undefined && !numMap(input['counts'], 80)) return 'counts';
  if (input['labels'] !== undefined && !strMap(input['labels'], 40, 40)) return 'labels';
  if (input['context'] !== undefined && !strMap(input['context'], 12, 40)) return 'context';
  const series = input['series'];
  if (series !== undefined) {
    if (!isRec(series) || Object.keys(series).length > 6) return 'series';
    for (const [k, arr] of Object.entries(series)) if (!KEY.test(k) || !Array.isArray(arr) || arr.length > 24 || !arr.every(finite)) return 'series';
  }
  return null;
}

// A list of short texts to classify, normalize or group, optionally with the options to choose from
export function checkItems(input: unknown, maxItems = 30): string | null {
  if (!isRec(input)) return 'an object is expected';
  if (Object.keys(input).some((k) => k !== 'items' && k !== 'options')) return 'unknown field';
  const items = input['items'];
  if (!Array.isArray(items) || items.length < 1 || items.length > maxItems || !items.every((s) => short(s, 120))) return 'items';
  const options = input['options'];
  if (options !== undefined && (!Array.isArray(options) || options.length < 1 || options.length > 60 || !options.every((s) => short(s, 40)))) return 'options';
  return null;
}

export function checkPairs(input: unknown): string | null {
  if (!isRec(input) || Object.keys(input).some((k) => k !== 'pairs')) return 'an object with pairs is expected';
  const pairs = input['pairs'];
  if (!Array.isArray(pairs) || pairs.length < 1 || pairs.length > 5) return 'pairs';
  return pairs.every((p) => isRec(p) && Object.keys(p).every((k) => ['a', 'b', 'range'].includes(k)) && short(p['a'], 120) && short(p['b'], 120) && short(p['range'], 30)) ? null : 'pairs';
}

export function checkRank(input: unknown): string | null {
  if (!isRec(input) || Object.keys(input).some((k) => k !== 'indicators')) return 'an object with indicators is expected';
  const list = input['indicators'];
  return Array.isArray(list) && list.length >= 1 && list.length <= 12 && list.every((i) => isRec(i) && Object.keys(i).every((k) => k === 'id' || k === 'change') && typeof i['id'] === 'string' && KEY.test(i['id']) && finite(i['change'])) ? null : 'indicators';
}

export function checkChoice(input: unknown): string | null {
  const base = checkNarration(isRec(input) ? Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'options')) : input);
  if (base) return base;
  const options = (input as Record<string, unknown>)['options'];
  return Array.isArray(options) && options.length >= 2 && options.length <= 5 && options.every((o) => typeof o === 'string' && KEY.test(o)) ? null : 'options';
}

const LANGUAGE: Record<Locale, string> = { es: ' Write the answer in Spanish.', en: ' Write the answer in English.' };
const NARRATE_TAIL = ' The input holds calculated aggregates and the list of placeholders you may use. Reply with 2 to 4 short sentences of plain text, using {{placeholder}} wherever a figure, a percentage or a date belongs. Never write a number yourself.';

function narrate(id: string, purpose: string, tier: Tier = 'fast', maxOutputTokens = 260): FeatureDef {
  return {
    id,
    tier,
    maxOutputTokens,
    maxInputChars: 6000,
    instructions: (locale) => purpose + NARRATE_TAIL + LANGUAGE[locale],
    checkInput: checkNarration,
    toPrompt: (input) => JSON.stringify(input),
  };
}

function json(id: string, purpose: string, check: (input: unknown) => string | null, maxInputChars: number, maxOutputTokens: number, tier: Tier = 'fast'): FeatureDef {
  return {
    id,
    tier,
    maxOutputTokens,
    maxInputChars,
    instructions: (locale) => purpose + ' Reply with ONLY the JSON object, no other text, no markdown.' + LANGUAGE[locale],
    checkInput: check,
    toPrompt: (input) => JSON.stringify(input),
  };
}

export const NARRATE_FEATURES: readonly [string, string][] = [
  ['income-pattern-explain', 'Explain in plain words the payment cadence detected in a person\'s income (how often it arrives and what kind of source it could be). Do not claim certainty: say it looks like.'],
  ['income-unusual-question', 'Write a short, neutral question asking the user what an unusually large income was (a sale, a bonus, something else). Never guess the cause.'],
  ['income-sources-summary', 'Summarize how concentrated and how stable the income sources are, using the weight of each kind of source and the share of variable income.'],
  ['expense-atypical-explain', 'Describe the unusually high expenses that were detected and suggest one or two questions the user can ask themselves about each. Do not invent causes.'],
  ['expense-savings-tips', 'Give two or three concrete, prioritized actions to reduce spending, based on the categories where spending is highest or grew the most.'],
  ['budget-behavior', 'Summarize how the month is going against the budget: what is on track, what is close to its limit and what is over.'],
  ['budget-risk-alert', 'Write a short alert about the budget lines at risk of being exceeded at the current pace, with one actionable suggestion.'],
  ['business-profitability', 'Summarize the profitability of the small resale business: margins, return and how fast the stock turns, by item category.'],
  ['business-margin-explain', 'Explain what drives the margin of the operations (purchase cost, operating expenses, days in stock) and point out the operations with a low margin.'],
  ['business-capital-eval', 'Assess the capital invested in inventory: how much is tied up, how much is slow stock and how concentrated it is.'],
  ['account-movements', 'Summarize what changed in the accounts and cards during the period and where the spending concentrates. Use the type of account, never names.'],
  ['card-habits', 'Describe the usage habits of the credit cards: which days and categories concentrate the spending.'],
  ['commitments-priority', 'List which upcoming payments to take care of first and why, in order of due date and consequence of being late.'],
  ['loan-scenarios', 'Explain the main differences between the simulated loan scenarios: what is paid extra and which installment is more comfortable. This is a simulation, not an offer.'],
  ['loan-capacity', 'Explain the payment capacity under three readings of income (conservative, with business income, everything declared) and whether the installment fits. Never count non-monetary benefits as income.'],
  ['loan-installments', 'Explain how the total of a loan splits between principal, interest and charges and which levers reduce it (shorter term, extra payments). This is a simulation.'],
  ['loan-advice', 'Give a cautious recommendation based only on the simulations provided. Never guarantee anything and never recommend a specific institution.'],
  ['goal-projection', 'Explain when the goals could be reached according to the plan and according to the real pace, and point out the assumption that matters most.'],
  ['savings-split', 'Suggest how to split the amount the user can set aside each month among the goals, by urgency and date. Do not invent amounts: use only the placeholders.'],
  ['goal-viability', 'Explain whether each goal is reachable with the current monthly margin, using the viability that was calculated.'],
  ['dashboard-summary', 'Write a short financial summary of the period with the most important points from the indicators and their changes.'],
  ['dashboard-alerts', 'Present the active alerts in order of priority, in clear and calm language.'],
  ['dashboard-explain', 'Explain in plain words why an indicator changed, using the components of the change and their differences.'],
];

export const MODULE_FEATURES: Record<string, FeatureDef> = {
  ...Object.fromEntries(NARRATE_FEATURES.map(([id, purpose]) => [id, narrate(id, purpose)])),
  'budget-strategy-pick': {
    id: 'budget-strategy-pick',
    tier: 'fast',
    maxOutputTokens: 300,
    maxInputChars: 6000,
    instructions: (locale) =>
      'Choose ONE of the already calculated budget strategies listed in "options" that fits the spending habits best, and explain why. Reply with ONLY a JSON object {"choice": "<one of the options>", "text": "<2 short sentences using {{placeholder}} wherever a figure belongs; never write a number>"}.' + LANGUAGE[locale],
    checkInput: checkChoice,
    toPrompt: (input) => JSON.stringify(input),
  },
  'income-classify': json('income-classify', 'For each note of an income movement choose up to 3 of the given source types ("options") that fit, with a confidence between 0 and 1. Shape: {"results":[{"i":0,"picks":[{"o":"<option>","c":0.8}]}]}. Choose only from the options.', checkItems, 4000, 500),
  'expense-categorize': json('expense-categorize', 'For each note of an expense choose up to 3 of the given categories ("options") that fit, with a confidence between 0 and 1. Shape: {"results":[{"i":0,"picks":[{"o":"<option>","c":0.8}]}]}. Choose only from the options.', checkItems, 4000, 500),
  'expense-recurring-normalize': json('expense-recurring-normalize', 'Normalize each bank-style note to the short name of the service or business it refers to (for example "NETFLIX.COM 805 CA" becomes "Netflix"). Shape: {"names":[{"i":0,"name":"Netflix"}]}. Keep names short and never include digits.', (i) => checkItems(i), 4000, 500),
  'business-grouping': json('business-grouping', 'Group the item names that are the same product written in different ways. Shape: {"groups":[{"name":"<short family name>","members":[0,3]}]}. Every index appears in at most one group.', (i) => checkItems(i, 60), 6000, 700),
  'duplicate-judge': json('duplicate-judge', 'For each pair of movement notes with a similar amount range decide if they look like the same movement entered twice. Shape: {"verdicts":[{"i":0,"verdict":"duplicate|not-duplicate|doubtful","reason":"<one short sentence, no numbers>"}]}.', checkPairs, 3000, 400),
  'dashboard-indicators-rank': json('dashboard-indicators-rank', 'Order the indicators from the one that deserves the most attention this period to the least, from their relative change. Shape: {"order":["<indicator id>"]}. Use only the given ids.', checkRank, 2000, 200),
};
