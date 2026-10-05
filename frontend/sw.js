/**
 * Mira Sport - Web Push Service Worker
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {
    title: 'Mira Sport',
    body: 'You have a new update regarding your order.',
    icon: '/uploads/products/product-placeholder.jpg',
    badge: '/uploads/products/product-placeholder.jpg',
    tag: 'general',
    data: { url: '/orders.html' }
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/uploads/products/product-placeholder.jpg',
    badge: data.badge || '/uploads/products/product-placeholder.jpg',
    tag: data.tag || 'order-update',
    vibrate: [100, 50, 100],
    data: data.data || { url: '/orders.html' },
    actions: [
      { action: 'open', title: 'View Details' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
