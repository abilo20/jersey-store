import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { queryAll, queryOne, execute } from '../database/db.js';
import { generateToken } from '../utils/jwt.js';
import { authAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { uploadProductImage, uploadBannerImage } from '../middleware/upload.js';
import { broadcastNotification } from '../websocket.js';
import { notifyCustomer, notifyAdmins } from '../services/notificationService.js';

const router = Router();

// Admin Login
router.post('/login', (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required' });
      return;
    }

    const admin = queryOne<any>('SELECT * FROM admins WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (!admin) {
      res.status(401).json({ success: false, message: 'Invalid admin credentials' });
      return;
    }

    const isMatch = bcrypt.compareSync(password, admin.password_hash);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Invalid admin credentials' });
      return;
    }

    const token = generateToken({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      type: 'admin'
    });

    res.json({
      success: true,
      message: 'Admin signed in successfully',
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        full_name: admin.full_name,
        role: admin.role
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Admin login error: ' + err.message });
  }
});

// Admin Me
router.get('/me', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, admin: req.admin });
});

// Dashboard Statistics (Strictly calculated from real DB data)
router.get('/dashboard', authAdmin, (_req: AuthenticatedRequest, res: Response) => {
  try {
    const totalOrders = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM orders')?.count || 0;
    const pendingVerification = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM orders WHERE payment_status = 'Pending Verification'")?.count || 0;
    const processingOrders = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM orders WHERE order_status = 'Processing'")?.count || 0;
    const shippedOrders = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM orders WHERE order_status = 'Shipped'")?.count || 0;
    const totalProducts = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM products')?.count || 0;
    const lowStockCount = queryOne<{ count: number }>(`
      SELECT COUNT(DISTINCT product_id) as count
      FROM inventory
      GROUP BY product_id
      HAVING SUM(stock_quantity) <= 5
    `)?.count || 0;
    const totalCustomers = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users')?.count || 0;
    const revenueRes = queryOne<{ total: number }>("SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE payment_status = 'Verified'");
    const totalRevenue = revenueRes?.total || 0;

    const recentOrders = queryAll(`
      SELECT o.id, o.order_number, o.customer_name, o.total, o.payment_method, o.payment_status, o.order_status, o.created_at
      FROM orders o
      ORDER BY o.created_at DESC
      LIMIT 8
    `);

    const pendingProofs = queryAll(`
      SELECT pp.*, o.order_number, o.customer_name, o.total as order_total
      FROM payment_proofs pp
      JOIN orders o ON pp.order_id = o.id
      WHERE pp.status = 'Pending Verification'
      ORDER BY pp.submitted_at DESC
      LIMIT 5
    `);

    res.json({
      success: true,
      stats: {
        totalOrders,
        pendingVerification,
        processingOrders,
        shippedOrders,
        totalProducts,
        lowStockCount,
        totalCustomers,
        totalRevenue
      },
      recentOrders,
      pendingProofs
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error retrieving dashboard stats: ' + err.message });
  }
});

// Products CRUD
router.get('/products', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { search, category_id } = req.query;
  const conditions = ['1=1'];
  const params: any[] = [];

  if (search) {
    conditions.push('(p.name LIKE ? OR p.team LIKE ? OR p.league LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (category_id) {
    conditions.push('p.category_id = ?');
    params.push(category_id);
  }

  const products = queryAll(`
    SELECT p.*,
      c.name as category_name,
      (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) as primary_image,
      (SELECT COALESCE(SUM(inv.stock_quantity), 0) FROM inventory inv WHERE inv.product_id = p.id) as total_stock
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.id DESC
  `, params);

  res.json({ success: true, products });
});

// Add product
router.post('/products', authAdmin, uploadProductImage.array('images', 5), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      name, team, league, season, category_id,
      description, features, material, price, old_price, search_tags,
      is_customizable, customization_price, is_featured, is_new,
      sizes_json, variants_json, stock_json
    } = req.body;

    if (!name || !team || !league || !season || !price) {
      res.status(400).json({ success: false, message: 'Name, team, league, season, and price are required' });
      return;
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36);

    const isCustomVal = (is_customizable === '1' || is_customizable === 1 || is_customizable === true || is_customizable === 'true') ? 1 : 0;
    const isFeaturedVal = (is_featured === '1' || is_featured === 1 || is_featured === true || is_featured === 'true') ? 1 : 0;
    const isNewVal = (is_new === '1' || is_new === 1 || is_new === true || is_new === 'true') ? 1 : 0;
    const catId = category_id && !isNaN(Number(category_id)) ? Number(category_id) : null;
    const numPrice = Number(price);
    const numOldPrice = old_price && !isNaN(Number(old_price)) ? Number(old_price) : null;

    const result = execute(`
      INSERT INTO products (
        name, slug, team, league, season, category_id,
        description, features, material, price, old_price, search_tags,
        is_customizable, customization_price, is_featured, is_new
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      name.trim(), slug, team.trim(), league.trim(), season.trim(), catId,
      description || '', features || '', material || '100% Recycled Polyester',
      numPrice, numOldPrice, search_tags || '',
      isCustomVal, Number(customization_price || 250),
      isFeaturedVal, isNewVal
    ]);

    const productId = result.lastInsertRowid;

    // Product photos must be uploaded by the administrator.
    // New products require at least 2 real photos; the first upload is primary.
    const files = req.files as Express.Multer.File[];
    if (!files || files.length < 2) {
      res.status(400).json({ success: false, message: 'Please upload at least 2 product photos.' });
      return;
    }
    if (files.length > 5) {
      res.status(400).json({ success: false, message: 'You can upload a maximum of 5 product photos.' });
      return;
    }
    if (files && files.length > 0) {
      let isPrimary = 1;
      let order = 0;
      for (const file of files) {
        execute(
          'INSERT INTO product_images (product_id, image_url, is_primary, display_order) VALUES (?, ?, ?, ?)',
          [productId, `/uploads/products/${file.filename}`, isPrimary, order++]
        );
        isPrimary = 0;
      }
    }

    // Sizes & Inventory
    let sizes = ['S', 'M', 'L', 'XL', 'XXL'];
    if (sizes_json) {
      try { sizes = typeof sizes_json === 'string' ? JSON.parse(sizes_json) : sizes_json; } catch (e) {}
    }

    let initialStock: Record<string, number> = {};
    if (stock_json) {
      try { initialStock = typeof stock_json === 'string' ? JSON.parse(stock_json) : stock_json; } catch (e) {}
    }

    for (const size of sizes) {
      const stock = initialStock[size] !== undefined ? Number(initialStock[size]) : 10;
      execute('INSERT INTO product_sizes (product_id, size, is_available) VALUES (?, ?, 1)', [productId, size]);
      execute('INSERT INTO inventory (product_id, size, variant_name, stock_quantity) VALUES (?, ?, ?, ?)',
        [productId, size, 'Home', stock]);
    }

    // Variants
    let variants = [{ name: 'Home', type: 'Kit Type' }, { name: 'Fan Version', type: 'Edition' }];
    if (variants_json) {
      try { variants = typeof variants_json === 'string' ? JSON.parse(variants_json) : variants_json; } catch (e) {}
    }

    for (const v of variants) {
      execute('INSERT INTO product_variants (product_id, name, type) VALUES (?, ?, ?)', [productId, v.name, v.type]);
    }

    await notifyAdmins({
      type: 'product:new', title: 'New Product Published',
      message: `"${name.trim()}" (${team.trim()}) is now available in the store.`,
      entityType: 'product', entityId: String(productId), link: `/admin/products.html`
    });
    broadcastNotification({
      type: 'product:new', title: 'New Jersey Published!',
      message: `"${name.trim()}" (${team.trim()}) is now available in the store.`,
      target: 'all', data: { product_id: productId, name }
    });

    res.status(201).json({ success: true, message: 'Product added successfully', product_id: productId });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error adding product: ' + err.message });
  }
});

// Update product
router.put('/products/:id', authAdmin, uploadProductImage.array('images', 5), (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const {
      name, team, league, season, category_id,
      description, features, material, price, old_price, search_tags,
      is_customizable, customization_price, is_featured, is_new,
      stock_json
    } = req.body;

    const existing = queryOne<any>('SELECT * FROM products WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    const finalName = name !== undefined && name !== null ? String(name).trim() : existing.name;
    const finalTeam = team !== undefined && team !== null ? String(team).trim() : existing.team;
    const finalLeague = league !== undefined && league !== null ? String(league).trim() : existing.league;
    const finalSeason = season !== undefined && season !== null ? String(season).trim() : existing.season;
    const finalDesc = description !== undefined ? String(description) : (existing.description || '');
    const finalTags = search_tags !== undefined ? String(search_tags) : (existing.search_tags || '');
    const finalFeatures = features !== undefined ? String(features) : (existing.features || '');
    const finalMaterial = material !== undefined ? String(material) : (existing.material || '100% Recycled Polyester');
    const finalPrice = price !== undefined && !isNaN(Number(price)) ? Number(price) : existing.price;
    const finalOldPrice = old_price !== undefined ? (old_price ? Number(old_price) : null) : existing.old_price;
    const finalCategory = category_id !== undefined ? (category_id && !isNaN(Number(category_id)) ? Number(category_id) : null) : existing.category_id;
    const finalCustom = is_customizable !== undefined ? ((is_customizable === '1' || is_customizable === 1 || is_customizable === true || is_customizable === 'true') ? 1 : 0) : existing.is_customizable;
    const finalCustomPrice = customization_price !== undefined ? Number(customization_price) : (existing.customization_price || 300);
    const finalFeatured = is_featured !== undefined ? ((is_featured === '1' || is_featured === 1 || is_featured === true || is_featured === 'true') ? 1 : 0) : existing.is_featured;
    const finalNew = is_new !== undefined ? ((is_new === '1' || is_new === 1 || is_new === true || is_new === 'true') ? 1 : 0) : existing.is_new;

    execute(`
      UPDATE products SET
        name = ?, team = ?, league = ?, season = ?, category_id = ?,
        description = ?, features = ?, material = ?, price = ?, old_price = ?, search_tags = ?,
        is_customizable = ?, customization_price = ?, is_featured = ?, is_new = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      finalName, finalTeam, finalLeague, finalSeason, finalCategory,
      finalDesc, finalFeatures, finalMaterial,
      finalPrice, finalOldPrice, finalTags,
      finalCustom, finalCustomPrice,
      finalFeatured, finalNew,
      id
    ]);

    // If replacement photos are uploaded, require at least 2 and replace the existing gallery.
    const files = req.files as Express.Multer.File[];
    if (files && files.length > 0) {
      if (files.length < 2) {
        res.status(400).json({ success: false, message: 'Upload at least 2 product photos when replacing the gallery.' });
        return;
      }
      execute('DELETE FROM product_images WHERE product_id = ?', [id]);
      let isPrimary = 1;
      let order = 0;
      for (const file of files) {
        execute(
          'INSERT INTO product_images (product_id, image_url, is_primary, display_order) VALUES (?, ?, ?, ?)',
          [id, `/uploads/products/${file.filename}`, isPrimary, order++]
        );
        isPrimary = 0;
      }
    }

    // Optional stock updates per size
    if (stock_json) {
      try {
        const stockMap: Record<string, number> = typeof stock_json === 'string' ? JSON.parse(stock_json) : stock_json;
        for (const [size, qty] of Object.entries(stockMap)) {
          const numQty = Number(qty);
          if (!isNaN(numQty)) {
            const existingInv = queryOne<{ id: number }>('SELECT id FROM inventory WHERE product_id = ? AND size = ?', [id, size]);
            if (existingInv) {
              execute('UPDATE inventory SET stock_quantity = ? WHERE id = ?', [numQty, existingInv.id]);
            } else {
              execute('INSERT INTO inventory (product_id, size, variant_name, stock_quantity) VALUES (?, ?, ?, ?)', [id, size, 'Home', numQty]);
            }
          }
        }
      } catch (e) {}
    }

    broadcastNotification({
      type: 'order:updated',
      title: 'Jersey Updated',
      message: `"${finalName}" details were updated.`,
      target: 'all',
      data: { product_id: id, name: finalName }
    });

    res.json({ success: true, message: 'Product updated successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error updating product: ' + err.message });
  }
});

