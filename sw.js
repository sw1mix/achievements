/* Service worker: приложение открывается офлайн и обновляется само.
   Версионировать кэш вручную не нужно — файлы отдаются из кэша и параллельно
   перезагружаются из сети (stale-while-revalidate). */
const SHELL_CACHE = 'achievements-shell-v1';
const FONT_CACHE = 'achievements-fonts-v1';
const KNOWN_CACHES = [SHELL_CACHE, FONT_CACHE];

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => !KNOWN_CACHES.includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => { /* переполнение хранилища */ });
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const response = await network;
  if (response) return response;
  throw new Error('Нет сети и нет копии в кэше');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const scope = new URL('./', self.registration.scope);

  // Переход по адресу приложения: сначала сеть, офлайн — сохранённая страница.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html', { cacheName: SHELL_CACHE })
        .then((cached) => cached || caches.match('./', { cacheName: SHELL_CACHE }))),
    );
    return;
  }

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});
