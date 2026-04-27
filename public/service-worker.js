const CACHE_NAME = "kelime-arenasi-v10-full-paket";

const STATIC_ASSETS = [
  "/correct.mp3",
  "/wrong.mp3",
  "/tick.mp3",
  "/manifest.json?v=10",
  "/icon-192.png?v=10",
  "/icon-512.png?v=10",
  "/logo.png?v=10"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of STATIC_ASSETS) {
        try { await cache.add(asset); }
        catch (err) { console.warn("Cache eklenemedi:", asset, err); }
      }
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    url.pathname === "/" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/service-worker.js") ||
    url.pathname.endsWith("/manifest.json") ||
    url.pathname.endsWith("/logo.png")
  ) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || event.request.method !== "GET") return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
