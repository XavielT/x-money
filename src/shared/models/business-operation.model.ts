// Independent business activity (2.12.0): buying and reselling accessories, parts, vehicles.
// The money that buys inventory is WORKING CAPITAL, not an ordinary personal expense; the
// inventory is kept apart from personal assets (rule 6); a sale is revenue, the benefit is
// price - cost - expenses (rule 5).

export type OperationCategory = 'accessory' | 'part' | 'vehicle' | 'other';
export type OperationStatus = 'available' | 'reserved' | 'sold';
export type PaymentMethod = 'cash' | 'transfer' | 'other';

export interface BusinessSale {
  id: string;
  date: string;
  quantity: number; // units sold in this sale (a lot can be sold in parts)
  price: number; // the full price agreed for those units
  depositApplied: number; // the deposit already received: the sale's own movement is price - deposit
  method: PaymentMethod;
  accountId: string; // receiving account
  buyer?: string;
  txId?: string; // the income movement (scope business, origin business-sale); the balance is price - deposit
  depositTxId?: string; // the reservation deposit this sale used (restored if the sale is reversed)
  reversed?: boolean; // the sale was reversed: the units are available again
}

export type ExpenseKind = 'transport' | 'repair' | 'advertising' | 'commission' | 'transfer-taxes' | 'other';

export interface OperationExpense {
  id: string;
  date: string;
  amount: number;
  kind: ExpenseKind;
  accountId: string;
  note?: string;
  txId?: string; // the expense movement (scope business, origin business-expense)
  reversed?: boolean;
}

export interface Reservation {
  date: string;
  buyer?: string;
  deposit: number; // 0 when no deposit was received
  depositAccountId?: string;
  depositTxId?: string; // income-looking movement (origin business-deposit): NOT income, NOT profit
}

export interface BusinessOperationModel {
  id: string;
  name: string;
  category: OperationCategory;
  quantity: number; // units in the lot (1 by default)
  totalCost: number; // acquisition cost of the whole lot; the unit cost is totalCost / quantity, constant
  acquiredAt: string;
  accountId: string; // account that paid
  supplier?: string;
  targetPrice?: number; // expected price of the whole lot
  status: OperationStatus; // stored for the screens; always re-derived from the sales and the reservation
  notes?: string;
  purchaseTxId?: string; // the movement that bought it (scope business, origin business-purchase)
  sales: BusinessSale[];
  expenses: OperationExpense[];
  reservation?: Reservation;
  createdAt: string;
}

// Reference only, nothing forces the user to fill them
export interface ContactModel {
  id: string;
  name: string;
  phone?: string;
  kind: 'buyer' | 'supplier' | 'both';
  notes?: string;
}

// "Withdraw profit": how much of the net profit has already moved to personal use. A neutral
// movement between pools: it creates no income and moves no balance.
export interface BusinessWithdrawal {
  id: string;
  date: string;
  amount: number;
  note?: string;
}
