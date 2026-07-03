import { Injectable } from '@angular/core';

// Generic localStorage wrapper. Every collection is stored as one JSON snapshot.
// TODO: swap for IndexedDB (or HttpClient sync) if data outgrows localStorage.
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly prefix = 'x-money:';

  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(this.prefix + key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  set<T>(key: string, value: T): void {
    localStorage.setItem(this.prefix + key, JSON.stringify(value));
  }

  remove(key: string): void {
    localStorage.removeItem(this.prefix + key);
  }

  clearAll(): void {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(this.prefix))
      .forEach((key) => localStorage.removeItem(key));
  }
}
