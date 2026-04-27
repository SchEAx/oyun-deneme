const CACHE_NAME = "kelime-arenasi-v6-logo-fix";
const urlsToCache = [
  "/",
  "/index.html",
  "/correct.mp3",
  "/wrong.mp3",
  "/tick.mp3",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];


self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
