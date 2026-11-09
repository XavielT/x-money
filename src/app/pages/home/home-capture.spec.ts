// Capture from Home: a camera in the header (with the number of pending drafts) and, only when drafts are
// waiting, a card on top that goes to the review.
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MemoryStorage, boot } from '../../../shared/testing/memory-storage';
import { HomeComponent } from './home';

function render(drafts: { id: string; status: string }[]) {
  boot(new MemoryStorage().seed({ accounts: [], transactions: [], capture_drafts: drafts }));
  const fixture = TestBed.createComponent(HomeComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('home: capture entry points', () => {
  it('the header has the camera, to /capture, with a badge equal to the pending drafts (queued and approved do not count)', () => {
    const root = render([
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'duplicate' },
      { id: 'c', status: 'approved' },
      { id: 'd', status: 'queued' },
    ]);
    const camera = root.querySelector('header a.home-capture') as HTMLAnchorElement;
    expect(camera.getAttribute('href')).toBe('/capture');
    expect(camera.querySelector('.home-capture-badge')?.textContent?.trim()).toBe('2');
    // next to the gear, inside the header
    expect(root.querySelector('header a.home-settings')).toBeTruthy();
  });

  it('with pending drafts, a review card sits above everything else and goes to /capture/review', () => {
    const root = render([{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }, { id: 'c', status: 'pending' }]);
    const card = root.querySelector('a.home-review') as HTMLAnchorElement;
    expect(card).toBeTruthy();
    expect(card.getAttribute('href')).toBe('/capture/review');
    expect(card.textContent).toContain('3 captures waiting for your review');
    const page = root.querySelector('.home') as HTMLElement;
    const children = Array.from(page.children);
    expect(children.indexOf(card)).toBe(1); // header, then the card
  });

  it('one pending draft reads in the singular', () => {
    const root = render([{ id: 'a', status: 'pending' }]);
    expect(root.querySelector('a.home-review')?.textContent).toContain('1 capture waiting for your review');
  });

  it('without pending drafts: no card and no badge, but the camera is still there', () => {
    const root = render([{ id: 'c', status: 'approved' }]);
    expect(root.querySelector('a.home-review')).toBeNull();
    expect(root.querySelector('.home-capture-badge')).toBeNull();
    expect(root.querySelector('header a.home-capture')).toBeTruthy();
  });
});