// Delete product
router.delete('/products/:id', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  execute('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Product deleted' });
});

// Orders Management
router.get('/orders', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { status, payment_status, search } = req.query;
  const conditions = ['1=1'];
  const params: any[] = [];

  if (status) {
    conditions.push('o.order_status = ?');
    params.push(status);
  }

  if (payment_status) {
    conditions.push('o.payment_status = ?');
    params.push(payment_status);
  }

  if (search) {
    conditions.push('(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.customer_email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const orders = queryAll(`
    SELECT o.*,
      sm.name as shipping_method_name,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as item_count,
      (SELECT pp.screenshot_url FROM payment_proofs pp WHERE pp.order_id = o.id ORDER BY pp.id DESC LIMIT 1) as latest_proof_image,
      (SELECT pp.transaction_reference FROM payment_proofs pp WHERE pp.order_id = o.id ORDER BY pp.id DESC LIMIT 1) as latest_reference
    FROM orders o
    LEFT JOIN shipping_methods sm ON sm.id = o.shipping_method_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY o.created_at DESC
  `, params);

  res.json({ success: true, orders });
});

// Order details
router.get('/orders/:id', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const order = queryOne<any>(`
    SELECT o.*,
      sm.name as shipping_method_name,
      sm.estimated_days
    FROM orders o
    LEFT JOIN shipping_methods sm ON sm.id = o.shipping_method_id
    WHERE o.id = ?
  `, [req.params.id]);

  if (!order) {
    res.status(404).json({ success: false, message: 'Order not found' });
    return;
  }

  const items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
  const proofs = queryAll('SELECT * FROM payment_proofs WHERE order_id = ? ORDER BY id DESC', [order.id]);

  res.json({ success: true, order: { ...order, items, payment_proofs: proofs } });
});

// Update order status
router.put('/orders/:id/status', authAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { order_status, payment_status, rejection_reason } = req.body;
    const orderId = Number(req.params.id);

    const order = queryOne<any>('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [];

    if (order_status) {
      updates.push('order_status = ?');
      params.push(order_status);
    }

    if (payment_status) {
      updates.push('payment_status = ?');
      params.push(payment_status);
    }

    if (rejection_reason !== undefined) {
      updates.push('rejection_reason = ?');
      params.push(rejection_reason);
    }

    params.push(orderId);
    execute(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, params);

    // If order was cancelled, restock inventory
    if (order_status === 'Cancelled' && order.order_status !== 'Cancelled') {
      const items = queryAll<any>('SELECT product_id, size, quantity FROM order_items WHERE order_id = ?', [orderId]);
      for (const it of items) {
        execute('UPDATE inventory SET stock_quantity = stock_quantity + ? WHERE product_id = ? AND size = ?',
          [it.quantity, it.product_id, it.size]);
      }
    }

    if (order.user_id) {
      await notifyCustomer({
        userId: order.user_id, type: 'order', title: `Order Update: ${order.order_number}`,
        message: `Your order status has been updated to: ${order_status || order.order_status}`,
        entityType: 'order', entityId: String(order.id), link: `/orders.html`
      });
    }

    broadcastNotification({
      type: 'order:updated',
      title: 'Order Status Updated',
      message: `Order #${order.order_number} status is now: ${order_status || order.order_status}`,
      target: order.user_id || 'admins',
      data: { order_id: order.id, order_number: order.order_number, status: order_status || order.order_status }
    });

    res.json({ success: true, message: 'Order updated successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error updating order: ' + err.message });
  }
});

