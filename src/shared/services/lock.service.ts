import { Injectable, computed, signal } from '@angular/core';
import { StorageService } from './storage.service';

// Simple PIN app lock. The PIN is never stored in plain text — only its
// SHA-256 hash. Locks on startup and whenever the app goes to background.
@Injectable({ providedIn: 'root' })
export class LockService {
  private _pinHash = signal<string | null>(null);
  private _locked = signal(false);

  locked = this._locked.asReadonly();
  enabled = computed(() => this._pinHash() !== null);

  constructor(private storage: StorageService) {
    this._pinHash.set(this.storage.get<string | null>('lock', null));
    this._locked.set(this._pinHash() !== null);
  }

  async enable(pin: string): Promise<void> {
    const hash = await this.hash(pin);
    this._pinHash.set(hash);
    this.storage.set('lock', hash);
  }

  disable(): void {
    this._pinHash.set(null);
    this.storage.remove('lock');
    this._locked.set(false);
  }

  lock(): void {
    if (this.enabled()) this._locked.set(true);
  }

  async unlock(pin: string): Promise<boolean> {
    const ok = (await this.hash(pin)) === this._pinHash();
    if (ok) this._locked.set(false);
    return ok;
  }

  async verify(pin: string): Promise<boolean> {
    return (await this.hash(pin)) === this._pinHash();
  }

  private async hash(pin: string): Promise<string> {
    const data = new TextEncoder().encode(`x-money:${pin}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
