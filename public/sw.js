/* CourtScribe offline support.
 * Precaches every built file listed in /precache-manifest.json so the app opens
 * without internet; saved recordings then play from IndexedDB. Pages are
 * network-first (a redeploy is picked up when online), built assets cache-first
 * (their names are content-hashed). Nothing is uploaded; only same-origin GETs are handled. */
const MANIFEST = '/precache-manifest.json';

async function readManifest() {
  const res = await fetch(MANIFEST, { cache: 'no-store' });
  if (!res.ok) throw new Error('precache manifest missing');
  return res.json();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const { version, files } = await readManifest();
      const cache = await caches.open(`courtscribe-${version}`);
      await cache.addAll(['/', '/index.html', '/favicon.svg', ...files]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const { version } = await readManifest().catch(() => ({ version: null }));
      if (version) for (const key of await caches.keys()) if (key.startsWith('courtscribe-') && key !== `courtscribe-${version}`) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts, the ws server etc.: browser default

  if (req.mode === 'navigate') {
    // Any route (/workspace, /performance-lab) is the single-page app.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.keys().then((keys) => keys.filter((k) => k.startsWith('courtscribe-')).forEach((k) => caches.open(k).then((c) => c.put('/index.html', copy.clone()))));
          }
          return res;
        })
        .catch(async () => (await caches.match('/index.html', { ignoreVary: true })) ?? Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg') {
    // ignoreVary: module scripts/styles are requested with an Origin header (crossorigin attribute), and servers send
    // `Vary: Origin`, so a strict match misses the precached copy. Hashed asset URLs always mean identical content.
    event.respondWith(caches.match(req.url, { ignoreVary: true }).then((hit) => hit ?? fetch(req)));
  }
});
