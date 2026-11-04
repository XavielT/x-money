import { BucketKind } from '../models/budget.model';

// English phrases are the translation keys
export const BUCKET_LABELS: Record<BucketKind, string> = {
  essential: 'Essential expenses',
  food: 'Food',
  transport: 'Transport',
  entertainment: 'Entertainment',
  'family-home': 'Family and home',
  savings: 'Savings',
  emergency: 'Emergencies',
  'business-capital': 'Business capital',
  'debt-payments': 'Debt payments',
  free: 'Free money',
};
