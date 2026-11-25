import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { OtherReviewService } from '../../services/other-review.service';

// A line at the top of Transactions when 3 or more expenses wait under "Other". It is loaded on idle (@defer) so the
// History screen, which is part of the first load, does not carry the review logic.
@Component({
  selector: 'app-other-banner',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  template: `
    <a class="x-card banner" *ngIf="review.total() >= 3" routerLink="/settings/categories">
      📦 {{ review.total() }} {{ 'expenses are filed under Other. Put them where they belong' | t }} ›
    </a>
  `,
  styles: [
    `
      .banner {
        display: block;
        margin-bottom: 10px;
        padding: 10px 14px;
        font-size: 0.85rem;
        text-decoration: none;
        color: var(--text);
      }
    `,
  ],
})
export class OtherBannerComponent {
  constructor(public review: OtherReviewService) {}
}
