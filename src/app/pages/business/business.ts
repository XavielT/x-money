import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BusinessOperationModel, ExpenseKind, OperationCategory, OperationStatus, PaymentMethod } from '../../../shared/models/business-operation.model';
import { TransactionModel } from '../../../shared/models/transaction.model';
import { TxErrorCode } from '../../../shared/domain/validation';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { TX_ERROR_TEXT } from '../../../shared/ui/tx-error-text';
import { AccountService } from '../../../shared/services/account.service';
import { BusinessResult, BusinessService } from '../../../shared/services/business.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { TranslateService } from '../../../shared/services/translate.service';
import { localIso } from '../../../shared/domain/dates';

type View = 'summary' | 'detail' | 'new' | 'sale' | 'reserve' | 'expense' | 'withdraw' | 'cost' | 'convert';

const CATEGORY_LABELS: Record<OperationCategory, string> = { accessory: 'Accessory', part: 'Part', vehicle: 'Vehicle', other: 'Other' };
const STATUS_LABELS: Record<OperationStatus, string> = { available: 'Available', reserved: 'Reserved', sold: 'Sold' };
const EXPENSE_LABELS: Record<ExpenseKind, string> = { transport: 'Transport', repair: 'Repair', advertising: 'Advertising', commission: 'Commission', 'transfer-taxes': 'Transfer and taxes', other: 'Other' };
const METHOD_LABELS: Record<PaymentMethod, string> = { cash: 'Cash', transfer: 'Bank transfer', other: 'Other' };

// English phrases are the translation keys
const ERRORS: Record<string, string> = {
  name: 'Give it a name.',
  quantity: 'The quantity must be above zero (and not more than what is left).',
  cost: 'The cost must be above zero.',
  date: 'Enter a valid date.',
  target: 'The target price cannot be negative.',
  price: 'The price cannot be negative.',
  deposit: 'The deposit cannot be more than the price. Cancel the reservation or change the price.',
  exceeds: 'That is more than what is available.',
  sold: 'Everything is already sold.',
  'before-purchase': 'The sale cannot be before the purchase.',
  amount: 'Enter an amount greater than zero.',
  account: 'Choose an existing account.',
  currency: 'Business operations are in RD$ only for now: choose a RD$ account.',
  'has-sales': 'It has active sales. Reverse them first.',
  'has-expenses': 'It has expenses. Remove them first.',
  'has-deposit': 'It has a deposit. Cancel the reservation first.',
  'not-available': 'It is not available.',
  'not-found': 'Not found.',
  'read-only': 'Update X Money to save changes.',
};

// Business: buy inventory (working capital, not a personal expense), record expenses, reserve
// with a deposit, sell (also in parts) and see the profit. The screens only show what
// BusinessService calculates.
@Component({
  selector: 'app-business',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './business.html',
  styleUrl: './business.scss',
})
export class BusinessComponent {
  readonly categories = Object.keys(CATEGORY_LABELS) as OperationCategory[];
  readonly expenseKinds = Object.keys(EXPENSE_LABELS) as ExpenseKind[];
  readonly methods = Object.keys(METHOD_LABELS) as PaymentMethod[];
  readonly statuses: OperationStatus[] = ['available', 'reserved', 'sold'];
  private now = new Date();
  year = this.now.getFullYear();
  month = this.now.getMonth() + 1;

  view = signal<View>('summary');
  selectedId = signal<string | null>(null);
  message = signal('');
  filterStatus = signal<'' | OperationStatus>('');
  filterCategory = signal<'' | OperationCategory>('');

  selected = computed(() => this.business.byId(this.selectedId() ?? ''));
  facts = computed(() => (this.selected() ? this.business.factsOf(this.selected()!) : []));
  list = computed(() =>
    this.business.operations().filter((o) => (!this.filterStatus() || o.status === this.filterStatus()) && (!this.filterCategory() || o.category === this.filterCategory()))
  );
  monthProfit = computed(() => this.business.monthProfit(this.year, this.month));
  yearProfit = computed(() => this.business.yearProfit(this.year));
  monthReturn = computed(() => this.business.monthReturn(this.year, this.month));
  payAccounts = computed(() => this.accounts.activeAccounts().filter((a) => a.currency !== 'USD'));

  // form fields (shared by the small forms)
  fName = '';
  fCategory: OperationCategory = 'part';
  fQuantity: number | null = 1;
  fCost: number | null = null;
  fDate = '';
  fAccount = '';
  fSupplier = '';
  fTarget: number | null = null;
  fNotes = '';
  fPrice: number | null = null;
  fMethod: PaymentMethod = 'cash';
  fBuyer = '';
  fDeposit: number | null = null;
  fAmount: number | null = null;
  fKind: ExpenseKind = 'other';
  fNote = '';
  fConvertTx = '';

  constructor(
    public business: BusinessService,
    private accounts: AccountService,
    public settings: SettingsService,
    private translate: TranslateService
  ) {
    this.fDate = localIso(this.now);
    this.fAccount = this.payAccounts()[0]?.id ?? '';
  }

  catLabel(c: OperationCategory): string {
    return CATEGORY_LABELS[c];
  }

  statusLabel(s: OperationStatus): string {
    return STATUS_LABELS[s];
  }

  expenseLabel(k: ExpenseKind): string {
    return EXPENSE_LABELS[k];
  }

  methodLabel(m: PaymentMethod): string {
    return METHOD_LABELS[m];
  }

  accountName(id: string): string {
    return this.accounts.byId(id)?.name ?? '';
  }

