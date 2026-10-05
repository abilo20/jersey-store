/**
 * Mira Sport - Shared API, State, & Utilities
 */

const API_BASE = '/api';

// Local storage keys
const TOKEN_KEY = 'mira_customer_token';
const USER_KEY = 'mira_customer_user';
const SESSION_KEY = 'mira_guest_session_id';
const RECENTLY_VIEWED_KEY = 'mira_recently_viewed';

// Ensure guest session ID exists
export function getSessionId() {
  let sess = localStorage.getItem(SESSION_KEY);
  if (!sess) {
    sess = 'guest_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
    localStorage.setItem(SESSION_KEY, sess);
  }
  return sess;
}

// Authentication Helpers
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  const u = localStorage.getItem(USER_KEY);
  try {
    return u ? JSON.parse(u) : null;
  } catch (e) {
    return null;
  }
}

export function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  // Sync guest cart to customer cart
  syncCartOnLogin();
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = '/login.html';
}

export function isLoggedIn() {
  return Boolean(getToken());
}

// Universal API fetch helper
export async function apiRequest(endpoint, options = {}) {
  const headers = {
    'x-session-id': getSessionId(),
    ...(options.headers || {})
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // If not FormData, default to application/json
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Request failed');
    }
    return data;
  } catch (err) {
    console.error(`API Error [${endpoint}]:`, err);
    throw err;
  }
}

// Audio Notification Chime (Web Audio API Synthesizer - 0ms latency, zero external assets)
export function playNotificationSound(type = 'order') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;
    if (type === 'order' || type === 'success') {
      // Pleasant double-bell chime: F5 (698.46 Hz) -> C6 (1046.5 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(698.46, now);
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.38);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1046.5, now + 0.14);
      gain2.gain.setValueAtTime(0.35, now + 0.14);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.14);
      osc2.stop(now + 0.65);
    } else {
      // Crisp single bell chime
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    }
  } catch (e) {
    console.warn('Audio playback error:', e);
  }
}

// Real-time WebSocket connection for storefront
let storeSocket = null;
export function initStoreRealtime() {
  if (storeSocket && storeSocket.readyState === WebSocket.OPEN) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    storeSocket = new WebSocket(wsUrl);

    storeSocket.onopen = () => {
      const token = getToken();
      if (storeSocket && storeSocket.readyState === WebSocket.OPEN) {
        storeSocket.send(JSON.stringify({
          type: 'auth',
          token,
          sessionId: getSessionId()
        }));
      }
    };

    storeSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.title && data.message) {
          playNotificationSound('order');
          showToast(`${data.title}: ${data.message}`, 'success');
          updateNavBadges();

          // If on tracking page, dispatch event
          window.dispatchEvent(new CustomEvent('realtime:notification', { detail: data }));
        }
      } catch (err) {}
    };

    storeSocket.onclose = () => {
      setTimeout(initStoreRealtime, 4000);
    };
  } catch (err) {
    console.warn('Realtime connection error:', err);
  }
}

// Toast notification helper
export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const text = document.createElement('span');
  text.textContent = String(message);
  toast.appendChild(text);

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// Customer notification center + Web Push
export async function fetchNotifications() {
  if (!isLoggedIn()) return { notifications: [], unreadCount: 0 };
  return apiRequest('/notifications');
}

export async function markNotificationRead(id) {
  return apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export async function markAllNotificationsRead() {
  return apiRequest('/notifications/read-all', { method: 'PATCH' });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

export async function enableWebPush() {
  if (!isLoggedIn() || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Browser notifications are not supported here.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const vapid = await apiRequest('/notifications/push/vapid-key');
  if (!vapid.publicKey) throw new Error('Web Push is not configured by the store.');

  const registration = await navigator.serviceWorker.register('/sw.js');
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid.publicKey)
  });

  await apiRequest('/notifications/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription.toJSON())
  });
  return true;
}

export async function disableWebPush() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (subscription) {
    await apiRequest('/notifications/push/unsubscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });
    await subscription.unsubscribe();
  }
}

