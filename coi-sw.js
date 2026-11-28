// Service worker para hostings que no dejan poner encabezados (GitHub Pages): agrega
// Cross-Origin-Opener-Policy y Cross-Origin-Embedder-Policy a las respuestas de la pagina, asi el
// navegador da SharedArrayBuffer y anda la version con hilos (BV_WEB_THREADS). Lo registra
// shell.html solo si la pagina no esta aislada (crossOriginIsolated) por el servidor. Ver docs/DEPLOY.md.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Un pedido "only-if-cached" de otro origen tira error si se reenvia: se deja pasar.
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  event.respondWith((async () => {
    const res = await fetch(req);
    if (res.status === 0) return res;  // respuesta opaca: no se puede tocar
    const headers = new Headers(res.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  })());
});