  ageOf(op: BusinessOperationModel): number {
    return this.business.inventory().items.find((i) => i.op.id === op.id)?.ageDays ?? 0;
  }

  costLeft(op: BusinessOperationModel): number {
    return this.business.inventory().items.find((i) => i.op.id === op.id)?.cost ?? 0;
  }

  slowLevel(op: BusinessOperationModel): string {
    return this.business.slow().find((s) => s.item.op.id === op.id)?.level ?? '';
  }

  private reset(): void {
    this.fName = '';
    this.fCategory = 'part';
    this.fQuantity = 1;
    this.fCost = null;
    this.fDate = localIso(new Date());
    this.fSupplier = '';
    this.fTarget = null;
    this.fNotes = '';
    this.fPrice = null;
    this.fMethod = 'cash';
    this.fBuyer = '';
    this.fDeposit = null;
    this.fAmount = null;
    this.fKind = 'other';
    this.fNote = '';
    this.message.set('');
  }

  go(view: View, op?: BusinessOperationModel): void {
    this.reset();
    if (op) this.selectedId.set(op.id);
    if (view === 'sale' && op) {
      this.fQuantity = Math.max(1, this.business.inventory().items.find((i) => i.op.id === op.id)?.remaining ?? 1);
      this.fPrice = op.targetPrice ?? null;
      this.fAccount = this.payAccounts()[0]?.id ?? '';
    }
    if (view === 'cost' && op) this.fCost = op.totalCost;
    this.view.set(view);
  }

  open(op: BusinessOperationModel): void {
    this.selectedId.set(op.id);
    this.view.set('detail');
    this.message.set('');
  }

  back(): void {
    if (this.view() === 'summary') history.back();
    else this.view.set(this.view() === 'new' || this.view() === 'withdraw' || this.view() === 'convert' || !this.selectedId() ? 'summary' : 'detail');
    this.message.set('');
  }

  private report(result: BusinessResult, done: View): void {
    if (!result.ok) {
      const key = ERRORS[result.error];
      this.message.set(this.translate.instant(key ?? TX_ERROR_TEXT[result.error as TxErrorCode] ?? 'The operation could not be saved.'));
      return;
    }
    this.view.set(done);
    this.message.set('');
  }

  // ----- forms

  saveNew(): void {
    const r = this.business.addOperation({
      name: this.fName,
      category: this.fCategory,
      quantity: Number(this.fQuantity ?? 1),
      totalCost: Number(this.fCost),
      acquiredAt: this.fDate,
      accountId: this.fAccount,
      supplier: this.fSupplier,
      targetPrice: this.fTarget ? Number(this.fTarget) : undefined,
      notes: this.fNotes,
    });
    if (r.ok) this.selectedId.set(r.id);
    this.report(r, 'detail');
  }

  saveSale(): void {
    this.report(
      this.business.registerSale(this.selectedId()!, { date: this.fDate, quantity: Number(this.fQuantity), price: Number(this.fPrice ?? 0), method: this.fMethod, accountId: this.fAccount, buyer: this.fBuyer }),
      'detail'
    );
  }

  saveReserve(): void {
    this.report(this.business.reserve(this.selectedId()!, { date: this.fDate, buyer: this.fBuyer, deposit: this.fDeposit ? Number(this.fDeposit) : 0, accountId: this.fAccount }), 'detail');
  }

  saveExpense(): void {
    this.report(this.business.addExpense(this.selectedId()!, { date: this.fDate, amount: Number(this.fAmount), kind: this.fKind, accountId: this.fAccount, note: this.fNote }), 'detail');
  }

  saveCost(): void {
    this.report(this.business.correctCost(this.selectedId()!, Number(this.fCost)), 'detail');
  }

  saveWithdraw(): void {
    this.report(this.business.withdrawProfit(Number(this.fAmount), this.fDate, this.fNote), 'summary');
  }

  cancelReservation(op: BusinessOperationModel): void {
    if (confirm(this.translate.instant('Cancel the reservation? A deposit is given back (its movement is reversed).'))) this.report(this.business.cancelReservation(op.id), 'detail');
  }

  reverseSale(op: BusinessOperationModel, saleId: string): void {
    if (confirm(this.translate.instant('Reverse this sale? The article becomes available again and the capital comes back. Nothing is deleted.'))) this.report(this.business.reverseSale(op.id, saleId), 'detail');
  }

  correctPrice(op: BusinessOperationModel, saleId: string): void {
    const value = prompt(this.translate.instant('New price of this sale'));
    if (value === null) return;
    this.report(this.business.correctSale(op.id, saleId, { price: Number(value) }), 'detail');
  }

  removeExpense(op: BusinessOperationModel, expenseId: string): void {
    this.report(this.business.removeExpense(op.id, expenseId), 'detail');
  }

  removeOperation(op: BusinessOperationModel): void {
    if (!confirm(this.translate.instant('Delete this operation? Its purchase is reversed, not erased.'))) return;
    this.report(this.business.remove(op.id), 'summary');
  }

  // ----- converting manual sales

  convertible(): TransactionModel[] {
    return this.business.convertible();
  }

  openConvert(t: TransactionModel): void {
    this.reset();
    this.fConvertTx = t.id;
    this.view.set('convert');
  }

  saveConvert(): void {
    const r = this.business.convertToOperation(this.fConvertTx, { name: this.fName, category: this.fCategory, quantity: Number(this.fQuantity ?? 1) });
    if (r.ok) this.selectedId.set(r.id);
    this.report(r, 'detail');
  }
}
