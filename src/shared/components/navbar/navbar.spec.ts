// Capture is no longer a floating button: the bar holds four tabs and the "+", nothing above it.
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MemoryStorage, boot } from '../../testing/memory-storage';
import { Navbar } from './navbar';

describe('navbar', () => {
  it('has no link to /capture, no capture badge, and keeps four tabs plus the "+"', () => {
    boot(new MemoryStorage().seed({ accounts: [], transactions: [], capture_drafts: [{ id: 'd1', status: 'pending' }] }));
    const fixture = TestBed.createComponent(Navbar);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('a[href="/capture"]')).toBeNull();
    expect(root.querySelector('.navbar-capture, .navbar-badge')).toBeNull();
    expect(root.querySelectorAll('a.navbar-item').length).toBe(4);
    const add = root.querySelector('a.navbar-add') as HTMLAnchorElement;
    expect(add.getAttribute('href')).toBe('/add');
  });
});