// Payment Verification Queue
router.get('/payments', authAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const payments = queryAll(`
    SELECT pp.*,
      o.order_number,
      o.customer_name,
      o.customer_phone,
      o.total as order_total,
      o.order_status,
      o.created_at as order_created_at
    FROM payment_proofs pp
    JOIN orders o ON pp.order_id = o.id
    ORDER BY CASE WHEN pp.status = 'Pending Verification' THEN 0 ELSE 1 END, pp.submitted_at DESC
  `);

  res.json({ success: true, payments });
});

// Verify Payment Action
router.post('/payments/:id/verify', authAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const proofId = Number(req.params.id);
    const proof = queryOne<any>('SELECT * FROM payment_proofs WHERE id = ?', [proofId]);
    if (!proof) {
      res.status(404).json({ success: false, message: 'Payment proof not found' });
      return;
    }

    execute(`
      UPDATE payment_proofs
      SET status = 'Verified', verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [proofId]);

    execute(`
      UPDATE orders
      SET payment_status = 'Verified',
          order_status = 'Processing',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [proof.order_id]);

    const order = queryOne<any>('SELECT user_id, order_number FROM orders WHERE id = ?', [proof.order_id]);
    if (order && order.user_id) {
      await notifyCustomer({
        userId: order.user_id, type: 'payment', title: `Payment Verified: ${order.order_number}`,
        message: `Your payment for order ${order.order_number} has been verified. We have begun processing your jersey for fulfillment.`,
        entityType: 'payment', entityId: String(proof.id), link: `/orders.html`
      });
    }

    await notifyAdmins({
      type: 'payment', title: 'Payment Verified',
      message: `Payment for Order #${order?.order_number || proof.order_id} verified. Status set to Processing.`,
      entityType: 'payment', entityId: String(proof.id), link: `/admin/payments.html`
    });

    res.json({ success: true, message: 'Payment verified successfully. Order moved to Processing.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error verifying payment: ' + err.message });
  }
});

