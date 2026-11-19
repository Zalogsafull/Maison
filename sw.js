/* Service worker: guarda la app para abrirla rápido y sin conexión.
   Los datos NO se cachean acá (viven en Google Drive). Subí VERSION al cambiar archivos. */
const VERSION = 'maison-v4';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest',
  'img/logo.webp', 'img/icon-192.png', 'img/icon-512.png', 'img/apple-touch-icon.png', 'img/favicon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u.host)) { // fuentes: copia guardada, la primera vez se bajan
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(VERSION).then(k => k.put(e.request, c)); return res; })));
    return;
  }
  if (u.origin !== location.origin) return; // Google APIs: directo a la red
  // red primero (para tomar cambios), caché si no hay conexión
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(ca => ca.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
