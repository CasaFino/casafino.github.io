/* CasaFino — service worker — version 3.0 (2026-10-23)
   Garde l'app sur le téléphone pour qu'elle s'ouvre sans réseau. Les appels à l'API ne sont jamais mis en cache.
   La bibliothèque de lecture QR de secours est gardée en cache après son premier chargement. */
var CACHE = "casafino-3.0";
var FICHIERS = ["./", "index.html", "app.js", "vente.js", "manifest.webmanifest", "icon-192.png", "icon-512.png",
  "icon-maskable-192.png", "icon-maskable-512.png", "apple-touch-icon.png", "logo.png", "qr.js", "pdf-lib.min.js"];
var LIBS = ["https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(FICHIERS).then(function () {
      // Bibliothèque de lecture QR : utile hors ligne sur les téléphones sans lecteur intégré (échec sans gravité)
      return c.add(LIBS[0]).catch(function () {});
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  if (LIBS.indexOf(req.url) >= 0) {           // bibliothèques : cache d'abord
    e.respondWith(caches.match(req).then(function (r) {
      return r || fetch(req).then(function (rep) { var c = rep.clone(); caches.open(CACHE).then(function (k) { k.put(req, c); }); return rep; });
    }));
    return;
  }
  if (new URL(req.url).origin !== self.location.origin) return;
  // Fichiers de l'app : réseau d'abord (mises à jour), cache si hors ligne
  e.respondWith(fetch(req).then(function (rep) {
    var copie = rep.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copie); });
    return rep;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match("index.html"); });
  }));
});