// Reject Payment Action (Requires admin reason)
router.post('/payments/:id/reject', authAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const proofId = Number(req.params.id);
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      res.status(400).json({ success: false, message: 'A rejection reason is strictly required' });
      return;
    }

    const proof = queryOne<any>('SELECT * FROM payment_proofs WHERE id = ?', [proofId]);
    if (!proof) {
      res.status(404).json({ success: false, message: 'Payment proof not found' });
      return;
    }

    execute(`
      UPDATE payment_proofs
      SET status = 'Rejected', admin_notes = ?, verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [reason.trim(), proofId]);

    execute(`
      UPDATE orders
      SET payment_status = 'Rejected',
          order_status = 'Payment Verification Failed',
          rejection_reason = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [reason.trim(), proof.order_id]);

    const order = queryOne<any>('SELECT user_id, order_number FROM orders WHERE id = ?', [proof.order_id]);
    if (order && order.user_id) {
      await notifyCustomer({
        userId: order.user_id, type: 'payment', title: `Payment Rejected: ${order.order_number}`,
        message: `Payment verification failed: ${reason.trim()}. Please upload a valid payment proof.`,
        entityType: 'payment', entityId: String(proof.id), link: `/orders.html`
      });
    }

    await notifyAdmins({
      type: 'payment', title: 'Payment Verification Failed',
      message: `Order #${order?.order_number || proof.order_id} proof was rejected: ${reason.trim()}`,
      entityType: 'payment', entityId: String(proof.id), link: `/admin/payments.html`
    });

    res.json({ success: true, message: 'Payment proof rejected with reason recorded' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error rejecting payment: ' + err.message });
  }
});

