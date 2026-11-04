// What may leave the device for a capture, and in what shape. Pure: no DOM here, so the same rules
// are tested without a browser. Types are decided by the BYTES (magic numbers), never by the file
// name or the declared type. The server repeats these checks.
export const MAX_IMAGE_SIDE = 1600;
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // after recompression
export const MAX_FILES_AT_ONCE = 10;
export const MAX_TEXT_CHARS = 6000; // what a text capture may send

export type DetectedType = 'jpeg' | 'png' | 'webp' | 'heic' | 'pdf' | null;

const ascii = (b: Uint8Array, from: number, len: number): string => String.fromCharCode(...b.slice(from, from + len));

export function sniffType(b: Uint8Array): DetectedType {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(ascii(b, 8, 4))) return 'heic';
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') return 'pdf';
  return null;
}

// Pages of a PDF: objects of type /Page (not /Pages). A rough count is enough for a limit; a file it
// cannot make sense of is refused as malformed.
export function pdfPageCount(b: Uint8Array): number | null {
  const text = new TextDecoder('latin1').decode(b);
  if (!/%%EOF\s*$/.test(text.slice(-1024)) && !text.includes('%%EOF')) return null; // truncated or not a PDF
  const pages = text.match(/\/Type\s*\/Page(?![s\w])/g);
  return pages ? pages.length : null;
}

export type FileRejection = 'empty' | 'unsupported' | 'too-large' | 'too-many-pages' | 'malformed';

export function checkFile(bytes: Uint8Array): { ok: true; type: Exclude<DetectedType, null> } | { ok: false; reason: FileRejection } {
  if (!bytes.length) return { ok: false, reason: 'empty' };
  const type = sniffType(bytes);
  if (!type) return { ok: false, reason: 'unsupported' };
  if (type === 'pdf') {
    if (bytes.length > MAX_PDF_BYTES) return { ok: false, reason: 'too-large' };
    const pages = pdfPageCount(bytes);
    if (pages === null || pages < 1) return { ok: false, reason: 'malformed' };
    if (pages > MAX_PDF_PAGES) return { ok: false, reason: 'too-many-pages' };
    return { ok: true, type };
  }
  if (bytes.length > MAX_IMAGE_BYTES * 4) return { ok: false, reason: 'too-large' }; // before recompression
  return { ok: true, type };
}

// Size of an image fitted to the maximum side, keeping the proportion (never enlarged)
export function fitSize(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// A black box over part of the image, in fractions of its size (0 to 1)
export interface Redaction {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clampRedaction = (r: Redaction): Redaction | null => {
  const x = Math.min(1, Math.max(0, r.x));
  const y = Math.min(1, Math.max(0, r.y));
  const w = Math.min(1 - x, Math.max(0, r.w));
  const h = Math.min(1 - y, Math.max(0, r.h));
  return w > 0.005 && h > 0.005 ? { x, y, w, h } : null;
};

// ----- text (email, pasted, voice): drop what is not needed before it is sent

const FOOTER_START = /^\s*(?:--\s*$|_{3,}|-{3,}\s*$|saludos|atentamente|cordialmente|gracias,?\s*$|regards|best regards|sent from|enviado desde|aviso legal|este (?:mensaje|correo)|esta comunicaci|confidencial|disclaimer|unsubscribe|darse de baja|para cancelar|si no desea recibir|no responda este)/i;

export function stripHtml(html: string): string {
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

const REFERENCE_WORD = /(?:ref(?:erencia)?|aprobaci[oó]n|autorizaci[oó]n|aut|comprobante|transacci[oó]n|no\.?|n[uú]mero|num)\W{0,6}$/i;

// Long runs of digits are account or card numbers: keep the last 4 only, unless the number is the
// reference of the transaction (it is needed for duplicate control).
export function minimizeText(input: string, max = MAX_TEXT_CHARS): string {
  const lines: string[] = [];
  for (const line of input.replace(/\r/g, '').split('\n')) {
    if (FOOTER_START.test(line)) break; // everything after the first signature or legal footer
    lines.push(line);
  }
  let text = lines.join('\n');
  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').replace(/https?:\/\/\S+/g, '[link]');
  text = text.replace(/\b\d[\d -]{8,}\d\b/g, (m, offset: number) => {
    const before = text.slice(Math.max(0, offset - 24), offset);
    const digits = m.replace(/\D/g, '');
    if (digits.length < 9) return m;
    if (REFERENCE_WORD.test(before)) return m;
    return `****${digits.slice(-4)}`;
  });
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
