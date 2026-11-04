// The catalog of the AI functions of the modules (2.17.0), registered in AiService. Every id exists
// in the server whitelist (supabase/functions/xmoney-ai/lib/features-modules.ts; a test compares
// both). `kind` says how the answer is used:
//   narrate   text with {{markers}}; the figures are put by the device, the validator guards it
//   classify  options chosen from the user's own lists; the user confirms
//   normalize / group / judge / rank / choose   strict JSON, parsed and confirmed by the user
import { AiFeatureDef, AiKind, AiModule, AiSendKind } from './ai.types';

const HOUR = 3_600_000;

const SENDS_TEXT: Record<AiSendKind, string> = {
  nothing: 'Nothing from your data is sent: only a fixed test word.',
  aggregates: 'Calculated aggregates only: totals, shares and trends. No names, ids or card digits.',
  'note-text': 'The text of the notes to classify (cleaned of identifiers) and your category names.',
  document: 'The document itself.',
};
export const describeOf = (kind: AiKind): string => (kind === 'judge' ? 'Only short note texts (cleaned of identifiers) and amount ranges.' : kind === 'group' ? 'The names of your items (cleaned of identifiers).' : kind === 'rank' ? 'Only the indicator ids and their relative change.' : kind === 'normalize' ? 'Only the distinct note texts (cleaned of identifiers).' : kind === 'classify' ? SENDS_TEXT['note-text'] : SENDS_TEXT['aggregates']);

function def(id: string, module: AiModule, kind: AiKind, labelKey: string): AiFeatureDef {
  const sends: AiSendKind = kind === 'narrate' || kind === 'choose' || kind === 'rank' ? 'aggregates' : 'note-text';
  return { id, module, kind, sends, labelKey, describeKey: describeOf(kind), ttlMs: kind === 'narrate' || kind === 'choose' || kind === 'rank' ? 12 * HOUR : 24 * 7 * HOUR, output: kind === 'narrate' ? 'marked-text' : 'plain' };
}

export const AI_CATALOG: readonly AiFeatureDef[] = [
  // income
  def('income-classify', 'income', 'classify', 'Classify income by its note'),
  def('income-pattern-explain', 'income', 'narrate', 'Explain a detected income pattern'),
  def('income-unusual-question', 'income', 'narrate', 'Ask about an unusual income'),
  def('income-sources-summary', 'income', 'narrate', 'Summary of the income sources'),
  // expenses
  def('expense-categorize', 'expenses', 'classify', 'Suggest a category for an expense'),
  def('expense-recurring-normalize', 'expenses', 'normalize', 'Normalize the names of recurring expenses'),
  def('expense-atypical-explain', 'expenses', 'narrate', 'Describe unusual expenses'),
  def('expense-savings-tips', 'expenses', 'narrate', 'Tips to reduce spending'),
  // budgets
  def('budget-behavior', 'budgets', 'narrate', 'How the month is going against the budget'),
  def('budget-risk-alert', 'budgets', 'narrate', 'Budget risk alert'),
  def('budget-strategy-pick', 'budgets', 'choose', 'Which budget strategy fits you'),
  // business
  def('business-profitability', 'business', 'narrate', 'Profitability of the business'),
  def('business-grouping', 'business', 'group', 'Group items that are the same product'),
  def('business-margin-explain', 'business', 'narrate', 'What explains the margins'),
  def('business-capital-eval', 'business', 'narrate', 'Assessment of the invested capital'),
  // cards and accounts
  def('account-movements', 'cards', 'narrate', 'Summary of the movements of accounts and cards'),
  def('duplicate-judge', 'cards', 'judge', 'Judge possible duplicates'),
  def('card-habits', 'cards', 'narrate', 'Card usage habits'),
  def('commitments-priority', 'cards', 'narrate', 'Which payment to make first'),
  // loans
  def('loan-scenarios', 'loans', 'narrate', 'Compare loan scenarios'),
  def('loan-capacity', 'loans', 'narrate', 'Payment capacity in plain words'),
  def('loan-installments', 'loans', 'narrate', 'Where the installments go'),
  def('loan-advice', 'loans', 'narrate', 'Cautious advice on a loan simulation'),
  // savings and goals
  def('goal-projection', 'savings', 'narrate', 'When the goals could be reached'),
  def('savings-split', 'savings', 'narrate', 'How to split what you can set aside'),
  def('goal-viability', 'savings', 'narrate', 'Are the goals reachable'),
  // dashboard
  def('dashboard-summary', 'dashboard', 'narrate', 'Financial summary'),
  def('dashboard-indicators-rank', 'dashboard', 'rank', 'Which indicators deserve attention'),
  def('dashboard-alerts', 'dashboard', 'narrate', 'Active alerts in order of priority'),
  def('dashboard-explain', 'dashboard', 'narrate', 'Explain a change'),
];

export const featuresOf = (module: AiModule): AiFeatureDef[] => AI_CATALOG.filter((f) => f.module === module);
