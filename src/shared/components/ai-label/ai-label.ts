import { Component } from '@angular/core';
import { TranslatePipe } from '../../pipes/translate.pipe';

// Every text written by AI carries this label: it never replaces a calculation or a confirmed figure
@Component({
  selector: 'app-ai-label',
  standalone: true,
  imports: [TranslatePipe],
  template: `<small class="ai-label">✨ {{ 'Generated with AI · the figures are calculated on your device' | t }}</small>`,
  styles: [
    `
      .ai-label {
        color: var(--main-ultra-light);
        font-size: 0.7rem;
      }
    `,
  ],
})
export class AiLabelComponent {}
