import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AccountModel } from '../../models/account.model';
import { bankById } from '../../data/banks';

// Round "logo" badge for an account: bank initials over the brand color,
// or the account emoji for cash accounts / accounts without a bank.
@Component({
  selector: 'app-bank-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bank-badge.html',
  styleUrl: './bank-badge.scss',
})
export class BankBadge {
  @Input({ required: true }) account!: AccountModel;

  get bank() {
    return bankById(this.account.bankId);
  }
}
