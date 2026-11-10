import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../pipes/translate.pipe';

// Top of every Settings sub-screen: back to the menu and the screen title.
@Component({
  selector: 'app-settings-header',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <header class="sh">
      <a class="sh-back" routerLink="/settings" [attr.aria-label]="'Back to Settings' | t">‹</a>
      <h1 class="x-page-title sh-title">{{ title() | t }}</h1>
    </header>
  `,
  styles: [
    `
      .sh { display: flex; align-items: center; gap: 4px; margin-bottom: 12px; }
      .sh-title { margin: 0; }
      .sh-back {
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 44px; min-height: 44px; margin-left: -10px;
        font-size: 1.8rem; line-height: 1; color: var(--text); text-decoration: none;
      }
    `,
  ],
})
export class SettingsHeaderComponent {
  title = input.required<string>();
}
