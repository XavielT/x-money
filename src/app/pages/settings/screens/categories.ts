import { Component } from '@angular/core';
import { CategoryManagerComponent } from '../../../../shared/components/category-manager/category-manager';
import { SettingsHeaderComponent } from '../../../../shared/components/settings-header/settings-header';

// Settings > Categories: the category manager (tree, nature, frequency and irregular patterns).
@Component({
  selector: 'app-settings-categories',
  standalone: true,
  imports: [SettingsHeaderComponent, CategoryManagerComponent],
  template: `
    <div class="x-page settings">
      <app-settings-header title="Categories" />
      <app-category-manager />
    </div>
  `,
  styleUrl: '../settings.scss',
})
export class SettingsCategoriesComponent {}
