"use strict";

const CACHE = "pendelpanda-v1.1.0";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./timeline.js",
  "./manifest.webmanifest",
  "./icons/app-192.png?v=2",
  "./icons/app-512.png?v=2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // API-Anfragen immer live, nur die App-Hülle aus dem Cache
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
