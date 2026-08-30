const CACHE_NAME = 'ag-bridge-v2';
const ASSETS = [
    '/',
    '/index.html',
    '/share',
    '/manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        ))
    );
});

self.addEventListener('fetch', (e) => {
    // Network first, fall back to cache for HTML/static assets
    if (e.request.method !== 'GET') return;

    e.respondWith(
        fetch(e.request)
            .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
});
