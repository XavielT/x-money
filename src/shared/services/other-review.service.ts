import { Injectable, computed } from '@angular/core';
import { OtherGroup, otherGroups } from '../domain/other-review';
import { CategoryService } from './category.service';
import { TextRuleService } from './text-rule.service';
import { TransactionService } from './transaction.service';

// The expenses filed under "Other", grouped by place, and the one-tap fix: every movement of a group goes to the chosen
// category through the SAME edit as everywhere else (audited, a reconciled movement is left alone), and the app remembers the
// place so the next one needs no tap. Balances never change: only the category does.
@Injectable({ providedIn: 'root' })
export class OtherReviewService {
  groups = computed<OtherGroup[]>(() => otherGroups(this.transactions.transactions(), (id) => !!this.categories.byId(id)));
  // how many movements wait in "Other" (what a banner shows)
  total = computed(() => this.groups().reduce((n, g) => n + g.count, 0));

  constructor(
    private transactions: TransactionService,
    private categories: CategoryService,
    private rules: TextRuleService
  ) {}

  apply(group: OtherGroup, categoryId: string): { changed: number; skipped: number } {
    let changed = 0;
    let skipped = 0;
    if (!this.categories.byId(categoryId)) return { changed, skipped: group.ids.length };
    for (const id of group.ids) {
      const r = this.transactions.correct(id, { categoryId, subcategoryId: undefined });
      if (r.ok) changed++;
      else skipped++;
    }
    if (changed) this.rules.learn('expense', group.label, categoryId);
    return { changed, skipped };
  }
}
