import { execute, queryAll, queryOne } from '../database/db.js';
import { broadcastNotification, RealtimeNotification } from '../websocket.js';
import { sendPushToUser, sendPushToAdmins } from './pushService.js';

export interface CreateCustomerNotificationParams {
  userId: number;
  type: string;
  title: string;
  message: string;
  entityType?: 'order' | 'payment' | 'review' | 'product';
  entityId?: string;
  link?: string;
}

export interface CreateAdminNotificationParams {
  type: string;
  title: string;
  message: string;
  entityType?: 'order' | 'payment' | 'review' | 'product' | 'customer';
  entityId?: string;
  link?: string;
}

export async function notifyCustomer(params: CreateCustomerNotificationParams): Promise<number> {
  const result = execute(`
    INSERT INTO notifications (user_id, admin_id, type, title, message, entity_type, entity_id, link, is_read, created_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
  `, [
    params.userId,
    params.type,
    params.title,
    params.message,
    params.entityType || null,
    params.entityId || null,
    params.link || null
  ]);

  const notifId = result.lastInsertRowid;

  // Realtime WebSocket delivery
  broadcastNotification({
    type: 'notification:new',
    title: params.title,
    message: params.message,
    target: params.userId,
    data: {
      id: notifId,
      type: params.type,
      entity_type: params.entityType,
      entity_id: params.entityId,
      link: params.link
    }
  });

  // Browser Web Push notification
  sendPushToUser(params.userId, {
    title: params.title,
    body: params.message,
    url: params.link || '/orders.html',
    data: { notifId, entityType: params.entityType, entityId: params.entityId }
  }).catch(() => {});

  return notifId;
}

export async function notifyAdmins(params: CreateAdminNotificationParams): Promise<number> {
  const admins = queryAll<{ id: number }>('SELECT id FROM admins');
  let firstId = 0;

  for (const admin of admins) {
    const result = execute(`
      INSERT INTO notifications (user_id, admin_id, type, title, message, entity_type, entity_id, link, is_read, created_at)
      VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
    `, [
      admin.id,
      params.type,
      params.title,
      params.message,
      params.entityType || null,
      params.entityId || null,
      params.link || null
    ]);
    if (!firstId) firstId = result.lastInsertRowid;
  }

  broadcastNotification({
    type: 'admin:notification',
    title: params.title,
    message: params.message,
    target: 'admins',
    data: {
      id: firstId,
      type: params.type,
      entity_type: params.entityType,
      entity_id: params.entityId,
      link: params.link
    }
  });

  sendPushToAdmins({
    title: params.title,
    body: params.message,
    url: params.link || '/admin/orders.html',
    data: { notifId: firstId, entityType: params.entityType, entityId: params.entityId }
  }).catch(() => {});

  return firstId;
}

// Retention policy: automatically remove notifications older than 60 days
export function cleanupOldNotifications(): void {
  try {
    execute(`
      DELETE FROM notifications 
      WHERE created_at < datetime('now', '-60 days')
    `);
  } catch (err) {
    // Non-critical retention cleanup error
  }
}