function renderNotificationPanel(notifications = [], unreadCount = 0) {
  const panel = document.getElementById('notification-panel');
  const badge = document.getElementById('notification-badge');
  if (badge) {
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.style.display = unreadCount > 0 ? 'flex' : 'none';
  }
  if (!panel) return;
  const rows = notifications.slice(0, 8).map(n => `
    <button type="button" class="notification-row ${n.is_read ? '' : 'unread'}" data-notification-id="${n.id}" data-link="${escapeHtml(n.link || '')}">
      <span class="notification-row-icon">${getIcon('bell', 17)}</span>
      <span class="notification-row-copy"><strong>${escapeHtml(n.title)}</strong><small>${escapeHtml(n.message)}</small></span>
    </button>
  `).join('');
  panel.innerHTML = `
    <div class="notification-panel-head"><strong>Notifications</strong><button type="button" id="notification-read-all">Mark all read</button></div>
    <div class="notification-list">${rows || '<div class="notification-empty">No notifications yet.</div>'}</div>
    <div class="notification-panel-actions"><button type="button" id="enable-push-btn">${getIcon('bell', 14)} Enable browser notifications</button><a class="notification-footer-link" href="/profile.html#notifications">Notification settings</a></div>
  `;
  panel.querySelectorAll('[data-notification-id]').forEach(row => row.addEventListener('click', async () => {
    const id = row.getAttribute('data-notification-id');
    const link = row.getAttribute('data-link');
    try { await markNotificationRead(id); } catch {}
    if (link) window.location.href = link;
    else row.classList.remove('unread');
    refreshNotificationCenter();
  }));
  panel.querySelector('#notification-read-all')?.addEventListener('click', async () => {
    try { await markAllNotificationsRead(); } catch {}
    refreshNotificationCenter();
  });
  panel.querySelector('#enable-push-btn')?.addEventListener('click', async () => {
    const button = panel.querySelector('#enable-push-btn');
    if (button) { button.disabled = true; button.textContent = 'Enabling…'; }
    try { await enableWebPush(); showToast('Browser notifications enabled.', 'success'); }
    catch (err) { showToast(err.message || 'Unable to enable browser notifications.', 'error'); }
    finally { refreshNotificationCenter(); }
  });
}

async function refreshNotificationCenter() {
  if (!isLoggedIn()) return;
  try {
    const data = await fetchNotifications();
    renderNotificationPanel(data.notifications || [], data.unreadCount || 0);
  } catch {}
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}

// Cart Helpers
export async function fetchCart() {
  return await apiRequest('/cart');
}

export async function updateNavBadges() {
  try {
    // Cart badge
    const cartRes = await apiRequest('/cart');
    const totalItems = cartRes.cart ? cartRes.cart.total_items : 0;
    document.querySelectorAll('.cart-badge-count').forEach(el => {
      el.textContent = totalItems;
      el.style.display = totalItems > 0 ? 'flex' : 'none';
    });

    // Favorites badge
    if (isLoggedIn()) {
      const wishRes = await apiRequest('/wishlist');
      const wishCount = wishRes.items ? wishRes.items.length : 0;
      document.querySelectorAll('.favorites-badge-count').forEach(el => {
        el.textContent = wishCount;
        el.style.display = wishCount > 0 ? 'flex' : 'none';
      });
    } else {
      document.querySelectorAll('.favorites-badge-count').forEach(el => {
        el.style.display = 'none';
      });
    }
  } catch (e) {
    // Fail silently on badges
  }
}

export async function syncCartOnLogin() {
  const sessId = localStorage.getItem(SESSION_KEY);
  if (sessId && isLoggedIn()) {
    try {
      await apiRequest('/cart/sync', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessId })
      });
      updateNavBadges();
    } catch (e) {}
  }
}

// Recently Viewed Products Tracker (LocalStorage)
export function trackRecentlyViewed(product) {
  if (!product || !product.id) return;
  try {
    let recent = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || '[]');
    recent = recent.filter(p => p.id !== product.id);
    recent.unshift({
      id: product.id,
      name: product.name,
      slug: product.slug,
      team: product.team,
      price: product.price,
      primary_image: product.primary_image || (product.images && product.images[0]?.image_url),
      avg_rating: product.avg_rating
    });
    // Keep max 8 items
    if (recent.length > 8) recent = recent.slice(0, 8);
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(recent));
  } catch (e) {}
}

