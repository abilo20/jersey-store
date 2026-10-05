import { Router, Response } from 'express';
import { queryAll, queryOne, execute } from '../database/db.js';
import { authCustomer, authAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { getVapidPublicKey } from '../services/pushService.js';

const router = Router();

// Public / Authenticated: Get Public VAPID Key for Web Push subscription
router.get('/push/vapid-key', (_req, res: Response) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    res.status(503).json({ success: false, message: 'Web Push is not configured on this deployment' });
    return;
  }
  res.json({ success: true, publicKey });
});

// Authenticated Admin: notification history
router.get('/admin', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminId = req.admin!.id;
    const notifications = queryAll(`
      SELECT id, type, title, message, entity_type, entity_id, link, is_read, created_at
      FROM notifications
      WHERE admin_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `, [adminId]);
    const unreadCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM notifications WHERE admin_id = ? AND is_read = 0',
      [adminId]
    )?.count || 0;
    res.json({ success: true, notifications, unreadCount });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error retrieving admin notifications' });
  }
});

router.get('/admin/unread-count', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const count = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM notifications WHERE admin_id = ? AND is_read = 0',
    [req.admin!.id]
  )?.count || 0;
  res.json({ success: true, count });
});

router.patch('/admin/:id/read', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  execute('UPDATE notifications SET is_read = 1 WHERE id = ? AND admin_id = ?', [req.params.id, req.admin!.id]);
  res.json({ success: true });
});

router.patch('/admin/read-all', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  execute('UPDATE notifications SET is_read = 1 WHERE admin_id = ?', [req.admin!.id]);
  res.json({ success: true });
});

// Authenticated Admin: Subscribe to Web Push
router.post('/admin/push/subscribe', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminId = req.admin!.id;
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ success: false, message: 'Invalid push subscription payload' });
      return;
    }
    execute(`
      INSERT OR REPLACE INTO push_subscriptions (user_id, admin_id, endpoint, p256dh, auth, updated_at)
      VALUES (NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [adminId, endpoint, keys.p256dh, keys.auth]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, message: 'Unable to save push subscription' });
  }
});

router.delete('/admin/push/unsubscribe', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) execute('DELETE FROM push_subscriptions WHERE endpoint = ? AND admin_id = ?', [endpoint, req.admin!.id]);
  else execute('DELETE FROM push_subscriptions WHERE admin_id = ?', [req.admin!.id]);
  res.json({ success: true });
});

// Authenticated Customer: Get notifications list
router.get('/', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const notifications = queryAll(`
      SELECT id, type, title, message, entity_type, entity_id, link, is_read, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId]);

    const unreadCount = queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0
    `, [userId])?.count || 0;

    res.json({ success: true, notifications, unreadCount });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error retrieving notifications: ' + err.message });
  }
});

// Authenticated Customer: Get unread count
router.get('/unread-count', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const count = queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0
    `, [userId])?.count || 0;

    res.json({ success: true, count });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Authenticated Customer: Mark single notification as read
router.patch('/:id/read', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const notifId = req.params.id;

    execute(`
      UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?
    `, [notifId, userId]);

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Authenticated Customer: Mark all notifications as read
router.patch('/read-all', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    execute(`
      UPDATE notifications SET is_read = 1 WHERE user_id = ?
    `, [userId]);

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Authenticated Customer: Get notification preferences
router.get('/preferences', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    let pref = queryOne<any>(`
      SELECT * FROM notification_preferences WHERE user_id = ?
    `, [userId]);

    if (!pref) {
      execute(`
        INSERT INTO notification_preferences (user_id, order_updates, payment_updates, delivery_updates, review_updates, promotional_updates, restock_updates, push_enabled)
        VALUES (?, 1, 1, 1, 1, 0, 1, 0)
      `, [userId]);
      pref = {
        user_id: userId,
        order_updates: 1,
        payment_updates: 1,
        delivery_updates: 1,
        review_updates: 1,
        promotional_updates: 0,
        restock_updates: 1,
        push_enabled: 0
      };
    }

    res.json({ success: true, preferences: pref });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Authenticated Customer: Update notification preferences
router.put('/preferences', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      order_updates,
      payment_updates,
      delivery_updates,
      review_updates,
      promotional_updates,
      restock_updates,
      push_enabled
    } = req.body;

    execute(`
      INSERT OR REPLACE INTO notification_preferences (
        user_id, order_updates, payment_updates, delivery_updates, review_updates, promotional_updates, restock_updates, push_enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      userId,
      order_updates !== undefined ? (order_updates ? 1 : 0) : 1,
      payment_updates !== undefined ? (payment_updates ? 1 : 0) : 1,
      delivery_updates !== undefined ? (delivery_updates ? 1 : 0) : 1,
      review_updates !== undefined ? (review_updates ? 1 : 0) : 1,
      promotional_updates !== undefined ? (promotional_updates ? 1 : 0) : 0,
      restock_updates !== undefined ? (restock_updates ? 1 : 0) : 1,
      push_enabled !== undefined ? (push_enabled ? 1 : 0) : 0
    ]);

    res.json({ success: true, message: 'Notification preferences updated' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Authenticated Customer: Subscribe to Web Push
router.post('/push/subscribe', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      res.status(400).json({ success: false, message: 'Invalid push subscription payload' });
      return;
    }

    execute(`
      INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [userId, endpoint, keys.p256dh, keys.auth]);

    // Also enable push in preferences
    execute(`
      INSERT OR REPLACE INTO notification_preferences (user_id, push_enabled, updated_at)
      VALUES (?, 1, CURRENT_TIMESTAMP)
    `, [userId]);

    res.json({ success: true, message: 'Web push subscription saved' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Authenticated Customer: Unsubscribe from Web Push
router.delete('/push/unsubscribe', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { endpoint } = req.body;

    if (endpoint) {
      execute(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`, [endpoint, userId]);
    } else {
      execute(`DELETE FROM push_subscriptions WHERE user_id = ?`, [userId]);
    }

    execute(`
      UPDATE notification_preferences SET push_enabled = 0 WHERE user_id = ?
    `, [userId]);

    res.json({ success: true, message: 'Push subscription removed' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
