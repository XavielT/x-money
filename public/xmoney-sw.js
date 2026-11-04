// X Money service worker: Angular's ngsw plus the receiving end of the Web Share Target (Chrome on Android).
// The share handler is registered BEFORE importing ngsw so it answers the share POST first.
const SHARE_CACHE = 'xmoney-share';
const MAX_FILES = 10;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 20000;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || !url.pathname.endsWith('/share-target')) return;
  event.stopImmediatePropagation();
  event.respondWith(receive(event.request));
});

async function receive(request) {
  const target = new URL('./capture?shared=1', self.registration.scope).href;
  try {
    const form = await request.formData();
    await caches.delete(SHARE_CACHE);
    const cache = await caches.open(SHARE_CACHE);
    let count = 0;
    for (const value of form.getAll('files')) {
      if (count >= MAX_FILES) break;
      if (typeof value === 'string' || value.size === 0 || value.size > MAX_BYTES) continue;
      const type = value.type;
      if (!type.startsWith('image/') && type !== 'application/pdf') continue;
      await cache.put(
        new Request(`/__share/${count++}`),
        new Response(value, { headers: { 'content-type': type, 'x-share-name': encodeURIComponent(value.name || '').slice(0, 120) } })
      );
    }
    const text = ['title', 'text', 'url']
      .map((k) => form.get(k))
      .filter((v) => typeof v === 'string' && v.trim())
      .join('\n')
      .slice(0, MAX_TEXT);
    if (text && count < MAX_FILES) {
      await cache.put(new Request(`/__share/${count++}`), new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } }));
    }
  } catch (error) {
    // nothing was stored: the app opens with an empty share
  }
  return Response.redirect(target, 303);
}

importScripts('./ngsw-worker.js');
