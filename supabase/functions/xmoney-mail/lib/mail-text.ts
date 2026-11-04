// What is taken from an email, and what is refused. Pure. The body is reduced to plain text without
// signatures and legal footers; the sender must match the filter the user configured (a forged
// "From" that does not match produces no draft at all).
export interface MailFilter {
  senders: string[]; // addresses or domains, e.g. "avisos@banco.example" or "banco.example"
  subjectWords: string[];
}

export const MAX_FILTER_ITEMS = 20;

const SAFE = /^[a-z0-9@._+\-]{3,80}$/i;

// A filter from the client: only plain addresses/domains and short subject words survive
export function cleanFilter(raw: unknown): MailFilter {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list = (v: unknown, test: (s: string) => boolean): string[] =>
    (Array.isArray(v) ? v : [])
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().toLowerCase())
      .filter(test)
      .slice(0, MAX_FILTER_ITEMS);
  return { senders: list(r['senders'], (s) => SAFE.test(s)), subjectWords: list(r['subjectWords'], (s) => /^[\p{L}\p{N} ._-]{2,40}$/u.test(s)) };
}

// Gmail search query. With no sender in the filter there is NO query: nothing is read (the filter
// starts empty on purpose and the app never reads the rest of the mailbox).
export function buildQuery(filter: MailFilter, afterSeconds: number): string | null {
  if (!filter.senders.length) return null;
  const from = filter.senders.map((s) => `from:${s}`).join(' OR ');
  const subject = filter.subjectWords.length ? ` (${filter.subjectWords.map((w) => `subject:"${w.replace(/"/g, '')}"`).join(' OR ')})` : '';
  return `(${from})${subject} after:${Math.max(0, Math.floor(afterSeconds))}`;
}

// "Banco X <avisos@banco.example>" -> avisos@banco.example
export function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

// The address must be one of the filter entries, or end with "@domain" / ".domain" of an entry
export function senderMatches(from: string, filter: MailFilter): boolean {
  const addr = addressOf(from);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return false;
  return filter.senders.some((s) => addr === s || (!s.includes('@') && (addr.endsWith(`@${s}`) || addr.endsWith(`.${s}`))));
}

const FOOTER = /^\s*(?:--\s*$|_{3,}|-{3,}\s*$|saludos|atentamente|cordialmente|regards|best regards|sent from|enviado desde|aviso legal|este (?:mensaje|correo)|esta comunicaci|confidencial|disclaimer|unsubscribe|darse de baja|para cancelar|si no desea recibir|no responda este)/i;

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function reduceBody(text: string, max = 4000): string {
  const kept: string[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (FOOTER.test(line)) break;
    kept.push(line);
  }
  return kept.join('\n').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').replace(/https?:\/\/\S+/g, '[link]').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
