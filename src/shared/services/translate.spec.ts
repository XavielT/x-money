// The Spanish map loads on demand (only for Spanish users); English never needs it.
import { TestBed } from '@angular/core/testing';
import { MemoryStorage } from '../testing/memory-storage';
import { StorageService } from './storage.service';
import { TranslateService } from './translate.service';

function service(lang: 'en' | 'es') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: new MemoryStorage().seed({ lang }) }] });
  return TestBed.inject(TranslateService);
}

describe('TranslateService', () => {
  it('English text is the key and needs no map', async () => {
    const t = service('en');
    await t.ensureLoaded();
    expect(t.instant('Income')).toBe('Income');
  });

  it('Spanish loads once at start and translates, with placeholders', async () => {
    const t = service('es');
    expect(t.instant('Income source (optional)')).toBe('Income source (optional)'); // not loaded yet: falls back to English
    await t.ensureLoaded();
    expect(t.instant('Income source (optional)')).toBe('Fuente de ingreso (opcional)');
    expect(t.instant('Declared: {declared}, but it varied {percent}%', { declared: 'recurrente', percent: '38' })).toBe('Declarada: recurrente, pero varió 38 %');
    expect(t.instant('A key nobody translated')).toBe('A key nobody translated');
  });
});
