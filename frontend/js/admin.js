/**
 * Mira Sport - Shared Admin Navigation, Real-time Notifications & Utilities
 */

const ADMIN_TOKEN_KEY = 'mira_admin_token';
const ADMIN_USER_KEY = 'mira_admin_user';
const ADMIN_SOUND_MUTED_KEY = 'mira_admin_sound_muted';

export function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function getAdminUser() {
  const u = localStorage.getItem(ADMIN_USER_KEY);
  try {
    return u ? JSON.parse(u) : null;
  } catch (e) {
    return null;
  }
}

export function setAdminAuth(token, admin) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
  localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(admin));
}

export function adminLogout() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_USER_KEY);
  window.location.href = '/admin/login.html';
}

export function isAdminLoggedIn() {
  return Boolean(getAdminToken());
}

export async function adminApiRequest(endpoint, options = {}) {
  const token = getAdminToken();
  if (!token) {
    window.location.href = '/admin/login.html';
    throw new Error('Admin authentication required');
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`/api/admin${endpoint}`, {
    ...options,
    headers
  });

  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      adminLogout();
    }
    throw new Error(data.message || 'Admin request failed');
  }
  return data;
}

// -------------------------------------------------------------
// Web Audio API Synthesizer (Real-time sound alerts with 0ms latency)
// -------------------------------------------------------------
let sharedAudioCtx = null;

function getAudioContext() {
  if (!sharedAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

// Automatically unlock audio on first document interaction
function setupAudioUnlock() {
  const unlock = () => {
    getAudioContext();
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
}
setupAudioUnlock();

export function isSoundMuted() {
  return localStorage.getItem(ADMIN_SOUND_MUTED_KEY) === 'true';
}

export function toggleAdminSound() {
  const next = !isSoundMuted();
  localStorage.setItem(ADMIN_SOUND_MUTED_KEY, next ? 'true' : 'false');
  updateSoundButtonUI();
  if (!next) {
    playAdminSound('order');
    showAdminToast('Sound notifications enabled and tested!', 'success', 'Audio Enabled');
  } else {
    showAdminToast('Sound notifications muted.', 'info', 'Audio Muted');
  }
}

export function playAdminSound(type = 'order') {
  if (isSoundMuted()) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    if (type === 'order' || type === 'new-order') {
      // High-priority 3-note cash register / doorbell chime: C5 (523Hz) -> G5 (784Hz) -> C6 (1046Hz)
      const freqs = [523.25, 783.99, 1046.5];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.11);
        gain.gain.setValueAtTime(0, now + idx * 0.11);
        gain.gain.linearRampToValueAtTime(0.28, now + idx * 0.11 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.11);
        osc.stop(now + idx * 0.11 + 0.45);
      });
    } else if (type === 'payment') {
      // 2-tone melodic chime: A5 (880Hz) -> E6 (1318Hz)
      const freqs = [880, 1318.5];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);
        gain.gain.setValueAtTime(0.3, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.4);
      });
    } else if (type === 'success') {
      // Crisp upward ding
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, now); // E5
      osc.frequency.exponentialRampToValueAtTime(987.77, now + 0.15); // B5
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (type === 'error') {
      // Low dual warning buzzer
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } else {
      // Subtle pop
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(750, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (err) {
    console.warn('Audio play error:', err);
  }
}

// -------------------------------------------------------------
// Toast Notifications
// -------------------------------------------------------------
export function showAdminToast(message, type = 'info', title = '') {
  let container = document.getElementById('admin-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'admin-toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    order: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    payment: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/></svg>',
    success: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'
  };

  const titles = {
    order: 'New Order Placed',
    payment: 'Payment Notification',
    success: 'Success',
    error: 'Notice',
    info: 'System Update'
  };

  const toast = document.createElement('div');
  toast.className = `admin-toast ${type}`;
  toast.innerHTML = `
    <div class="admin-toast-icon">${icons[type] || icons.info}</div>
    <div class="admin-toast-content">
      <div class="admin-toast-title">${escapeAdminHtml(title || titles[type] || 'Notification')}</div>
      <div class="admin-toast-message">${escapeAdminHtml(message)}</div>
    </div>
    <button type="button" class="admin-toast-close" title="Dismiss">&times;</button>
  `;

  toast.querySelector('.admin-toast-close').addEventListener('click', () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 250);
  });

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 250);
    }
  }, 4500);
}

