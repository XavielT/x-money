import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Indicator } from '../../domain/dashboard';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AiCardComponent } from '../ai-card/ai-card';
import { SettingsService } from '../../services/settings.service';

// "How was it calculated?": the formula, every component with its amount, and what is data and
// what is an estimate (rule 10). Reused by the assistant screens later.
@Component({
  selector: 'app-indicator-sheet',
  standalone: true,
  imports: [CommonModule, TranslatePipe, AiCardComponent],
  templateUrl: './indicator-sheet.html',
  styleUrl: './indicator-sheet.scss',
})
export class IndicatorSheetComponent {
  @Input({ required: true }) indicator!: Indicator;
  @Output() closed = new EventEmitter<void>();

  constructor(public settings: SettingsService) {}

  kindLabel(kind: 'data' | 'estimate' | 'excluded'): string {
    return kind === 'data' ? 'Data' : kind === 'estimate' ? 'Estimate' : 'Not included';
  }
}
