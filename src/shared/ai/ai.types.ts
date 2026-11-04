// Types of the single AI layer (2.16.0). Nothing outside src/shared/ai talks to the AI function.

// The modules a feature can belong to: each has its own switch in Settings
export type AiModule = 'income' | 'expenses' | 'budgets' | 'business' | 'cards' | 'loans' | 'savings' | 'dashboard';
export const AI_MODULES: readonly AiModule[] = ['income', 'expenses', 'budgets', 'business', 'cards', 'loans', 'savings', 'dashboard'];

// What a feature sends: calculated aggregates, the text of one note, or (prompt 12 only) a document.
// `document` has its OWN independent switch, off by default; nothing uses it yet.
export type AiSendKind = 'nothing' | 'aggregates' | 'note-text' | 'document';

// How the answer of a function is used (2.17.0)
export type AiKind = 'plain' | 'capture' | 'narrate' | 'classify' | 'normalize' | 'group' | 'judge' | 'rank' | 'choose';

export interface AiFeatureDef {
  kind?: AiKind; // absent = plain (the connection test)
  id: string; // must exist in the server whitelist
  module: AiModule | null; // null = no module (the connection test)
  sends: AiSendKind;
  labelKey: string;
  describeKey: string; // one sentence: what leaves the device
  ttlMs: number; // how long an answer is reused for the same input
  output: 'plain' | 'marked-text'; // marked-text: figures only through {{markers}}, validated before it is shown
}

export type AiLocale = 'es' | 'en';

// The exact body that travels to the function (plus a requestId): what "See what is sent" shows
export interface AiWireRequest {
  feature: string;
  input: unknown;
  locale: AiLocale;
  requestId: string;
}

export type AiServerCode = 'unauthorized' | 'quota' | 'rate_limited' | 'timeout' | 'provider_error' | 'bad_request' | 'daily_limit' | 'invalid_output';

// Everything that can stop a result; the caller shows its deterministic alternative in every case
export type AiFailure =
  | AiServerCode
  | 'off' // the general switch is off
  | 'module-off'
  | 'consent-needed' // first use of the feature: show what is sent and ask
  | 'no-session'
  | 'offline'
  | 'client-limit' // the daily limit of this device
  | 'limit' // the monthly limit was reached
  | 'invalid-output' // the text had figures or unknown markers: never shown
  | 'unknown-feature'
  | 'documents-off' // the capture switch is off (smart capture, 2.18.0)
  | 'capture-limit'; // the daily limit of captures of this device

export type AiRunResult = { ok: true; text: string; raw: string; fromCache: boolean } | { ok: false; code: AiFailure };

export interface AiServerUsage {
  requests: number;
  tokens: number;
  requestCap: number;
  tokenCap: number;
  month: string;
}

// The state of the whole layer for the screens
export type AiStatus = 'off' | 'no-session' | 'offline' | 'limit' | 'ready';

export interface AiPrefs {
  enabled: boolean;
  modules: Partial<Record<AiModule, boolean>>;
  documentsEnabled: boolean; // the second, independent switch of smart capture (2.18.0); needs documentsConsentAt
  documentsConsentAt?: string; // ISO time the user accepted what a capture sends; absent = no consent
  skipPreview?: boolean; // 'do not ask again' hides the preview of each capture, never the consent
  acknowledged: string[]; // features whose first-use explanation the user confirmed
  usage: { month: string; requests: number; tokens: number; day: string; dayRequests: number; dayCaptures?: number };
}

export const DEFAULT_AI_PREFS: AiPrefs = {
  enabled: false,
  modules: {},
  documentsEnabled: false,
  acknowledged: [],
  usage: { month: '', requests: 0, tokens: 0, day: '', dayRequests: 0 },
};

export const CLIENT_DAILY_LIMIT = 30;
export const CAPTURE_DAILY_LIMIT = 40; // captures per day on this device (the server enforces the same per account)
export const DEFAULT_REQUEST_CAP = 300;
export const DEFAULT_TOKEN_CAP = 400_000;