// Inventory matrix & stock update
router.get('/inventory', authAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const inventory = queryAll(`
    SELECT inv.*,
      p.name as product_name,
      p.team,
      p.league,
      p.price,
      (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC LIMIT 1) as product_image
    FROM inventory inv
    JOIN products p ON inv.product_id = p.id
    ORDER BY inv.stock_quantity ASC, p.name ASC
  `);

  res.json({ success: true, inventory });
});

router.put('/inventory/:id', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { stock_quantity } = req.body;
  if (stock_quantity === undefined || Number(stock_quantity) < 0) {
    res.status(400).json({ success: false, message: 'Valid stock quantity required' });
    return;
  }

  execute('UPDATE inventory SET stock_quantity = ? WHERE id = ?', [Number(stock_quantity), req.params.id]);
  res.json({ success: true, message: 'Stock quantity updated' });
});

// Categories CRUD
router.get('/categories', authAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const categories = queryAll(`
    SELECT c.*, COUNT(p.id) as product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id
    GROUP BY c.id
    ORDER BY c.display_order ASC
  `);
  res.json({ success: true, categories });
});

router.post('/categories', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { name, description, image_url, display_order } = req.body;
  if (!name || !name.trim()) {
    res.status(400).json({ success: false, message: 'Category name is required' });
    return;
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const result = execute(`
    INSERT INTO categories (name, slug, description, image_url, display_order)
    VALUES (?, ?, ?, ?, ?)
  `, [name.trim(), slug, description || '', image_url || '', Number(display_order || 0)]);

  res.status(201).json({ success: true, message: 'Category created', id: result.lastInsertRowid });
});

router.put('/categories/:id', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { name, description, image_url, display_order } = req.body;
  const slug = name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : undefined;

  execute(`
    UPDATE categories
    SET name = COALESCE(?, name),
        slug = COALESCE(?, slug),
        description = COALESCE(?, description),
        image_url = COALESCE(?, image_url),
        display_order = COALESCE(?, display_order)
    WHERE id = ?
  `, [name?.trim() || null, slug || null, description || null, image_url || null, display_order || null, req.params.id]);

  res.json({ success: true, message: 'Category updated' });
});

