/* 旧 Service Worker の後始末。
 * アプリは /karada-log/app/ に移動した。
 * この SW は古いキャッシュを全部消し、自分の登録も解除して、開いている画面を読み込み直す。
 * fetch を受け取らないので、キャッシュを返すことはない。
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    windows.forEach(c => c.navigate(c.url));
  })());
});
