// Opening the app again looks for new bank notices, but not more often than every 3 minutes.
import { describe, expect, it } from 'vitest';
import { MAIL_SCAN_MIN_GAP_MS, mailScanDue } from './mail';

const NOW = Date.parse('2026-11-08T20:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('mailScanDue', () => {
  it('a mailbox never scanned is due', () => expect(mailScanDue(undefined, NOW)).toBe(true));

  it('right after a scan it is not due: switching apps back and forth does not hammer the mailbox', () => {
    expect(mailScanDue(ago(0), NOW)).toBe(false);
    expect(mailScanDue(ago(MAIL_SCAN_MIN_GAP_MS - 1), NOW)).toBe(false);
  });

  it('after the gap it is due again', () => {
    expect(mailScanDue(ago(MAIL_SCAN_MIN_GAP_MS), NOW)).toBe(true);
    expect(mailScanDue(ago(24 * 3600 * 1000), NOW)).toBe(true);
  });

  it('a damaged date or a clock that went backwards never blocks it for good', () => {
    expect(mailScanDue('not a date', NOW)).toBe(true);
    expect(mailScanDue('', NOW)).toBe(true);
    expect(mailScanDue(new Date(NOW + 3600 * 1000).toISOString(), NOW)).toBe(true);
  });

  it('the gap can be changed by the caller', () => expect(mailScanDue(ago(1000), NOW, 500)).toBe(true));
});
