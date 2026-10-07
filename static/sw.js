// Service worker: menerima Web Push (tanpa payload) lalu mengambil isi notifikasi
// dari server berdasarkan endpoint langganan perangkat ini.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let judul = 'Monitoring Kendaraan';
    let isi = 'Buka aplikasi untuk melihat tugas hari ini.';
    let url = '/#/dashboard';
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const res = await fetch('/api/push/ringkasan?endpoint=' + encodeURIComponent(sub.endpoint), { cache: 'no-store' });
        const data = await res.json();
        if (data && data.judul) ({ judul, isi, url } = data);
      }
    } catch (e) {
      // tetap tampilkan notifikasi umum
    }
    await self.registration.showNotification(judul, {
      body: isi,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'tugas-harian',
      renotify: true,
      requireInteraction: true,
      data: { url },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/#/dashboard';
  event.waitUntil((async () => {
    const semua = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of semua) {
      if ('focus' in c) {
        await c.focus();
        if ('navigate' in c) await c.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
