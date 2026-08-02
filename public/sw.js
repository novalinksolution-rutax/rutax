/**
 * Service worker mínimo y conservador (T-4).
 *
 * Objetivo: habilitar instalabilidad PWA y tolerancia a desconexión SIN alterar
 * el comportamiento en línea ni cachear contenido autenticado.
 *
 * Estrategia: network-first SOLO para navegaciones. Estando en línea, siempre
 * sirve la red (cero contenido obsoleto). Sin conexión, cae a una página de
 * cortesía cacheada. El resto de peticiones (datos, RSC, assets) pasan directo.
 */

const CACHE = "rutax-shell-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Solo intervenimos navegaciones; todo lo demás va directo a la red.
  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() => caches.match(OFFLINE_URL)),
  );
});
