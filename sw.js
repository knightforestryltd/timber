const CACHE = 'kf-quotes-v14';
// Pages and files kept on the phone so the app still opens without signal (Drivers especially).
const FILES = ['/', '/index.html', '/drivers.html', '/dispatch.html', '/invoices.html', '/scale.html', '/yards.html', '/trucks.html', '/statistics.html', '/kf-config.js', '/kf-stock.js', '/kf-stats.js', '/theme.css', '/theme.js', '/nav.js', '/logo.jpg', '/html2pdf.bundle.min.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (always the newest version when there is signal); the saved copy when there is none.
self.addEventListener('fetch', e => {
  const req = e.request;
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  if (req.method !== 'GET' || !sameOrigin) return;      // Google scripts, maps, tiles: straight to the network
  if (/\.apk$/i.test(new URL(req.url).pathname)) return; // the app download is never stored on the phone
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('/')))
  );
});
