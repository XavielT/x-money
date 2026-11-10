import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UndoToastService } from './undo-toast.service';

describe('UndoToastService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a message and hides it by itself after a few seconds', () => {
    const toasts = new UndoToastService();
    toasts.show('Saved');
    expect(toasts.current()?.message).toBe('Saved');
    vi.advanceTimersByTime(toasts.durationMs - 1);
    expect(toasts.current()).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(toasts.current()).toBeNull();
  });

  it('Undo runs the action once and closes the toast; a second Undo does nothing', () => {
    const toasts = new UndoToastService();
    const undo = vi.fn();
    toasts.show('Saved', undo);
    toasts.undo();
    toasts.undo();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(toasts.current()).toBeNull();
  });

  it('after the time is up Undo is gone: nothing runs', () => {
    const toasts = new UndoToastService();
    const undo = vi.fn();
    toasts.show('Saved', undo);
    vi.advanceTimersByTime(toasts.durationMs + 1);
    toasts.undo();
    expect(undo).not.toHaveBeenCalled();
  });

  it('a newer toast replaces the older one and the older timer cannot close the newer', () => {
    const toasts = new UndoToastService();
    const first = vi.fn();
    toasts.show('First', first);
    vi.advanceTimersByTime(4000);
    toasts.show('Second');
    vi.advanceTimersByTime(3000); // the first one's timer would have fired by now
    expect(toasts.current()?.message).toBe('Second');
    toasts.undo();
    expect(first).not.toHaveBeenCalled();
  });

  it('a message without Undo can be dismissed', () => {
    const toasts = new UndoToastService();
    toasts.show('Saved');
    expect(toasts.current()?.undo).toBeUndefined();
    toasts.dismiss();
    expect(toasts.current()).toBeNull();
  });
});
