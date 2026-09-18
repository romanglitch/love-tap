/**
 * LoveTap Service Worker
 * Handles push events and displays notifications.
 */

// Install event — activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event — claim all clients
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Push event — show notification
self.addEventListener('push', (event) => {
  let data = {
    title: '💖 LoveTap',
    body: 'Кто-то отправил вам любовь!',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: 'heart-tap',
    renotify: true,
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (err) {
    console.error('Failed to parse push data:', err);
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: data.tag,
    renotify: data.renotify,
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'Открыть 💖' },
      { action: 'dismiss', title: 'Закрыть' },
    ],
    data: { url: '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification click — open app or dismiss
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(url);
    }),
  );
});
