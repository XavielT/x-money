import { TransactionType } from './transaction.model';

export interface CategoryModel {
  id: string;
  name: string;
  icon: string; // emoji
  color: string;
  type: TransactionType;
}
