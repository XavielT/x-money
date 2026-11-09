// Switchable modules. The core (accounts and cards, movements, budgets and fixed expenses, statistics, Settings) is always
// on and is not in this list. AI and Capture have their own switch and consent: they are NOT modules.
export const MODULE_IDS = ['income', 'benefits', 'business', 'loans', 'goals', 'insights'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

// What the user chose, per module; a missing key means "automatic"
export type ModuleChoices = Partial<Record<ModuleId, boolean>>;

// Modules that start on without any data (the rest start on only when they already hold data)
export const MODULES_ON_BY_DEFAULT: readonly ModuleId[] = ['insights'];

// An explicit choice always wins; without one the module is on when it has data (or is on by default).
// Turning a module off only hides shortcuts: it never decides what is counted.
export function resolveModule(explicit: boolean | undefined, hasData: boolean, defaultOn = false): boolean {
  return explicit ?? (hasData || defaultOn);
}

// Keeps only known ids with boolean values (a hand-edited backup must not break the app)
export function cleanChoices(raw: unknown): ModuleChoices {
  const out: ModuleChoices = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of MODULE_IDS) {
    const v = (raw as Record<string, unknown>)[id];
    if (typeof v === 'boolean') out[id] = v;
  }
  return out;
}
