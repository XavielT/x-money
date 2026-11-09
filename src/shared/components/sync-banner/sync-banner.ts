import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { StorageService } from '../../services/storage.service';
import { SyncService } from '../../services/sync.service';

// Thin strip at the top for things that must not go unnoticed: read-only mode (app older
// than the data) and a wrong device clock. The backup reminder lives on Home.
@Component({
  selector: 'app-sync-banner',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './sync-banner.html',
  styleUrl: './sync-banner.scss',
})
export class SyncBannerComponent {
  skewDismissed = signal(false);

  constructor(
    public storage: StorageService,
    public sync: SyncService
  ) {}
}
