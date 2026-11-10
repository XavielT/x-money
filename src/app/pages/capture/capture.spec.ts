// Capture with a clear hierarchy: one big action first, the rest smaller, ONE status line with its way out, help folded away.
// The pixels (sizes, 44 px targets) are on the manual checklist; here the structure is tested.
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureService } from '../../../shared/services/capture.service';
import { account } from '../../../shared/testing/builders';
import { MemoryStorage, boot } from '../../../shared/testing/memory-storage';
import { CaptureComponent } from './capture';

async function render(prepare?: () => void) {
  boot(new MemoryStorage().seed({ accounts: [account({ id: 'a1' })], transactions: [] }));
  prepare?.();
  const fixture = TestBed.createComponent(CaptureComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement, component: fixture.componentInstance, capture: TestBed.inject(CaptureService) };
}
const button = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

describe('Capture screen: hierarchy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts with ONE main action (the camera) first and big; the others are the smaller row', async () => {
    const { root } = await render();
    expect(root.querySelectorAll('.capture-primary').length).toBe(1);
    expect(root.querySelector('.capture-primary')?.textContent).toContain('Take a photo');
    const main = root.querySelector('.capture-main') as HTMLElement;
    const secondary = root.querySelector('.capture-secondary') as HTMLElement;
    expect(main.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the alternative sits beside it; gallery, PDF and voice are in the smaller row
    expect(main.querySelector('.capture-alt')?.textContent).toContain('Type or paste');
    const secondaryText = secondary.textContent ?? '';
    expect(secondaryText).toContain('Gallery');
    expect(secondaryText).toContain('PDF');
    expect(secondary.querySelector('.capture-primary')).toBeNull();
  });

  it('nothing else competes on arrival: no text box, no send button, no previews', async () => {
    const { root } = await render();
    expect(root.querySelector('textarea')).toBeNull();
    expect(root.querySelector('.capture-send')).toBeNull();
    expect(root.querySelector('.capture-items')).toBeNull();
  });

  it('"Type or paste" opens the text box and Send appears only when there is something to send', async () => {
    const env = await render();
    button(env.root, 'Type or paste')!.click();
    env.fixture.detectChanges();
    const box = env.root.querySelector('textarea') as HTMLTextAreaElement;
    expect(box).toBeTruthy();
    expect(env.root.querySelector('.capture-send')).toBeNull();
    env.component.text.set('I spent 1,500 pesos');
    env.fixture.detectChanges();
    expect(env.root.querySelector('.capture-send')).toBeTruthy();
  });

  it('"How it works" is folded by default and holds the long help text', async () => {
    const { root } = await render();
    const how = root.querySelector('details.capture-how') as HTMLDetailsElement;
    expect(how.open).toBe(false);
    expect(how.textContent).toContain('You get a DRAFT to approve');
    // the long note is no longer loose on the page
    expect(Array.from(root.querySelectorAll('.capture-note')).every((n) => n.closest('details.capture-how'))).toBe(true);
  });

  it('Smart capture off is one line of status with the way to turn it on, not a card', async () => {
    const { root } = await render();
    const status = root.querySelector('.capture-status') as HTMLElement;
    expect(status.getAttribute('data-kind')).toBe('info');
    expect(status.textContent).toContain('Smart capture is off');
    expect(status.querySelector('a')?.getAttribute('href')).toBe('/settings/features');
    expect(root.querySelector('.capture-off')).toBeNull();
  });
});

describe('Capture screen: one status line and the way out of each state', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a failed send shows the error and "Try again", which sends again', async () => {
    const env = await render();
    const send = vi.spyOn(env.component, 'sendAll').mockResolvedValue();
    env.component.lastAttempt.set('send');
    env.component.message.set('Nothing could be read. Enter the movement by hand.');
    env.fixture.detectChanges();
    const status = env.root.querySelector('.capture-status') as HTMLElement;
    expect(status.getAttribute('data-kind')).toBe('error');
    expect(env.root.querySelectorAll('.capture-status').length).toBe(1);
    button(env.root, 'Try again')!.click();
    expect(send).toHaveBeenCalledTimes(1);
    expect(env.component.message()).toBe(''); // the old error is cleared while it retries
  });

  it('a failed dictation shows "Try again", which listens again', async () => {
    const env = await render();
    const dictate = vi.spyOn(env.component, 'dictate').mockResolvedValue();
    env.component.lastAttempt.set('dictate');
    env.component.message.set('Nothing was heard. Try again or type it.');
    env.fixture.detectChanges();
    button(env.root, 'Try again')!.click();
    expect(dictate).toHaveBeenCalledTimes(1);
  });

  it('captures waiting for the connection: one line with the count and "Try again", which looks for the connection', async () => {
    const env = await render(() => {
      const capture = TestBed.inject(CaptureService);
      vi.spyOn(capture, 'queueSize').mockReturnValue(2);
      vi.spyOn(capture, 'processQueue').mockImplementation(async () => undefined as never);
    });
    const status = env.root.querySelector('.capture-status') as HTMLElement;
    expect(status.textContent).toContain('2 waiting for the connection');
    button(env.root, 'Try again')!.click();
    expect(env.capture.processQueue).toHaveBeenCalledTimes(1);
  });

  it('a problem with the picked file has no fake retry: the actions to pick again are right above', async () => {
    const env = await render();
    env.component.lastAttempt.set('files');
    env.component.message.set('The file is too large (5 MB at most). Crop it or take a smaller picture.');
    env.fixture.detectChanges();
    expect(env.root.querySelector('.capture-status')?.getAttribute('data-kind')).toBe('error');
    expect(button(env.root, 'Try again')).toBeUndefined();
    const status = env.root.querySelector('.capture-status') as HTMLElement;
    const main = env.root.querySelector('.capture-main') as HTMLElement;
    expect(main.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('busy states (reading, listening) are the same line, with no retry', async () => {
    const env = await render();
    env.component.sending.set(true);
    env.fixture.detectChanges();
    expect(env.root.querySelector('.capture-status')?.getAttribute('data-kind')).toBe('busy');
    expect(env.root.querySelector('.capture-status')?.textContent).toContain('Reading…');
    expect(button(env.root, 'Try again')).toBeUndefined();
    env.component.sending.set(false);
    env.component.listening.set(true);
    env.fixture.detectChanges();
    expect(env.root.querySelector('.capture-status')?.textContent).toContain('Listening…');
  });

  it('the drafts waiting for review are a counter row below, going to the review screen (which is not touched)', async () => {
    const env = await render(() => {
      const capture = TestBed.inject(CaptureService);
      vi.spyOn(capture.drafts, 'pendingCount').mockReturnValue(3);
    });
    const row = env.root.querySelector('a.capture-pending') as HTMLAnchorElement;
    expect(row.getAttribute('href')).toBe('/capture/review');
    expect(row.textContent).toContain('3');
  });
});
