import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TransactionModel } from '../../models/transaction.model';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { CategoryService } from '../../services/category.service';
import { AccountService } from '../../services/account.service';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-transaction-item',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './transaction-item.html',
  styleUrl: './transaction-item.scss',
})
export class TransactionItem {
  @Input({ required: true }) transaction!: TransactionModel;

  constructor(
    public categoryService: CategoryService,
    public accountService: AccountService,
    public settings: SettingsService
  ) {}

  get category() {
    return this.transaction.categoryId
      ? this.categoryService.byId(this.transaction.categoryId)
      : undefined;
  }

  get account() {
    return this.accountService.byId(this.transaction.accountId);
  }

  get toAccount() {
    return this.transaction.toAccountId
      ? this.accountService.byId(this.transaction.toAccountId)
      : undefined;
  }
}
