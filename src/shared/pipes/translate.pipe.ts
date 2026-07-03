import { Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '../services/translate.service';

// Usage: {{ 'Total balance' | t }} — English text is the key.
// Pure is fine: language switches reload the app.
@Pipe({ name: 't', standalone: true })
export class TranslatePipe implements PipeTransform {
  constructor(private translate: TranslateService) {}

  transform(key: string): string {
    return this.translate.instant(key);
  }
}