// -------------------------------------------------------------
// Real-time WebSocket Client for Admin
// -------------------------------------------------------------
let adminSocket = null;
let reconnectTimer = null;

export function initAdminRealtime() {
  if (adminSocket && (adminSocket.readyState === WebSocket.OPEN || adminSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    adminSocket = new WebSocket(wsUrl);

    adminSocket.onopen = () => {
      const dot = document.getElementById('admin-live-dot');
      if (dot) {
        dot.style.background = '#10B981';
        dot.title = 'Real-time live connected';
      }

      const token = getAdminToken();
      if (token && adminSocket.readyState === WebSocket.OPEN) {
        adminSocket.send(JSON.stringify({
          type: 'auth',
          token
        }));
      }
    };

    adminSocket.onmessage = (event) => {
      try {
        const notif = JSON.parse(event.data);
        if (notif.title && notif.message) {
          if (notif.type === 'order:new') {
            playAdminSound('order');
            showAdminToast(notif.message, 'order', notif.title);
            window.dispatchEvent(new CustomEvent('admin:new-order', { detail: notif }));
            updateAdminBadges();
          } else if (notif.type === 'payment:submitted') {
            playAdminSound('payment');
            showAdminToast(notif.message, 'payment', notif.title);
            window.dispatchEvent(new CustomEvent('admin:payment-submitted', { detail: notif }));
            updateAdminBadges();
          } else if (notif.type === 'review:new') {
            playAdminSound('success');
            showAdminToast(notif.message, 'success', notif.title);
          } else if (notif.type === 'settings:updated') {
            showAdminToast(notif.message, 'info', notif.title);
          } else {
            playAdminSound('info');
            showAdminToast(notif.message, 'info', notif.title);
          }
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    adminSocket.onclose = () => {
      const dot = document.getElementById('admin-live-dot');
      if (dot) {
        dot.style.background = '#EF4444';
        dot.title = 'Disconnected. Reconnecting...';
      }
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(initAdminRealtime, 3500);
    };

    adminSocket.onerror = () => {
      adminSocket.close();
    };
  } catch (err) {
    console.warn('Realtime admin socket error:', err);
  }
}

// -------------------------------------------------------------
// Live Badge Counts
// -------------------------------------------------------------
export async function updateAdminBadges() {
  try {
    const data = await adminApiRequest('/dashboard');
    if (data.metrics) {
      const ordersBadge = document.getElementById('badge-orders');
      if (ordersBadge) {
        const count = data.metrics.total_orders || 0;
        ordersBadge.textContent = count;
        ordersBadge.style.display = count > 0 ? 'inline-block' : 'none';
      }

      const paymentsBadge = document.getElementById('badge-payments');
      if (paymentsBadge) {
        const pCount = data.metrics.pending_payments || 0;
        paymentsBadge.textContent = pCount;
        paymentsBadge.style.display = pCount > 0 ? 'inline-block' : 'none';
        if (pCount > 0) paymentsBadge.classList.add('pulse');
        else paymentsBadge.classList.remove('pulse');
      }
    }
  } catch (err) {
    // Non-critical badge update failure
  }
}

function mutedIcon(state) { return state === 'muted' ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m23 9-6 6"/><path d="m17 9 6 6"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M19 9a5 5 0 0 1 0 6"/><path d="M22 6a9 9 0 0 1 0 12"/></svg>'; }

function updateSoundButtonUI() {
  const btn = document.getElementById('admin-sound-toggle');
  const text = document.getElementById('sound-toggle-text');
  if (!btn || !text) return;

  const muted = isSoundMuted();
  if (muted) {
    btn.className = 'sound-toggle-btn muted';
    btn.innerHTML = `<span aria-hidden="true">${mutedIcon('muted')}</span> <span id="sound-toggle-text">Sound Muted</span>`;
  } else {
    btn.className = 'sound-toggle-btn active';
    btn.innerHTML = `<span aria-hidden="true">${mutedIcon('on')}</span> <span id="sound-toggle-text">Sound ON</span>`;
  }
}

// -------------------------------------------------------------
// Persistent admin notification center
// -------------------------------------------------------------
function escapeAdminHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}

export async function fetchAdminNotifications() {
  const token = getAdminToken();
  if (!token) return { notifications: [], unreadCount: 0 };
  const res = await fetch('/api/notifications/admin', { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Unable to load notifications');
  return data;
}

async function enableAdminWebPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Browser notifications are not supported here.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const keyRes = await fetch('/api/notifications/push/vapid-key');
  const keyData = await keyRes.json();
  if (!keyRes.ok || !keyData.publicKey) throw new Error(keyData.message || 'Web Push is not configured.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  const current = await reg.pushManager.getSubscription();
  const subscription = current || await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(keyData.publicKey) });
  const res = await fetch('/api/notifications/admin/push/subscribe', { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${getAdminToken()}`}, body:JSON.stringify(subscription.toJSON()) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Unable to enable browser notifications.');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

async function refreshAdminNotificationCenter() {
  try {
    const data = await fetchAdminNotifications();
    const badge = document.getElementById('admin-notification-count');
    if (badge) { badge.textContent = data.unreadCount > 99 ? '99+' : String(data.unreadCount || 0); badge.style.display = data.unreadCount > 0 ? 'inline-flex' : 'none'; }
    const panel = document.getElementById('admin-notification-panel');
    if (panel) {
      panel.innerHTML = `<div class="admin-notification-head"><strong>Notifications</strong><button type="button" id="admin-read-all">Mark all read</button></div><button type="button" class="admin-push-enable" id="admin-enable-push">Enable browser notifications</button>${(data.notifications || []).slice(0,12).map(n => `<button class="admin-notification-row ${n.is_read ? '' : 'unread'}" data-id="${n.id}"><strong>${escapeAdminHtml(n.title)}</strong><span>${escapeAdminHtml(n.message)}</span><small>${escapeAdminHtml(n.created_at)}</small></button>`).join('') || '<div class="admin-notification-empty">No notifications yet.</div>'}`;
      panel.querySelectorAll('[data-id]').forEach(row => row.addEventListener('click', async () => {
        await fetch(`/api/notifications/admin/${row.dataset.id}/read`, { method:'PATCH', headers:{ Authorization:`Bearer ${getAdminToken()}` } });
        refreshAdminNotificationCenter();
      }));
      panel.querySelector('#admin-read-all')?.addEventListener('click', async () => {
        await fetch('/api/notifications/admin/read-all', { method:'PATCH', headers:{ Authorization:`Bearer ${getAdminToken()}` } });
        refreshAdminNotificationCenter();
      });
      panel.querySelector('#admin-enable-push')?.addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        try { await enableAdminWebPush(); showAdminToast('Browser notifications enabled.', 'success', 'Push Enabled'); }
        catch (err) { showAdminToast(err.message || 'Unable to enable browser notifications.', 'error', 'Push Setup'); }
        finally { event.currentTarget.disabled = false; }
      });
    }
  } catch {}
}

// -------------------------------------------------------------
// Admin Layout Renderer
// -------------------------------------------------------------
export function renderAdminLayout(activeNav = 'dashboard', pageTitle = 'Dashboard') {
  if (!isAdminLoggedIn()) {
    window.location.href = '/admin/login.html';
    return;
  }

  const admin = getAdminUser() || { full_name: 'Administrator', role: 'admin' };

  // Sidebar
  const sidebar = document.querySelector('.admin-sidebar');
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="admin-sidebar-header">
        <a href="/admin/index.html" class="admin-logo">
          <span class="admin-logo-mark">M</span><span>MIRA SPORT</span><span class="admin-logo-badge">ADMIN</span>
        </a>
      </div>

      <nav class="admin-nav">
        <a href="/admin/index.html" class="admin-nav-item ${activeNav === 'dashboard' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
          <span>Dashboard</span>
        </a>

        <a href="/admin/orders.html" class="admin-nav-item ${activeNav === 'orders' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          <span>Orders</span>
          <span class="admin-badge-count" id="badge-orders" style="display:none;">0</span>
        </a>

        <a href="/admin/payments.html" class="admin-nav-item ${activeNav === 'payments' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
          <span>Payment Verification</span>
          <span class="admin-badge-count" id="badge-payments" style="display:none;">0</span>
        </a>

        <a href="/admin/products.html" class="admin-nav-item ${activeNav === 'products' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
          <span>Products</span>
        </a>

        <a href="/admin/inventory.html" class="admin-nav-item ${activeNav === 'inventory' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>
          <span>Inventory Matrix</span>
        </a>

        <a href="/admin/categories.html" class="admin-nav-item ${activeNav === 'categories' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
          <span>Categories</span>
        </a>

        <a href="/admin/reviews.html" class="admin-nav-item ${activeNav === 'reviews' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span>Reviews Moderation</span>
        </a>

        <a href="/admin/customers.html" class="admin-nav-item ${activeNav === 'customers' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span>Customers</span>
        </a>

        <a href="/admin/banners.html" class="admin-nav-item ${activeNav === 'banners' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="12" x="3" y="6" rx="2"/><circle cx="9" cy="12" r="2"/></svg>
          <span>Banners</span>
        </a>

        <a href="/admin/shipping.html" class="admin-nav-item ${activeNav === 'shipping' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
          <span>Shipping Setup</span>
        </a>

        <a href="/admin/settings.html" class="admin-nav-item ${activeNav === 'settings' ? 'active' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>Store Settings</span>
        </a>
      </nav>

      <div class="admin-sidebar-footer">
        <div class="admin-user-info">
          <span class="admin-user-name">${admin.full_name}</span>
          <span class="admin-user-role">${admin.role}</span>
        </div>
        <button type="button" id="admin-logout-btn" title="Sign Out" style="color:#94A3B8; font-size:1.1rem; cursor:pointer; background:none; border:none;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 19V5a2 2 0 0 0-2-2h-6"/></svg>
        </button>
      </div>
    `;

    document.getElementById('admin-logout-btn')?.addEventListener('click', adminLogout);
  }

  // Header
  const header = document.querySelector('.admin-header');
  if (header) {
    header.innerHTML = `
      <div class="admin-header-left">
        <button type="button" class="mobile-menu-btn" id="mobile-admin-toggle" aria-label="Open admin menu"><span aria-hidden="true">≡</span></button>
        <h1 class="admin-page-title">${pageTitle}</h1>
        <div style="display:inline-flex; align-items:center; gap:6px; margin-left:14px; font-size:0.75rem; color:var(--text-muted);">
          <span id="admin-live-dot" style="width:8px; height:8px; border-radius:50%; background:#10B981; display:inline-block;" title="Live WebSockets connected"></span>
          <span>Live Updates</span>
        </div>
      </div>

      <div class="admin-header-actions" style="display:flex; align-items:center; gap:10px; position:relative;">
        <button type="button" class="admin-notification-btn" id="admin-notification-trigger" title="Notifications" aria-label="Notifications">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
          <span class="admin-notification-count" id="admin-notification-count" style="display:none;">0</span>
        </button>
        <div class="admin-notification-panel" id="admin-notification-panel" hidden></div>
        <button type="button" class="sound-toggle-btn active" id="admin-sound-toggle" title="Toggle notification sound">
          <span id="sound-toggle-icon" aria-hidden="true"></span> <span id="sound-toggle-text">Sound ON</span>
        </button>

        <a href="/index.html" class="btn btn-outline btn-sm" target="_blank">
          View Storefront ↗
        </a>
      </div>
    `;

    document.getElementById('mobile-admin-toggle')?.addEventListener('click', () => {
      document.querySelector('.admin-sidebar')?.classList.toggle('open');
    });

    document.getElementById('admin-sound-toggle')?.addEventListener('click', toggleAdminSound);
    const adminNotifTrigger = document.getElementById('admin-notification-trigger');
    const adminNotifPanel = document.getElementById('admin-notification-panel');
    adminNotifTrigger?.addEventListener('click', async () => { if (adminNotifPanel) { adminNotifPanel.hidden = !adminNotifPanel.hidden; if (!adminNotifPanel.hidden) await refreshAdminNotificationCenter(); } });
    updateSoundButtonUI();
    refreshAdminNotificationCenter();
  }

  // Initialize Real-time WebSocket & Badges
  initAdminRealtime();
  updateAdminBadges();
}
