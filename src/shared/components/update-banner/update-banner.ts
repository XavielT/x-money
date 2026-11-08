import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AppUpdateService } from '../../services/app-update.service';

// "A new version is ready": shown on every screen once an update was found (web or Android). Loaded on idle, so it
// costs nothing at start-up.
@Component({
  selector: 'app-update-banner',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './update-banner.html',
  styleUrl: './update-banner.scss',
})
export class UpdateBannerComponent {
  constructor(public updates: AppUpdateService) {}
}
