const CACHE_NAME = "kelime-arenasi-v8-logo-ses-fix";

const urlsToCache = [
  "/correct.mp3",
  "/wrong.mp3",
  "/tick.mp3",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/logo.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Ana ekran ve index her zaman güncel gelsin
  if (url.pathname === "/" || url.pathname.endsWith("/index.html")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  // Ses, ikon, logo gibi dosyalar cache'den hızlı gelsin
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
