// Browser-side preparation of a file before it can leave the device: the type is decided by its bytes,
// an image is redrawn smaller (which also drops EXIF and any other metadata), black boxes the user
// drew are burnt in, and a PDF is only accepted within its limits. The rules themselves are the pure
// functions of domain/capture/files.ts (tested without a browser).
import { CaptureOriginal, CapturePayload } from '../services/capture.service';
import { FileRejection, MAX_IMAGE_BYTES, Redaction, checkFile, clampRedaction, fitSize } from '../domain/capture/files';

export type Prepared = { ok: true; payload: CapturePayload; original: CaptureOriginal; fingerprint: string } | { ok: false; reason: FileRejection | 'decode' };

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(blob);
  });

const toBlob = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

function draw(bitmap: ImageBitmap, max: number, redactions: Redaction[]): HTMLCanvasElement {
  const size = fitSize(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  ctx.fillStyle = '#000';
  for (const raw of redactions) {
    const r = clampRedaction(raw);
    if (r) ctx.fillRect(r.x * size.width, r.y * size.height, r.w * size.width, r.h * size.height);
  }
  return canvas;
}

export async function prepareFile(file: Blob & { name?: string }, redactions: Redaction[] = []): Promise<Prepared> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const checked = checkFile(bytes);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const fingerprint = await sha256Hex(buffer);

  if (checked.type === 'pdf') {
    return { ok: true, fingerprint, payload: { mode: 'pdf', mediaType: 'application/pdf', data: await blobToBase64(new Blob([buffer], { type: 'application/pdf' })) }, original: { kind: 'pdf', name: file.name, bytes: bytes.length } };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer]), { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, reason: checked.type === 'heic' ? 'unsupported' : 'decode' }; // HEIC the browser cannot open: convert it first
  }
  try {
    let quality = 0.82;
    let blob = await toBlob(draw(bitmap, 1600, redactions), quality);
    while (blob && blob.size > MAX_IMAGE_BYTES && quality > 0.4) blob = await toBlob(draw(bitmap, 1600, redactions), (quality -= 0.15));
    if (!blob || blob.size > MAX_IMAGE_BYTES) return { ok: false, reason: 'too-large' };
    const thumb = (await toBlob(draw(bitmap, 480, redactions), 0.6)) ?? undefined;
    return {
      ok: true,
      fingerprint,
      payload: { mode: 'image', mediaType: 'image/jpeg', data: await blobToBase64(blob) },
      original: { kind: 'image', name: file.name, bytes: blob.size, thumb: thumb ? `data:image/jpeg;base64,${await blobToBase64(thumb)}` : undefined },
    };
  } finally {
    bitmap.close();
  }
}

// The same file with black boxes on it, for the preview before sending (a data URL: the CSP has no blob:)
export async function previewWithRedactions(file: Blob, redactions: Redaction[]): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const url = draw(bitmap, 900, redactions).toDataURL('image/jpeg', 0.7);
    bitmap.close();
    return url;
  } catch {
    return null;
  }
}
