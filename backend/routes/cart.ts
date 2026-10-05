import { Router, Request, Response } from 'express';
import { queryAll, queryOne, execute } from '../database/db.js';
import { optionalCustomer, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

// Helper to get or create cart
function getCartId(userId: number | null, sessionId: string): number {
  if (userId) {
    let cart = queryOne<{ id: number }>('SELECT id FROM carts WHERE user_id = ?', [userId]);
    if (!cart) {
      const res = execute('INSERT INTO carts (user_id, session_id) VALUES (?, ?)', [userId, sessionId || null]);
      return res.lastInsertRowid;
    }
    return cart.id;
  } else if (sessionId) {
    let cart = queryOne<{ id: number }>('SELECT id FROM carts WHERE session_id = ?', [sessionId]);
    if (!cart) {
      const res = execute('INSERT INTO carts (user_id, session_id) VALUES (?, ?)', [null, sessionId]);
      return res.lastInsertRowid;
    }
    return cart.id;
  } else {
    const defaultSession = 'sess-' + Math.random().toString(36).substring(2);
    const res = execute('INSERT INTO carts (user_id, session_id) VALUES (?, ?)', [null, defaultSession]);
    return res.lastInsertRowid;
  }
}

// Get cart items with real live product data and current stock
router.get('/', optionalCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionId = (req.headers['x-session-id'] as string) || (req.query.session_id as string) || '';
    const userId = req.user ? req.user.id : null;

    if (!userId && !sessionId) {
      res.json({ success: true, cart: { items: [], subtotal: 0, total_items: 0 } });
      return;
    }

    const cartId = getCartId(userId, sessionId);

    const items = queryAll<any>(`
      SELECT ci.*,
        p.name as product_name,
        p.slug as product_slug,
        p.price as base_price,
        p.is_customizable,
        p.customization_price,
        (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) as product_image,
        (SELECT COALESCE(stock_quantity, 0) FROM inventory inv WHERE inv.product_id = p.id AND inv.size = ci.size AND inv.variant_name = ci.variant_name LIMIT 1) as available_stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.cart_id = ?
      ORDER BY ci.created_at DESC
    `, [cartId]);

    let subtotal = 0;
    let totalItems = 0;

    const formattedItems = items.map(item => {
      const hasCustomization = Boolean((item.player_name && item.player_name.trim()) || (item.player_number && item.player_number.trim()));
      const customCost = hasCustomization && item.is_customizable ? (item.customization_price || 250) : 0;
      const effectiveUnitPrice = item.base_price + customCost;
      const itemTotal = effectiveUnitPrice * item.quantity;
      subtotal += itemTotal;
      totalItems += item.quantity;

      return {
        ...item,
        unit_price: effectiveUnitPrice,
        total_price: itemTotal,
        has_customization: hasCustomization,
        customization_cost: customCost
      };
    });

    res.json({
      success: true,
      cart: {
        id: cartId,
        items: formattedItems,
        subtotal,
        total_items: totalItems
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error fetching cart: ' + err.message });
  }
});

// Add item to cart
router.post('/add', optionalCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { product_id, size, variant_name = 'Standard', player_name = '', player_number = '', quantity = 1, session_id = '' } = req.body;
    const userId = req.user ? req.user.id : null;
    const effectiveSessionId = session_id || (req.headers['x-session-id'] as string) || '';

    if (!product_id || !size) {
      res.status(400).json({ success: false, message: 'Product ID and size are required' });
      return;
    }

    const product = queryOne<any>('SELECT * FROM products WHERE id = ?', [product_id]);
    if (!product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    // Check size validity and stock
    const inv = queryOne<{ stock_quantity: number }>(
      'SELECT stock_quantity FROM inventory WHERE product_id = ? AND size = ? LIMIT 1',
      [product_id, size]
    );

    const availableStock = inv ? inv.stock_quantity : 10;
    if (availableStock <= 0) {
      res.status(400).json({ success: false, message: `Selected size ${size} is currently out of stock` });
      return;
    }

    const cleanPlayerName = (player_name || '').trim().toUpperCase();
    const cleanPlayerNumber = (player_number || '').trim().toUpperCase();
    const hasCustomization = Boolean(product.is_customizable && (cleanPlayerName || cleanPlayerNumber));
    const customCost = hasCustomization ? (product.customization_price || 250) : 0;
    const unitPrice = product.price + customCost;

    const cartId = getCartId(userId, effectiveSessionId);

    // Check if identical item already exists in cart (matching product, size, variant, and customization)
    const existing = queryOne<{ id: number; quantity: number }>(`
      SELECT id, quantity FROM cart_items
      WHERE cart_id = ? AND product_id = ? AND size = ? AND variant_name = ?
        AND COALESCE(player_name, '') = ? AND COALESCE(player_number, '') = ?
    `, [cartId, product_id, size, variant_name, cleanPlayerName, cleanPlayerNumber]);

    if (existing) {
      const newQty = existing.quantity + Number(quantity);
      if (newQty > availableStock) {
        res.status(400).json({ success: false, message: `Cannot add more than available stock (${availableStock})` });
        return;
      }
      execute('UPDATE cart_items SET quantity = ?, unit_price = ? WHERE id = ?', [newQty, unitPrice, existing.id]);
    } else {
      if (Number(quantity) > availableStock) {
        res.status(400).json({ success: false, message: `Cannot add more than available stock (${availableStock})` });
        return;
      }
      execute(`
        INSERT INTO cart_items (cart_id, product_id, size, variant_name, player_name, player_number, quantity, unit_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [cartId, product_id, size, variant_name, cleanPlayerName || null, cleanPlayerNumber || null, Number(quantity), unitPrice]);
    }

    execute('UPDATE carts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cartId]);

    res.json({ success: true, message: 'Item added to cart' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error adding to cart: ' + err.message });
  }
});

// Update item quantity
router.put('/item/:id', optionalCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const itemId = Number(req.params.id);
    const { quantity } = req.body;
    const qty = Number(quantity);

    if (qty <= 0) {
      execute('DELETE FROM cart_items WHERE id = ?', [itemId]);
      res.json({ success: true, message: 'Item removed from cart' });
      return;
    }

    const item = queryOne<any>('SELECT ci.*, inv.stock_quantity FROM cart_items ci LEFT JOIN inventory inv ON inv.product_id = ci.product_id AND inv.size = ci.size WHERE ci.id = ?', [itemId]);
    if (!item) {
      res.status(404).json({ success: false, message: 'Cart item not found' });
      return;
    }

    if (item.stock_quantity !== null && qty > item.stock_quantity) {
      res.status(400).json({ success: false, message: `Only ${item.stock_quantity} available in stock` });
      return;
    }

    execute('UPDATE cart_items SET quantity = ? WHERE id = ?', [qty, itemId]);
    res.json({ success: true, message: 'Quantity updated' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error updating quantity: ' + err.message });
  }
});

// Remove item from cart
router.delete('/item/:id', (req: Request, res: Response) => {
  execute('DELETE FROM cart_items WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Item removed from cart' });
});

// Sync guest cart to user cart upon login
router.post('/sync', optionalCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.json({ success: false, message: 'Not authenticated' });
      return;
    }
    const { session_id } = req.body;
    if (!session_id) {
      res.json({ success: true });
      return;
    }

    const guestCart = queryOne<{ id: number }>('SELECT id FROM carts WHERE session_id = ?', [session_id]);
    if (guestCart) {
      const userCartId = getCartId(req.user.id, '');
      const guestItems = queryAll<any>('SELECT * FROM cart_items WHERE cart_id = ?', [guestCart.id]);

      for (const item of guestItems) {
        const existing = queryOne<{ id: number; quantity: number }>(`
          SELECT id, quantity FROM cart_items
          WHERE cart_id = ? AND product_id = ? AND size = ? AND variant_name = ?
            AND COALESCE(player_name, '') = COALESCE(?, '') AND COALESCE(player_number, '') = COALESCE(?, '')
        `, [userCartId, item.product_id, item.size, item.variant_name, item.player_name, item.player_number]);

        if (existing) {
          execute('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?', [item.quantity, existing.id]);
        } else {
          execute(`
            INSERT INTO cart_items (cart_id, product_id, size, variant_name, player_name, player_number, quantity, unit_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [userCartId, item.product_id, item.size, item.variant_name, item.player_name, item.player_number, item.quantity, item.unit_price]);
        }
      }
      execute('DELETE FROM carts WHERE id = ?', [guestCart.id]);
    }

    res.json({ success: true, message: 'Cart synced successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error syncing cart: ' + err.message });
  }
});

export default router;
