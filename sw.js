// FlashCard service worker: uygulamanın çevrimdışı açılmasını sağlar.
// Kart verileri Firebase'in kendi önbelleğinde tutulur; burada sadece uygulama dosyaları var.
const CACHE = 'flashcard-v2';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Uygulama sayfası: önce internetten en güncelini al, yoksa önbellekten aç
  if (req.mode === 'navigate' || (url.origin === location.origin && url.pathname.endsWith('.html'))) {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Firebase kütüphaneleri ve uygulama dosyaları: önbellekten hızlıca ver
  if (url.origin === location.origin || url.hostname === 'www.gstatic.com') {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
  // Diğer istekler (Firebase veritabanı, giriş) doğrudan internete gider
});

// ---------- Bildirimler (günlük hatırlatma) ----------
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (err) { payload = { data: { body: e.data ? e.data.text() : '' } }; }
  const d = payload.data || {};
  const n = payload.notification || {};
  const title = d.title || n.title || 'FlashCard';
  const body = d.body || n.body || 'Tekrar vakti geldi!';
  e.waitUntil(self.registration.showNotification(title, {
    body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'flashcard-daily',
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow(url);
    })
  );
});
