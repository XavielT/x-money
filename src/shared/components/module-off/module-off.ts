import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModuleId } from '../../domain/modules';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { ModuleService } from '../../services/module.service';

// A strip at the top of a feature's page when that feature is switched off. The page still opens (deep links from notices
// must work); the button turns it on and the user stays where they are.
@Component({
  selector: 'app-module-off',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="modoff x-card" *ngIf="!modules.isOn(module())" role="status">
      <span>{{ 'This feature is off.' | t }}</span>
      <button class="modoff-btn" (click)="modules.set(module(), true)">{{ 'Turn it on' | t }}</button>
    </div>
  `,
  styles: `
    .modoff {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 44px;
      padding: 8px 14px;
      margin-bottom: 12px;
      border-color: var(--Hub);
      font-size: 0.85rem;
    }
    .modoff span {
      min-width: 0;
    }
    .modoff-btn {
      flex: none;
      min-height: 44px;
      padding: 0 14px;
      background: none;
      border: none;
      color: var(--Hub);
      font-weight: 600;
    }
  `,
})
export class ModuleOffComponent {
  module = input.required<ModuleId>();

  constructor(public modules: ModuleService) {}
}
