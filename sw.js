/* からだログ Service Worker
 * アプリのファイルを端末にキャッシュして、通信がなくても開けるようにする。
 * ファイルを更新したら CACHE_VERSION の数字を上げること。上げないと古い画面が出続ける。
 */
const CACHE_VERSION = 'karadalog-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached =>
      cached ||
      fetch(event.request).catch(() =>
        event.request.mode === 'navigate' ? caches.match('./index.html') : undefined
      )
    )
  );
});
