import webpush from 'web-push';
import { queryOne, queryAll, execute } from '../database/db.js';

let vapidConfigured = false;
let currentPublicKey = '';

export function initVapid(): string {
  if (vapidConfigured && currentPublicKey) return currentPublicKey;

  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();

  // Push credentials are deployment secrets. Never generate or persist the private key in the database.
  if (!publicKey || !privateKey || !subject) {
    currentPublicKey = '';
    return '';
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    currentPublicKey = publicKey;
    vapidConfigured = true;
  } catch (err) {
    console.error('[PUSH] VAPID configuration is invalid. Web Push is disabled.');
    currentPublicKey = '';
  }

  return currentPublicKey;
}

export function getVapidPublicKey(): string {
  return initVapid();
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  data?: any;
}

export async function sendWebPush(sub: { id: number; endpoint: string; p256dh: string; auth: string }, payload: PushPayload): Promise<boolean> {
  initVapid();
  if (!vapidConfigured) return false;

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth
    }
  };

  const stringifiedPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || '/uploads/products/product-placeholder.jpg',
    badge: payload.badge || '/uploads/products/product-placeholder.jpg',
    tag: payload.tag || 'general',
    data: {
      url: payload.url || '/',
      ...(payload.data || {})
    }
  });

  try {
    await webpush.sendNotification(pushSubscription, stringifiedPayload);
    return true;
  } catch (err: any) {
    // 404 or 410 means subscription has expired or unsubscribed
    if (err.statusCode === 404 || err.statusCode === 410) {
      execute('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
    }
    return false;
  }
}

export async function sendPushToUser(userId: number, payload: PushPayload): Promise<void> {
  // Check user preferences
  const pref = queryOne<{ push_enabled: number }>('SELECT push_enabled FROM notification_preferences WHERE user_id = ?', [userId]);
  // Default to enabled if user hasn't explicitly disabled
  if (pref && pref.push_enabled === 0) return;

  const subs = queryAll<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    [userId]
  );

  for (const s of subs) {
    await sendWebPush(s, payload);
  }
}

export async function sendPushToAdmins(payload: PushPayload): Promise<void> {
  const subs = queryAll<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE admin_id IS NOT NULL'
  );

  for (const s of subs) {
    await sendWebPush(s, payload);
  }
}
