// The WHITELIST of AI features. The client names a feature; the instructions, the model tier, the
// token ceiling and the input check all live here, so the function is not an open proxy: nobody
// can send free system instructions. Prompt 11 adds the module features next to `ping`.
import { CAPTURE_FEATURES } from './features-capture.ts';
import { MODULE_FEATURES } from './features-modules.ts';

export type Tier = 'fast' | 'smart';
export type Locale = 'es' | 'en';

export interface FeatureDef {
  id: string;
  tier: Tier;
  maxOutputTokens: number;
  maxInputChars: number;
  instructions(locale: Locale): string;
  // null = the input is acceptable; otherwise a short reason (never echoed with the input)
  checkInput(input: unknown): string | null;
  // the user turn sent to the model, built from the already-checked input
  toPrompt(input: unknown): string;
  // smart capture: the document travelling with the turn (null = text only)
  toAttachment?(input: unknown): { kind: 'image' | 'pdf'; mediaType: string; data: string } | null;
  // the answer must have an agreed shape: returns the normalized text, or null (one retry, then a clear failure)
  finalize?(text: string): string | null;
  // caps on top of the monthly ones: calls per day and, once prices are known, estimated cost per month
  dailyCap?: number;
  monthlyCostCapUsd?: number;
}

// Every feature starts from these rules: the figures are written by the app, never by the model
export const COMMON_RULES: Record<Locale, string> = {
  es: 'Escribe solo texto en español. NUNCA escribas montos de dinero, porcentajes ni cifras calculadas: usa únicamente los marcadores {{nombre}} que aparecen en la lista "placeholders" de la entrada. No inventes datos ni des consejos de inversión.',
  en: 'Write plain text only. NEVER write money amounts, percentages or calculated figures: use only the {{name}} placeholders listed in the input "placeholders". Do not invent data and do not give investment advice.',
};

const isEmptyInput = (input: unknown): boolean => input === null || input === undefined || (typeof input === 'object' && !Array.isArray(input) && Object.keys(input as object).length === 0);

const ping: FeatureDef = {
  id: 'ping',
  tier: 'fast',
  maxOutputTokens: 16,
  maxInputChars: 64,
  instructions: () => 'Reply with the single word: pong',
  // ping carries nothing from the user
  checkInput: (input) => (isEmptyInput(input) ? null : 'ping takes no input'),
  toPrompt: () => 'ping',
};

export const FEATURES: Readonly<Record<string, FeatureDef>> = { ping, ...MODULE_FEATURES, ...CAPTURE_FEATURES };

export const featureOf = (id: unknown, features: Readonly<Record<string, FeatureDef>> = FEATURES): FeatureDef | null =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(features, id) ? features[id] : null;
