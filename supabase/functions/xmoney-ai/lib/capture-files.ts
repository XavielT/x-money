// Checks of a document sent for smart capture, on the server. Pure (no Deno imports). The type is
// decided by the BYTES (magic numbers), never by what the client says; the client repeats the same
// rules before sending, this is the copy nobody can skip.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
export const MAX_TEXT_CHARS = 6000;

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const ascii = (b: Uint8Array, from: number, len: number): string => String.fromCharCode(...b.slice(from, from + len));

export function sniff(b: Uint8Array): ImageType | 'application/pdf' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const decodedSize = (b64: string): number => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

// null = acceptable; otherwise a short reason (never the content)
export function checkDocument(mediaType: unknown, data: unknown, kind: 'image' | 'pdf'): string | null {
  if (typeof data !== 'string' || !data.length) return 'data';
  if (!B64.test(data)) return 'base64';
  const size = decodedSize(data);
  if (size > (kind === 'pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) return 'too_large';
  let head: Uint8Array;
  try {
    head = Uint8Array.from(atob(data.slice(0, 32)), (c) => c.charCodeAt(0));
  } catch {
    return 'base64';
  }
  const real = sniff(head);
  if (!real) return 'type';
  if (kind === 'pdf' ? real !== 'application/pdf' : real === 'application/pdf') return 'type';
  if (mediaType !== real) return 'type'; // what the client declared must be what the bytes are
  if (kind === 'pdf') {
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    } catch {
      return 'base64';
    }
    const text = new TextDecoder('latin1').decode(bytes);
    if (!text.includes('%%EOF')) return 'malformed';
    const pages = text.match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
    if (pages < 1) return 'malformed';
    if (pages > MAX_PDF_PAGES) return 'pages';
  }
  return null;
}
