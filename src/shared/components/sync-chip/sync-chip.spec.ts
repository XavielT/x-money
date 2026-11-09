import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../../services/auth.service';
import { MailCaptureService } from '../../services/mail-capture.service';
import { SyncService } from '../../services/sync.service';
import { SyncChipComponent } from './sync-chip';

function render(sync: { status: string; lastSyncAt: number | null }, mode = 'signed-in', scanning = false) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { mode: signal(mode) } },
      { provide: SyncService, useValue: { status: signal(sync.status), lastSyncAt: signal(sync.lastSyncAt), link: signal({ phase: 'none' }) } },
      { provide: MailCaptureService, useValue: { scanning: signal(scanning) } },
    ],
  });
  const f = TestBed.createComponent(SyncChipComponent);
  f.detectChanges();
  return f.nativeElement.querySelector('.chip') as HTMLElement;
}

describe('Home sync chip', () => {
  it('syncing: "Updating…", visible', () => {
    const chip = render({ status: 'syncing', lastSyncAt: 5 });
    expect(chip.classList.contains('on')).toBe(true);
    expect(chip.textContent).toContain('Updating…');
  });

  it('before the first sync of the session it also says Updating…', () => {
    expect(render({ status: 'idle', lastSyncAt: null }).textContent).toContain('Updating…');
  });

  it('offline: says so, with the time of the last sync', () => {
    const at = new Date(2026, 10, 9, 17, 44).getTime();
    const chip = render({ status: 'offline', lastSyncAt: at });
    expect(chip.textContent).toContain('Offline: showing the last saved data');
    expect(chip.textContent).toMatch(/·\s*\d/);
  });

  it('idle after a sync: no text, but the row keeps its place (it is hidden, not removed)', () => {
    const chip = render({ status: 'idle', lastSyncAt: 5 });
    expect(chip).toBeTruthy();
    expect(chip.classList.contains('on')).toBe(false);
    expect(chip.textContent?.trim()).toBe('');
  });

  it('a local-only app says nothing', () => {
    expect(render({ status: 'idle', lastSyncAt: null }, 'local').classList.contains('on')).toBe(false);
  });

  it('the mail scan shows Updating… too', () => {
    expect(render({ status: 'idle', lastSyncAt: 5 }, 'signed-in', true).textContent).toContain('Updating…');
  });
});
