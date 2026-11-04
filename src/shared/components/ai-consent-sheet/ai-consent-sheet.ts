import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../pipes/translate.pipe';

// First use of an AI function: what leaves the device, with the exact content (the same structure
// that goes to the function), and a clear yes / no. It can always be opened again from Settings.
@Component({
  selector: 'app-ai-consent-sheet',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './ai-consent-sheet.html',
  styleUrl: '../indicator-sheet/indicator-sheet.scss',
})
export class AiConsentSheetComponent {
  @Input({ required: true }) title = '';
  @Input() description = '';
  @Input() preview: unknown = {};
  @Input() canConfirm = true;
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  json(): string {
    return JSON.stringify(this.preview, null, 2);
  }
}
