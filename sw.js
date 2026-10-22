/* CasaFino — service worker — version 1.1 (2026-10-22)
   Garde l'app sur le téléphone pour qu'elle s'ouvre sans réseau. Les appels à l'API ne sont jamais mis en cache ici. */
var CACHE = "casafino-1.1";
var FICHIERS = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png", "apple-touch-icon.png", "logo.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FICHIERS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (rep) {
    var copie = rep.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copie); });
    return rep;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match("index.html"); });
  }));
});