router.delete('/categories/:id', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const prodCheck = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM products WHERE category_id = ?', [req.params.id]);
  if (prodCheck && prodCheck.count > 0) {
    res.status(400).json({ success: false, message: `Cannot delete: ${prodCheck.count} products are assigned to this category. Reassign them first.` });
    return;
  }

  execute('DELETE FROM categories WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Category deleted' });
});

// Reviews moderation
router.get('/reviews', authAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const reviews = queryAll(`
    SELECT r.*, p.name as product_name
    FROM reviews r
    JOIN products p ON r.product_id = p.id
    ORDER BY CASE WHEN r.status = 'Pending' THEN 0 ELSE 1 END, r.created_at DESC
  `);
  res.json({ success: true, reviews });
});

router.put('/reviews/:id/status', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { status } = req.body;
  if (!['Pending', 'Approved', 'Hidden'].includes(status)) {
    res.status(400).json({ success: false, message: 'Invalid status' });
    return;
  }

  execute('UPDATE reviews SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true, message: `Review marked as ${status}` });
});

router.delete('/reviews/:id', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  execute('DELETE FROM reviews WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Review deleted' });
});

// Customers list
router.get('/customers', authAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const customers = queryAll(`
    SELECT u.id, u.full_name, u.email, u.phone, u.created_at,
      COUNT(o.id) as orders_count,
      COALESCE(SUM(o.total), 0) as total_spent
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);
  res.json({ success: true, customers });
});

// Homepage Promotions (maximum 2 active at once)
router.get('/banners', authAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const banners = queryAll('SELECT * FROM banners ORDER BY display_order ASC, id DESC');
  res.json({ success: true, banners });
});

router.post('/banners', authAdmin, uploadBannerImage.single('image'), (req: AuthenticatedRequest, res: Response) => {
  const { title, subtitle, cta_text, cta_link, is_active, display_order } = req.body;
  if (!req.file) { res.status(400).json({ success:false, message:'Please upload a promotion image.' }); return; }
  const active = is_active === undefined ? 1 : Number(is_active) ? 1 : 0;
  if (active) {
    const activeCount = queryOne<{count:number}>('SELECT COUNT(*) as count FROM banners WHERE is_active = 1')?.count || 0;
    if (activeCount >= 2) { res.status(400).json({ success:false, message:'You can have a maximum of 2 active promotions. Disable one first.' }); return; }
  }
  const resDb = execute(`INSERT INTO banners (title, subtitle, image_url, cta_text, cta_link, is_active, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [String(title || 'Promotion').trim(), subtitle || '', `/uploads/banners/${req.file.filename}`, cta_text || '', cta_link || '/shop.html', active, Number(display_order || 0)]);
  res.status(201).json({ success:true, message:'Promotion created', id:resDb.lastInsertRowid });
});

router.put('/banners/:id', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { title, subtitle, cta_text, cta_link, is_active, display_order } = req.body;
  const active = is_active !== undefined ? Number(is_active) : undefined;
  if (active === 1) {
    const activeCount = queryOne<{count:number}>('SELECT COUNT(*) as count FROM banners WHERE is_active = 1 AND id != ?', [req.params.id])?.count || 0;
    if (activeCount >= 2) { res.status(400).json({ success:false, message:'Maximum 2 active promotions allowed.' }); return; }
  }
  execute(`UPDATE banners SET title=COALESCE(?,title), subtitle=COALESCE(?,subtitle), cta_text=COALESCE(?,cta_text), cta_link=COALESCE(?,cta_link), is_active=COALESCE(?,is_active), display_order=COALESCE(?,display_order) WHERE id=?`,
    [title?.trim() || null, subtitle !== undefined ? subtitle : null, cta_text !== undefined ? cta_text : null, cta_link !== undefined ? cta_link : null, active, display_order !== undefined ? Number(display_order) : null, req.params.id]);
  res.json({success:true,message:'Promotion updated'});
});

router.delete('/banners/:id', authAdmin, (req: AuthenticatedRequest, res: Response) => { execute('DELETE FROM banners WHERE id = ?', [req.params.id]); res.json({success:true,message:'Promotion deleted'}); });

// Additional payment methods managed by the administrator
router.get('/payment-methods', authAdmin, (_req: AuthenticatedRequest, res: Response) => {
  res.json({success:true, methods: queryAll('SELECT * FROM payment_methods ORDER BY display_order ASC, id ASC')});
});

