// "Edit in place": after a form opens under the element it belongs to, bring it into view and focus its first field.
// Pure DOM, tolerant of a missing host and of environments without scrollIntoView (jsdom).
export function revealAndFocus(host: HTMLElement | null, focusSelector = 'input'): void {
  if (!host) return;
  const run = () => {
    if (typeof host.scrollIntoView === 'function') {
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const rect = host.getBoundingClientRect();
      const fits = rect.height <= (window.innerHeight || 0) * 0.85;
      host.scrollIntoView({ block: fits ? 'nearest' : 'start', behavior: reduce ? 'auto' : 'smooth' });
    }
    const field = host.querySelector<HTMLElement>(focusSelector);
    // preventScroll: the scroll above already decided where the form sits
    field?.focus({ preventScroll: true });
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}
