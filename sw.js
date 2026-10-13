// Service Worker: speichert alle Spieldateien für das Offline-Spielen auf dem Tablet.
const CACHE = 'stadtplaner-v2';
const FILES = [
  './', './index.html', './css/style.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './vendor/three.module.min.js',
  './src/main.js', './src/config.js', './src/util.js', './src/noise.js', './src/mapgen.js', './src/world.js', './src/sim.js',
  './src/traffic.js', './src/names.js', './src/camera.js', './src/input.js', './src/tools.js', './src/ui.js', './src/audio.js', './src/save.js',
  './src/render/materials.js', './src/render/builder.js', './src/render/buildingGeo.js', './src/render/roadGeo.js', './src/render/chunks.js',
  './src/render/terrainMesh.js', './src/render/scene.js', './src/render/vehicles.js', './src/render/effects.js', './src/render/overlay.js',
  './src/render/preview.js', './src/render/trees.js', './src/render/life.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Netzwerk zuerst (für Updates), bei Offline aus dem Cache
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
