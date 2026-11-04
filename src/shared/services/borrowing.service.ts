import { Injectable, computed } from '@angular/core';
import { CapacityResult, IncomeTiers, Obligations, evaluateCapacity, incomeDropImpact, incomeTiers, monthlyEquivalent } from '../domain/borrowing';
import { minimumPayment } from '../domain/cards';
import { lastCompleteMonths, localIso } from '../domain/dates';
import { PERIODS_PER_YEAR, PayFrequency } from '../domain/loans';
import { round2, sumMoney } from '../utils/money';
import { BudgetService } from './budget.service';
import { CreditCardService } from './credit-card.service';
import { FixedExpenseService } from './fixed-expense.service';
import { IncomeService } from './income.service';
import { LoanService } from './loan.service';
import { TransactionService } from './transaction.service';

// Payment capacity (an estimate, always labelled so): income by level, the obligations it has to
// carry and the installment being simulated. Non-monetary benefits are not read at all (rule 4):
// BenefitService is not even a dependency of this service.
@Injectable({ providedIn: 'root' })
export class BorrowingService {
  constructor(
    private income: IncomeService,
    private fixed: FixedExpenseService,
    private budget: BudgetService,
    private cards: CreditCardService,
    private loans: LoanService,
    private transactions: TransactionService
  ) {}

  private today(): string {
    return localIso(this.transactions.clock());
  }

  // Average monthly net benefit of the business over the last 6 complete months (counted from its first month of activity)
  commercialMonthly(): number {
    const values = lastCompleteMonths(this.today(), 6).map((key) => this.income.monthBreakdown(Number(key.slice(0, 4)), Number(key.slice(5, 7))).commercialNetBenefit);
    const first = values.findIndex((v) => v !== 0);
    if (first < 0) return 0;
    const used = values.slice(first);
    return round2(sumMoney(used) / used.length);
  }

  tiers = computed<IncomeTiers>(() => incomeTiers(this.income.sources(), this.transactions.transactions(), this.today(), this.commercialMonthly()));

  // Minimum payments of the credit cards (RD$) + the installments of the active loans, per month
  existingDebts(): { cards: number; loans: number } {
    return {
      cards: sumMoney(this.cards.cards().map((c) => minimumPayment(this.cards.debtOf(c, 'DOP').owed, c.card, 'DOP'))),
      loans: this.loans.monthlyPayments(),
    };
  }

  obligations(): Obligations {
    const debts = this.existingDebts();
    const months = this.budget.variableHistoryMonths();
    const declared = months < 3;
    return {
      fixed: this.fixed.summary().monthly,
      variable: declared ? this.loans.settings().declaredVariable : this.budget.variableMedian(),
      debts: round2(debts.cards + debts.loans),
      variableBasis: declared ? 'declared' : 'history',
    };
  }

  // `installment` is the amount of one payment in the loan's own frequency; the percentages are monthly
  evaluate(installment: number, frequency: PayFrequency = 'monthly', incomeDropPercent = 0): CapacityResult {
    return evaluateCapacity(this.tiers(), this.loans.settings(), this.obligations(), monthlyEquivalent(installment, PERIODS_PER_YEAR[frequency]), incomeDropPercent);
  }

  dropImpact(installment: number, frequency: PayFrequency, drops: readonly number[]) {
    return incomeDropImpact(this.tiers(), this.loans.settings(), this.obligations(), monthlyEquivalent(installment, PERIODS_PER_YEAR[frequency]), drops);
  }
}
