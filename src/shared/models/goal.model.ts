// Financial goals (2.13.0). A goal is a VIRTUAL SET-ASIDE: a contribution does not move money
// between accounts or change any balance; it lowers "available money" and is counted as reserved.
// The optional associated account is informational only, so the same money is never counted twice
// (once in a savings account and again as reserved for a goal).

export type GoalKind = 'emergency' | 'vehicle' | 'business-capital' | 'travel' | 'repairs' | 'investments' | 'custom';
export type GoalStatus = 'active' | 'paused' | 'achieved' | 'archived';
export type PlanCadence = 'weekly' | 'biweekly' | 'monthly';

export interface GoalPlan {
  amount: number;
  cadence: PlanCadence;
  startDate: string; // anchors the weekday / day of the month of the reminders
}

export interface GoalEntry {
  id: string;
  date: string;
  type: 'contribution' | 'withdrawal'; // a withdrawal gives the money back to "available"
  amount: number; // always positive
  note?: string;
  reversed?: boolean; // reversed entries stay in the history and count for nothing
  businessOperationId?: string; // withdrawal used to buy inventory (kept for the audit trail)
}

export interface GoalModel {
  id: string;
  name: string;
  kind: GoalKind;
  customKind?: string;
  target: number;
  targetDate?: string;
  currency: 'DOP' | 'USD'; // only RD$ goals are supported for now
  plan?: GoalPlan;
  accountId?: string; // informational only
  status: GoalStatus;
  emergencyMonths?: number; // emergency fund: months of essential expenses to cover (1-12)
  skippedDates?: string[]; // reminders the user dismissed
  entries: GoalEntry[];
  createdAt: string;
}
