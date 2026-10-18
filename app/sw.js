/* からだログ Service Worker
 * アプリのファイルを端末にキャッシュして、通信がなくても開けるようにする。
 * ファイルを更新したら CACHE_VERSION の数字を上げること。上げないと古い画面が出続ける。
 */
const CACHE_VERSION = 'karadalog-cf-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './icon.svg',
  './icon-maskable.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
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
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // manifest だけは必ずネットワークから取る。
  // キャッシュを返すと、アプリの id を変えても Chrome が古い id を読み続け、
  // 「すでにインストールされています」が消えなくなる。
  if (url.pathname.endsWith('manifest.webmanifest')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached =>
      cached ||
      fetch(event.request).catch(() =>
        event.request.mode === 'navigate' ? caches.match('./index.html') : undefined
      )
    )
  );
});
