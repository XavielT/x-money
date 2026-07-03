import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AccountModel } from '../../models/account.model';
import { BankModel } from '../../models/bank.model';
import { bankById } from '../../data/banks';

// Round "logo" badge: the bank's logo image on a light tile, initials over the
// brand color when there is no image, or the account emoji for cash accounts.
@Component({
  selector: 'app-bank-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bank-badge.html',
  styleUrl: './bank-badge.scss',
})
export class BankBadge {
  @Input() account?: AccountModel;
  @Input() bank?: BankModel;

  imgFailed = false;

  get resolvedBank(): BankModel | undefined {
    return this.bank ?? bankById(this.account?.bankId);
  }
}
