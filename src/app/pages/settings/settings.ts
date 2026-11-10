import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { APP_VERSION } from '../../../shared/config/app-version';
import { MODULE_IDS } from '../../../shared/domain/modules';
import { SETTINGS_SECTIONS, isSettingsSection, menuStatus } from '../../../shared/domain/settings-menu';
import { AuthService } from '../../../shared/services/auth.service';
import { CategoryService } from '../../../shared/services/category.service';
import { LockService } from '../../../shared/services/lock.service';
import { ModuleService } from '../../../shared/services/module.service';
import { RecurringService } from '../../../shared/services/recurring.service';
import { SettingsService } from '../../../shared/services/settings.service';
import { SyncService } from '../../../shared/services/sync.service';
import { TranslateService } from '../../../shared/services/translate.service';

// Settings is a menu: one row per screen, each with a one-line status. The screens live in ./screens.
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsComponent {
  readonly version = APP_VERSION;

  rows = computed(() => {
    const facts = {
      language: this.translate.lang(),
      currency: this.settings.currency(),
      categories: this.categories.categories().length,
      recurringActive: this.recurring.recurring().filter((r) => r.active).length,
      recurringTotal: this.recurring.recurring().length,
      riskAt: this.settings.budget().riskAt,
      modulesOn: MODULE_IDS.filter((id) => this.modules.state()[id]).length,
      signedIn: this.auth.mode() !== 'local',
      lastSyncTime: this.sync.lastSyncAt() ? new Date(this.sync.lastSyncAt()!).toLocaleTimeString(this.translate.locale(), { hour: 'numeric', minute: '2-digit' }) : null,
      pending: this.sync.pending(),
      lockOn: this.lock.enabled(),
      email: this.auth.email() ?? '',
      version: APP_VERSION,
    };
    return SETTINGS_SECTIONS.map((s) => {
      const status = menuStatus(s.id, facts);
      return { ...s, status: this.translate.instant(status.key, status.params) };
    });
  });

  constructor(
    private translate: TranslateService,
    private settings: SettingsService,
    private categories: CategoryService,
    private recurring: RecurringService,
    private modules: ModuleService,
    private auth: AuthService,
    private sync: SyncService,
    private lock: LockService,
    route: ActivatedRoute,
    router: Router
  ) {
    // an old link or bookmark such as /settings#data lands on the screen that now holds that section
    route.fragment.pipe(takeUntilDestroyed()).subscribe((fragment) => {
      if (isSettingsSection(fragment)) void router.navigate(['/settings', fragment], { replaceUrl: true });
    });
  }
}