export function getRecentlyViewed() {
  try {
    return JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

// Clean SVG Icon Generator (Zero Emoji, Professional Lucide SVGs)
export function getIcon(name, size = 20, className = '') {
  const s = size;
  const icons = {
    home: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    bag: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
    heart: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
    user: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>`,
    search: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    sliders: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/></svg>`,
    truck: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>`,
    shieldCheck: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`,
    star: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    arrowRight: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
    arrowLeft: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
    check: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    plus: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
    minus: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>`,
    trash: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
    clock: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    chevronDown: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
    package: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
    bell: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    mapPin: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
    phone: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92Z"/></svg>`,
    upload: `<svg class="${className}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`
  };

  return icons[name] || '';
}

// Render dynamic components: Header, Mobile Nav, Footer
export async function loadPublicStoreSettings() {
  try { const res = await apiRequest('/settings/public'); return res.settings || {}; } catch { return {}; }
}

export function renderStoreNavigation(activePage = 'home') {
  const user = getUser();
  const greetingName = user ? user.full_name.split(' ')[0] : 'Football Fan';

  // Desktop Header
  const headerEl = document.querySelector('header.header');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="container">
        <div class="header-inner">
          <a href="/index.html" class="brand" aria-label="Mira Sport home">
            <span class="brand-mark">M</span>
            <span>MIRA<span style="color:var(--accent);"> SPORT</span></span>
          </a>

          <form action="/shop.html" method="GET" class="search-bar">
            <span class="search-icon-left">${getIcon('search', 18)}</span>
            <input type="text" name="search" class="search-input" placeholder="Search team, league, season, or jersey..." autocomplete="off"/>
            <button type="submit" class="search-btn-right">${getIcon('arrowRight', 16)}</button>
          </form>

          <nav class="desktop-nav">
            <a href="/index.html" class="nav-link ${activePage === 'home' ? 'active' : ''}">Home</a>
            <a href="/shop.html" class="nav-link ${activePage === 'shop' ? 'active' : ''}">Shop Kits</a>
            <a href="/tracking.html" class="nav-link ${activePage === 'tracking' ? 'active' : ''}">Track Order</a>
          </nav>

          <div class="header-actions">
            <a href="/favorites.html" class="icon-btn" title="Favorites">
              ${getIcon('heart', 20)}
              <span class="badge-count favorites-badge-count" style="display:none;">0</span>
            </a>
            <button type="button" class="icon-btn notification-trigger" id="notification-trigger" title="Notifications" aria-label="Notifications">
              ${getIcon('bell', 20)}
              <span class="badge-count" id="notification-badge" style="display:none;">0</span>
            </button>
            <a href="/cart.html" class="icon-btn" title="Shopping Cart">
              ${getIcon('bag', 20)}
              <span class="badge-count cart-badge-count" style="display:none;">0</span>
            </a>
            <a href="${isLoggedIn() ? '/profile.html' : '/login.html'}" class="icon-btn" title="Account">
              ${getIcon('user', 20)}
            </a>
          </div>
        </div>
      </div>
      <div class="notification-panel" id="notification-panel" hidden></div>
    `;
    const trigger = document.getElementById('notification-trigger');
    const panel = document.getElementById('notification-panel');
    if (trigger && panel) {
      trigger.addEventListener('click', async () => {
        if (!isLoggedIn()) { window.location.href = '/login.html?redirect=/profile.html'; return; }
        panel.hidden = !panel.hidden;
        if (!panel.hidden) await refreshNotificationCenter();
      });
      document.addEventListener('click', (event) => {
        if (!panel.contains(event.target) && !trigger.contains(event.target)) panel.hidden = true;
      });
    }
  }

  // Mobile Top Bar
  const mobileTopEl = document.getElementById('mobile-top-bar');
  if (mobileTopEl) {
    mobileTopEl.innerHTML = `
      <div class="container">
        <div class="mobile-greeting">
          <div>
            <div class="greeting-text">Welcome back,</div>
            <div class="greeting-name">${greetingName}</div>
          </div>
          <div style="display:flex; gap:8px;">
            <a href="/tracking.html" class="icon-btn" title="Track Order">
              ${getIcon('truck', 18)}
            </a>
          </div>
        </div>
        <form action="/shop.html" method="GET" class="mobile-search-form">
          <span class="search-icon-left">${getIcon('search', 18)}</span>
          <input type="text" name="search" class="search-input" placeholder="Search Arsenal, Real Madrid, Messi..." />
          <a href="/shop.html" class="filter-btn-compact" title="All Filters">
            ${getIcon('sliders', 18)}
          </a>
        </form>
      </div>
    `;
  }

  // Mobile Bottom Navigation Bar
  const mobileNavEl = document.querySelector('nav.mobile-nav');
  if (mobileNavEl) {
    mobileNavEl.innerHTML = `
      <a href="/index.html" class="mobile-nav-item ${activePage === 'home' ? 'active' : ''}">
        ${getIcon('home', 22)}
        <span>Home</span>
      </a>
      <a href="/shop.html" class="mobile-nav-item ${activePage === 'shop' ? 'active' : ''}">
        ${getIcon('bag', 22)}
        <span>Shop</span>
      </a>
      <a href="/favorites.html" class="mobile-nav-item ${activePage === 'favorites' ? 'active' : ''}">
        ${getIcon('heart', 22)}
        <span>Favorites</span>
        <span class="badge-count favorites-badge-count" style="display:none;">0</span>
      </a>
      <a href="/cart.html" class="mobile-nav-item ${activePage === 'cart' ? 'active' : ''}">
        ${getIcon('bag', 22)}
        <span>Cart</span>
        <span class="badge-count cart-badge-count" style="display:none;">0</span>
      </a>
      <a href="${isLoggedIn() ? '/profile.html' : '/login.html'}" class="mobile-nav-item ${activePage === 'profile' ? 'active' : ''}">
        ${getIcon('user', 22)}
        <span>Profile</span>
      </a>
    `;
  }

  // Footer
  const footerEl = document.querySelector('footer.footer');
  if (footerEl) {
    footerEl.innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="footer-brand-title">
              <span class="footer-logo-mark">M</span> MIRA<span style="color:var(--accent);">SPORT</span>
            </div>
            <p class="footer-desc">
              Football jerseys, kits and custom printing. Store contact, delivery and payment details are managed centrally in Admin Settings.
            </p>
            <div style="font-size:0.85rem; color:var(--text-muted);">
              <span class="footer-contact-row">${getIcon('mapPin', 15)} <span data-store-address>Store address not configured</span></span><br>
              <span class="footer-contact-row">${getIcon('phone', 15)} <span data-store-phone>Phone not configured</span></span>
            </div>
          </div>

          <div>
            <div class="footer-heading">Categories</div>
            <ul class="footer-list">
              <li><a href="/shop.html?category=club-kits">Club Kits</a></li>
              <li><a href="/shop.html?category=national-teams">National Teams</a></li>
              <li><a href="/shop.html?category=retro-classics">Retro Classics</a></li>
              <li><a href="/shop.html?category=kids-kits">Kids Kits</a></li>
              <li><a href="/shop.html?category=training-warmup">Training & Drill</a></li>
            </ul>
          </div>

          <div>
            <div class="footer-heading">Customer Care</div>
            <ul class="footer-list">
              <li><a href="/tracking.html">Track Order</a></li>
              <li><a href="/cart.html">View Cart</a></li>
              <li><a href="/favorites.html">Favorites</a></li>
              <li><a href="/profile.html">My Account</a></li>
                          </ul>
          </div>

          <div>
            <div class="footer-heading">Accepted Payments</div>
            <p style="font-size:0.85rem; color:var(--text-muted); line-height:1.5; margin-bottom:12px;">
              Pay securely via bank transfer or mobile wallet with manual verification:
            </p>
            <div style="display:flex; flex-direction:column; gap:6px; font-size:0.82rem; font-weight:700;">
              <span>Commercial Bank of Ethiopia (CBE)</span>
              <span>Bank of Abyssinia</span>
              <span>Telebirr Mobile Money</span>
            </div>
          </div>
        </div>

        <div class="footer-bottom">
          <div>&copy; 2026 Mira Sport. All rights reserved. Built for true football supporters.</div>
          <div style="display:flex; gap:16px;">
            <span>Ethiopia</span>
            <span>Store information is managed in Admin Settings</span>
          </div>
        </div>
      </div>
    `;
  }

  loadPublicStoreSettings().then(settings => {
    const name = settings.store_name || 'Mira Sport';
    document.querySelectorAll('[data-store-address]').forEach(el => el.textContent = settings.store_address || 'Store address not configured');
    document.querySelectorAll('[data-store-phone]').forEach(el => el.textContent = settings.store_phone || 'Phone not configured');
    document.querySelectorAll('.brand').forEach(el => { el.setAttribute('aria-label', `${name} home`); });
  });

  updateNavBadges();
  if (isLoggedIn()) {
    initStoreRealtime();
    refreshNotificationCenter();
  }
}
