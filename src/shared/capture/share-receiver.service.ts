import { Injectable } from '@angular/core';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

export interface SharedItem {
  kind: 'image' | 'pdf' | 'text';
  mimeType: string;
  name?: string;
  base64?: string; // image and pdf, without the data: prefix
  text?: string;
}

interface NativeItem {
  kind: SharedItem['kind'];
  mimeType: string;
  name?: string;
  path?: string;
  text?: string;
}

interface ShareReceiverPlugin {
  getPending(): Promise<{ items: NativeItem[] }>;
  addListener(event: 'shared', cb: () => void): Promise<PluginListenerHandle>;
}

const native = registerPlugin<ShareReceiverPlugin>('ShareReceiver');

// Same name as the one used by the PWA service worker (public/xmoney-sw.js)
export const SHARE_CACHE = 'xmoney-share';

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.readAsDataURL(blob);
  });

// What other apps shared into X Money. Android reads the cache copies made by the native plugin;
// the PWA reads what its service worker stored from the share target. The files are removed once read.
@Injectable({ providedIn: 'root' })
export class ShareReceiverService {
  async pending(): Promise<SharedItem[]> {
    try {
      return Capacitor.isNativePlatform() ? await this.fromNative() : await this.fromWeb();
    } catch {
      return [];
    }
  }

  // The callback runs when something is shared while the app is already open (native only)
  onShared(cb: () => void): () => void {
    if (!Capacitor.isNativePlatform()) return () => undefined;
    let handle: PluginListenerHandle | null = null;
    let removed = false;
    void native.addListener('shared', cb).then((h) => {
      if (removed) void h.remove();
      else handle = h;
    });
    return () => {
      removed = true;
      void handle?.remove();
    };
  }

  private async fromNative(): Promise<SharedItem[]> {
    const { items } = await native.getPending();
    const { Filesystem } = await import('@capacitor/filesystem');
    const out: SharedItem[] = [];
    for (const item of items) {
      if (item.kind === 'text') {
        if (item.text) out.push({ kind: 'text', mimeType: item.mimeType, text: item.text });
        continue;
      }
      if (!item.path) continue;
      try {
        const file = await Filesystem.readFile({ path: item.path });
        if (typeof file.data === 'string') out.push({ kind: item.kind, mimeType: item.mimeType, name: item.name, base64: file.data });
      } catch {
        // an unreadable file is skipped
      } finally {
        await Filesystem.deleteFile({ path: item.path }).catch(() => undefined);
      }
    }
    return out;
  }

  private async fromWeb(): Promise<SharedItem[]> {
    if (typeof caches === 'undefined') return [];
    if (!(await caches.has(SHARE_CACHE))) return [];
    const cache = await caches.open(SHARE_CACHE);
    const out: SharedItem[] = [];
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (!response) continue;
      const mimeType = response.headers.get('content-type') ?? '';
      const rawName = response.headers.get('x-share-name');
      const name = rawName ? decodeURIComponent(rawName) : undefined;
      if (mimeType.startsWith('text/plain')) {
        const text = (await response.text()).trim();
        if (text) out.push({ kind: 'text', mimeType: 'text/plain', text });
      } else if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
        out.push({ kind: mimeType === 'application/pdf' ? 'pdf' : 'image', mimeType, name, base64: await toBase64(await response.blob()) });
      }
    }
    await caches.delete(SHARE_CACHE);
    return out;
  }
}
