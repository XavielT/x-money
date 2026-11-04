import { Injectable, signal } from '@angular/core';
import { TextRule, matchRule, ruleWordFor } from '../ai/inputs';
import { StorageService } from './storage.service';

// Rules learned from what the user ACCEPTED (word -> category, income kind or item family). They
// are applied before any AI call, so the same note is never asked twice. Synced like any other
// collection: they hold only a word and a target, never a movement.
@Injectable({ providedIn: 'root' })
export class TextRuleService {
  private _rules = signal<TextRule[]>([]);
  rules = this._rules.asReadonly();

  constructor(private storage: StorageService) {
    this._rules.set(this.storage.get<TextRule[]>('textRules', []));
    this.storage.watch('textRules', (v) => this._rules.set((v as TextRule[] | undefined) ?? []));
  }

  match(note: string, scope: TextRule['scope']): TextRule | undefined {
    return matchRule(note, scope, this._rules());
  }

  // Remembers the word of a note for a target; returns false when the note has no useful word
  learn(scope: TextRule['scope'], note: string, target: string): boolean {
    if (this.storage.readOnly()) return false;
    const word = ruleWordFor(note);
    if (!word || !target) return false;
    const id = `${scope}:${word}`;
    const next = [...this._rules().filter((r) => r.id !== id), { id, scope, word, target, createdAt: new Date().toISOString() }];
    this._rules.set(next);
    this.storage.set('textRules', next);
    return true;
  }

  forget(id: string): void {
    if (this.storage.readOnly()) return;
    const next = this._rules().filter((r) => r.id !== id);
    this._rules.set(next);
    this.storage.set('textRules', next);
  }
}
