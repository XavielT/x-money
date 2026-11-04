import { TransactionType } from './transaction.model';

export interface CategoryModel {
  id: string;
  name: string;
  icon: string; // emoji
  color: string;
  type: TransactionType;
  system?: boolean; // app-managed (e.g. reconciliation adjustment): hidden from pickers
}