router.post('/payment-methods', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const {name, account_name, account_number, instructions, logo_url, is_active, display_order} = req.body;
  if (!String(name || '').trim()) { res.status(400).json({success:false,message:'Payment method name is required'}); return; }
  const r=execute('INSERT INTO payment_methods (name,account_name,account_number,instructions,logo_url,is_active,display_order) VALUES (?,?,?,?,?,?,?)',[String(name).trim(),account_name||'',account_number||'',instructions||'',logo_url||'',is_active===undefined?1:Number(is_active)?1:0,Number(display_order||0)]);
  res.status(201).json({success:true,id:r.lastInsertRowid,message:'Payment method added'});
});

router.put('/payment-methods/:id', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const {name,account_name,account_number,instructions,logo_url,is_active,display_order}=req.body;
  execute('UPDATE payment_methods SET name=COALESCE(?,name),account_name=COALESCE(?,account_name),account_number=COALESCE(?,account_number),instructions=COALESCE(?,instructions),logo_url=COALESCE(?,logo_url),is_active=COALESCE(?,is_active),display_order=COALESCE(?,display_order),updated_at=CURRENT_TIMESTAMP WHERE id=?',[name?.trim()||null,account_name!==undefined?account_name:null,account_number!==undefined?account_number:null,instructions!==undefined?instructions:null,logo_url!==undefined?logo_url:null,is_active!==undefined?Number(is_active):null,display_order!==undefined?Number(display_order):null,req.params.id]);
  res.json({success:true,message:'Payment method updated'});
});

router.delete('/payment-methods/:id', authAdmin, (req: AuthenticatedRequest, res: Response) => { execute('DELETE FROM payment_methods WHERE id=?',[req.params.id]); res.json({success:true,message:'Payment method deleted'}); });

// Shipping methods
router.get('/shipping', authAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const methods = queryAll('SELECT * FROM shipping_methods ORDER BY id ASC');
  res.json({ success: true, methods });
});

router.put('/shipping/:id', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { name, price, estimated_days, is_active } = req.body;
  execute(`
    UPDATE shipping_methods
    SET name = COALESCE(?, name),
        price = COALESCE(?, price),
        estimated_days = COALESCE(?, estimated_days),
        is_active = COALESCE(?, is_active)
    WHERE id = ?
  `, [name || null, price !== undefined ? Number(price) : null, estimated_days || null, is_active !== undefined ? Number(is_active) : null, req.params.id]);

  res.json({ success: true, message: 'Shipping method updated' });
});

// Settings Management
router.get('/settings', authAdmin, (_req: AuthenticatedRequest, res: Response) => {
  const rows = queryAll('SELECT * FROM settings');
  res.json({ success: true, settings: rows });
});

router.put('/settings', authAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    res.status(400).json({ success: false, message: 'Invalid settings payload' });
    return;
  }

  for (const [key, value] of Object.entries(settings)) {
    execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
  }

  // Keep the three built-in payment methods synchronized with the legacy
  // account fields so checkout and the admin settings page use one source.
  const builtIns = [
    ['Commercial Bank of Ethiopia (CBE)', settings.cbe_account_name, settings.cbe_account_number, settings.cbe_instructions, 1],
    ['Bank of Abyssinia', settings.abyssinia_account_name, settings.abyssinia_account_number, settings.abyssinia_instructions, 2],
    ['Telebirr Mobile Money', settings.telebirr_account_name, settings.telebirr_phone, settings.telebirr_instructions, 3]
  ];
  for (const [name, accountName, accountNumber, instructions, order] of builtIns) {
    const existing = queryOne<{ id:number }>('SELECT id FROM payment_methods WHERE name = ?', [name]);
    if (existing) {
      execute('UPDATE payment_methods SET account_name=?, account_number=?, instructions=?, is_active=1, display_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [accountName || '', accountNumber || '', instructions || '', order, existing.id]);
    } else {
      execute('INSERT INTO payment_methods (name, account_name, account_number, instructions, is_active, display_order) VALUES (?, ?, ?, ?, 1, ?)', [name, accountName || '', accountNumber || '', instructions || '', order]);
    }
  }

  broadcastNotification({
    type: 'settings:updated',
    title: 'Store Settings Saved',
    message: `Store branding & payment instructions updated.`,
    target: 'all',
    data: { settings }
  });

  res.json({ success: true, message: 'Settings saved successfully' });
});

export default router;
