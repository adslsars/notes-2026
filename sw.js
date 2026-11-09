/* 日本告別之旅 PWA — Service Worker v2
 * 改版時把 VERSION 改掉（app.js 的 APP_VERSION 也要同步），舊的 App 快取會在 activate 時刪除。
 * 照片快取 fj-photos 由頁面自己管理（解鎖後下載、解密），改版時不刪。
 */
'use strict';
const VERSION = '2026-11-09.4';
const CACHE = 'fj-' + VERSION;
const PHOTO_CACHE = 'fj-photos';
// 一定要有的檔案（抓不到就不安裝）
const CORE = ['./', './index.html', './app.js', './stamps.js', './stamps.css', './stamps-inputs.js', './stamps-inputs.css', './stamps-art.js', './stamps-art.css'];
// 盡量快取，抓不到也沒關係（例如 data.enc 還沒放、圖示還沒做）
const OPTIONAL = [
  './app.css', './manifest.webmanifest', './data.enc',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await Promise.all(OPTIONAL.map(async (u) => {
      try {
        const r = await fetch(new Request(u, { cache: 'reload' }));
        if (r.ok) await cache.put(u, r);
      } catch (e) { /* 沒有就算了 */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('fj-') && n !== CACHE && n !== PHOTO_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // 天氣 API、Google 地圖：直接走網路
  if (req.cache === 'no-cache' || req.cache === 'reload' || req.cache === 'no-store') return;  // 頁面要最新版
  if (/photos[^/]*\.enc$/.test(url.pathname)) return;               // 照片密文由頁面自己放進 fj-photos

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (e) {
      if (req.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      throw e;
    }
  })());
});
