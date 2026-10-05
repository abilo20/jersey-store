import { Router, Response } from 'express';
import { queryAll, queryOne, execute } from '../database/db.js';
import { authCustomer, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

// Get customer favorite
router.get('/', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const items = queryAll(`
      SELECT w.id as wishlist_id, w.created_at as saved_at,
        p.id, p.name, p.slug, p.team, p.league, p.season, p.price, p.old_price, p.is_customizable,
        (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) as primary_image,
        (SELECT COALESCE(SUM(inv.stock_quantity), 0) FROM inventory inv WHERE inv.product_id = p.id) as total_stock,
        (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id AND r.status = 'Approved') as avg_rating
      FROM wishlists w
      JOIN products p ON w.product_id = p.id
      WHERE w.user_id = ?
      ORDER BY w.created_at DESC
    `, [req.user!.id]);

    res.json({ success: true, items });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error fetching favorite: ' + err.message });
  }
});

// Toggle favorite item
router.post('/toggle', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { product_id } = req.body;
    if (!product_id) {
      res.status(400).json({ success: false, message: 'Product ID required' });
      return;
    }

    const existing = queryOne('SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?', [req.user!.id, product_id]);

    let saved = false;
    if (existing) {
      execute('DELETE FROM wishlists WHERE id = ?', [(existing as any).id]);
      saved = false;
    } else {
      execute('INSERT INTO wishlists (user_id, product_id) VALUES (?, ?)', [req.user!.id, product_id]);
      saved = true;
    }

    const count = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM wishlists WHERE user_id = ?', [req.user!.id]);

    res.json({
      success: true,
      saved,
      favorite_count: count?.count || 0,
      message: saved ? 'Added to favorite' : 'Removed from favorite'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error toggling favorite: ' + err.message });
  }
});

// Remove item from favorite
router.delete('/:productId', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  execute('DELETE FROM wishlists WHERE user_id = ? AND product_id = ?', [req.user!.id, req.params.productId]);
  const count = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM wishlists WHERE user_id = ?', [req.user!.id]);
  res.json({ success: true, favorite_count: count?.count || 0, message: 'Item removed from favorite' });
});

export default router;
