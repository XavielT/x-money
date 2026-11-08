// The sender filter of the mail capture: plain addresses or domains only. The app never invents a
// bank address; the list starts empty and the user fills it. Pure.
const SENDER = /^[a-z0-9@._+-]{3,80}$/;

export function cleanSenders(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.trim().toLowerCase();
    if (SENDER.test(s) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 20);
}

// "avisos@banco.example, banco2.example" typed in one field -> a clean list
// Opening the app again (a resume from the background) looks for new bank notices, but not more often than this:
// each scan reads the mailbox and every NEW notice is one capture against the daily limit.
export const MAIL_SCAN_MIN_GAP_MS = 3 * 60 * 1000;

// Is a scan due? `lastScanIso`: when the last one finished (never = due). A clock that went backwards is due too.
export function mailScanDue(lastScanIso: string | undefined, nowMs: number, gapMs = MAIL_SCAN_MIN_GAP_MS): boolean {
  const last = lastScanIso ? Date.parse(lastScanIso) : NaN;
  if (!Number.isFinite(last)) return true;
  const elapsed = nowMs - last;
  return elapsed < 0 || elapsed >= gapMs;
}

export const parseSenderText = (text: string): string[] => cleanSenders(text.split(/[\s,;]+/).filter(Boolean));
