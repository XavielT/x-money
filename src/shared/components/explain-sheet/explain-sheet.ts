import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EvidenceItem } from '../../domain/insights/types';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { SettingsService } from '../../services/settings.service';

// "Where does it come from?": the evidence with its source, the formula and the assumptions, and
// whether the figure is confirmed data or an estimate (rule 10). Every insight and projection of
// 2.15.0 uses it; the dashboard's IndicatorSheet keeps its own shape (components of one indicator).
@Component({
  selector: 'app-explain-sheet',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './explain-sheet.html',
  styleUrl: '../indicator-sheet/indicator-sheet.scss',
})
export class ExplainSheetComponent {
  @Input({ required: true }) title = '';
  @Input() evidence: readonly EvidenceItem[] = [];
  @Input() formula = '';
  @Input() assumptions: readonly string[] = [];
  @Input() state: 'confirmed' | 'estimate' | 'insufficient-history' = 'confirmed';
  @Input() period = '';
  @Output() closed = new EventEmitter<void>();

  constructor(public settings: SettingsService) {}

  num(e: EvidenceItem): number {
    return Number(e.value);
  }

  abs(e: EvidenceItem): number {
    return Math.abs(Number(e.value));
  }

  stateLabel(): string {
    return this.state === 'estimate' ? 'Estimate' : this.state === 'insufficient-history' ? 'Not enough history' : 'Confirmed data';
  }
}
