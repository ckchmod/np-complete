const CACHE_NAME = "the-lock-v1";
const urlsToCache = [
  "/",
  "/index.html",
  "/styles.css",
  "/src/main.js",
  "/src/levels.js",
  "/src/game.js",
  "/src/engine.js",
  "/src/render.js",
  "/src/replayUI.js",
  "/src/replay.js",
  "/src/generator.js",
  "/src/solver.js",
  "/src/difficultyMetrics.js",
  "/src/gadgetBuilders.js",
  "/src/rush.js",
  "/src/battle.js",
  "/src/battleEngine.js",
  "/src/aiBattle.js",
  "/src/battleSolver.js",
  "/src/battleReplay.js",
  "/src/battleGenerator.js",
  "/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))
    ))
  );
});
