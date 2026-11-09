import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealAndFocus } from './reveal';

function host(): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = '<input id="a" /><input id="b" />';
  document.body.appendChild(el);
  return el;
}

describe('revealAndFocus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('tolerates a null host', () => {
    expect(() => revealAndFocus(null)).not.toThrow();
  });

  it('does not fail where scrollIntoView does not exist, and still focuses', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb());
    const el = host();
    (el as { scrollIntoView?: unknown }).scrollIntoView = undefined;
    revealAndFocus(el, '#b');
    expect(document.activeElement?.id).toBe('b');
    vi.unstubAllGlobals();
  });

  it('scrolls the host and focuses the first match of the selector', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb());
    const el = host();
    const scroll = vi.fn();
    el.scrollIntoView = scroll;
    revealAndFocus(el);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.id).toBe('a');
    vi.unstubAllGlobals();
  });

  it('uses instant scrolling when the user asks for reduced motion', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb());
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const el = host();
    const scroll = vi.fn();
    el.scrollIntoView = scroll;
    revealAndFocus(el);
    expect(scroll.mock.calls[0][0].behavior).toBe('auto');
    vi.unstubAllGlobals();
  });

  it('a missing field is fine', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb());
    const el = host();
    el.scrollIntoView = vi.fn();
    expect(() => revealAndFocus(el, '.nope')).not.toThrow();
    vi.unstubAllGlobals();
  });
});
