"use strict";

const CACHE = "pendelpanda-v1.31.0";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./platform.js",
  "./dblink.js",
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

/* Netz zuerst, Cache nur als Offline-Rückfall.
   Vorher galt Cache-zuerst: Dabei konnten HTML, JS und CSS aus
   VERSCHIEDENEN Ständen gemischt werden — die App lief dann fehlerhaft
   (hängende Versionsnummer, kaputte Verbindungsauswahl, lange Ladezeiten),
   und Änderungen brauchten zwei Neuladungen. Die App ist klein, der
   Netzweg schnell — Aktualität ist hier mehr wert als der Millisekunden-
   Vorsprung des Caches. */
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return; // API immer live
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(c => c || caches.match("./index.html")))
  );
});
