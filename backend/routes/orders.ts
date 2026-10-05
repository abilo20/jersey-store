import { Router, Request, Response } from 'express';
import { queryAll, queryOne, execute } from '../database/db.js';
import { optionalCustomer, authCustomer, AuthenticatedRequest } from '../middleware/auth.js';
import { uploadPaymentProof } from '../middleware/upload.js';
import { notifyCustomer, notifyAdmins } from '../services/notificationService.js';

const router = Router();

function generateOrderNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `JH-${y}${m}${d}-${rand}`;
}

function generateTrackingCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `TRK-${code}`;
}

// Create order (Checkout)
router.post('/', optionalCustomer, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      region,
      city,
      sub_city,
      woreda,
      address,
      delivery_notes,
      shipping_method_id,
      payment_method,
      items,
      session_id
    } = req.body;

    // Validate customer fields
    if (!customer_name || !customer_email || !customer_phone || !region || !city || !address) {
      res.status(400).json({ success: false, message: 'Please provide full name, email, phone, region, city, and street address' });
      return;
    }

    if (!payment_method) {
      res.status(400).json({ success: false, message: 'Please select a payment method' });
      return;
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, message: 'Your cart is empty' });
      return;
    }

    // Shipping method
    let shippingCost = 150.0;
    if (shipping_method_id) {
      const shipMethod = queryOne<{ price: number }>('SELECT price FROM shipping_methods WHERE id = ?', [shipping_method_id]);
      if (shipMethod) shippingCost = shipMethod.price;
    }

    // Validate inventory and calculate totals
    let subtotal = 0;
    const validatedItems: any[] = [];

    for (const item of items) {
      const product = queryOne<any>('SELECT * FROM products WHERE id = ?', [item.product_id]);
      if (!product) {
        res.status(400).json({ success: false, message: `Product #${item.product_id} no longer exists` });
        return;
      }

      // Check stock
      const inv = queryOne<{ stock_quantity: number }>(
        'SELECT stock_quantity FROM inventory WHERE product_id = ? AND size = ? LIMIT 1',
        [item.product_id, item.size]
      );

      const available = inv ? inv.stock_quantity : 10;
      if (item.quantity > available) {
        res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name} (Size: ${item.size}). Available: ${available}`
        });
        return;
      }

      const hasCustomization = Boolean(product.is_customizable && (item.player_name?.trim() || item.player_number?.trim()));
      const customCost = hasCustomization ? (product.customization_price || 250) : 0;
      const unitPrice = product.price + customCost;
      const totalPrice = unitPrice * item.quantity;
      subtotal += totalPrice;

      // Get primary image
      const img = queryOne<{ image_url: string }>(
        'SELECT image_url FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, display_order ASC LIMIT 1',
        [product.id]
      );

      validatedItems.push({
        product_id: product.id,
        product_name: product.name,
        product_image: img?.image_url || '/uploads/products/product-placeholder.jpg',
        size: item.size,
        variant_name: item.variant_name || 'Home',
        player_name: (item.player_name || '').trim().toUpperCase() || null,
        player_number: (item.player_number || '').trim().toUpperCase() || null,
        quantity: item.quantity,
        unit_price: unitPrice,
        total_price: totalPrice
      });
    }

    const total = subtotal + shippingCost;
    const orderNumber = generateOrderNumber();
    const trackingCode = generateTrackingCode();
    const userId = req.user ? req.user.id : null;

    // Insert order
    const orderResult = execute(`
      INSERT INTO orders (
        order_number, tracking_code, user_id,
        customer_name, customer_email, customer_phone,
        region, city, sub_city, woreda, address, delivery_notes,
        shipping_method_id, shipping_cost, subtotal, discount, total,
        payment_method, payment_status, order_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Verification', 'Order Placed')
    `, [
      orderNumber, trackingCode, userId,
      customer_name.trim(), customer_email.trim().toLowerCase(), customer_phone.trim(),
      region.trim(), city.trim(), sub_city?.trim() || '', woreda?.trim() || '', address.trim(), delivery_notes?.trim() || null,
      shipping_method_id || null, shippingCost, subtotal, 0, total,
      payment_method
    ]);

    const orderId = orderResult.lastInsertRowid;

    // Insert order items and decrease inventory
    for (const vItem of validatedItems) {
      execute(`
        INSERT INTO order_items (order_id, product_id, product_name, product_image, size, variant_name, player_name, player_number, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        orderId, vItem.product_id, vItem.product_name, vItem.product_image,
        vItem.size, vItem.variant_name, vItem.player_name, vItem.player_number,
        vItem.quantity, vItem.unit_price, vItem.total_price
      ]);

      // Deduct inventory
      execute(`
        UPDATE inventory
        SET stock_quantity = MAX(0, stock_quantity - ?)
        WHERE product_id = ? AND size = ?
      `, [vItem.quantity, vItem.product_id, vItem.size]);
    }

    // Clear cart if session_id or user_id provided
    if (userId) {
      const cart = queryOne<{ id: number }>('SELECT id FROM carts WHERE user_id = ?', [userId]);
      if (cart) execute('DELETE FROM cart_items WHERE cart_id = ?', [cart.id]);
    } else if (session_id) {
      const cart = queryOne<{ id: number }>('SELECT id FROM carts WHERE session_id = ?', [session_id]);
      if (cart) execute('DELETE FROM cart_items WHERE cart_id = ?', [cart.id]);
    }

    if (userId) {
      await notifyCustomer({
        userId, type: 'order', title: `Order Placed: ${orderNumber}`,
        message: `Your jersey order ${orderNumber} has been recorded. Please submit your payment reference to start processing.`,
        entityType: 'order', entityId: String(orderId), link: `/tracking.html?code=${encodeURIComponent(trackingCode)}`
      });
    }

    await notifyAdmins({
      type: 'order', title: 'New Order Placed',
      message: `Order #${orderNumber} (${total.toLocaleString()} ETB) placed by ${customer_name.trim()}`,
      entityType: 'order', entityId: String(orderId), link: `/admin/orders.html?order_id=${orderId}`
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: {
        id: orderId,
        order_number: orderNumber,
        tracking_code: trackingCode,
        total,
        subtotal,
        shipping_cost: shippingCost,
        payment_method,
        order_status: 'Order Placed',
        payment_status: 'Pending Verification'
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error creating order: ' + err.message });
  }
});

// Submit payment proof (screenshot + transaction reference number)
router.post('/:orderNumber/payment-proof', uploadPaymentProof.single('screenshot'), async (req: Request, res: Response) => {
  try {
    const { orderNumber } = req.params;
    const { transaction_reference, payment_method } = req.body;

    if (!transaction_reference || !transaction_reference.trim()) {
      res.status(400).json({ success: false, message: 'Transaction or reference number is required' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ success: false, message: 'Payment screenshot or transfer receipt image is required' });
      return;
    }

    const order = queryOne<{ id: number; payment_method: string; user_id: number | null }>(
      'SELECT id, payment_method, user_id FROM orders WHERE order_number = ?',
      [orderNumber]
    );

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const screenshotUrl = `/uploads/payments/${req.file.filename}`;
    const effectivePaymentMethod = payment_method || order.payment_method;

    // Insert or update payment proof
    execute(`
      INSERT INTO payment_proofs (order_id, payment_method, transaction_reference, screenshot_url, status, submitted_at)
      VALUES (?, ?, ?, ?, 'Pending Verification', CURRENT_TIMESTAMP)
    `, [order.id, effectivePaymentMethod, transaction_reference.trim(), screenshotUrl]);

    // Update order status
    execute(`
      UPDATE orders
      SET order_status = 'Payment Submitted',
          payment_status = 'Pending Verification',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [order.id]);

    if (order.user_id) {
      await notifyCustomer({
        userId: order.user_id, type: 'payment', title: 'Payment Proof Received',
        message: `Payment proof for order ${orderNumber} (Ref: ${transaction_reference.trim()}) is pending administrator verification.`,
        entityType: 'payment', entityId: String(order.id), link: `/tracking.html?code=${encodeURIComponent(orderNumber)}`
      });
    }

    await notifyAdmins({
      type: 'payment', title: 'Payment Proof Uploaded',
      message: `Order #${orderNumber} submitted proof (Ref: ${transaction_reference.trim()})`,
      entityType: 'payment', entityId: String(order.id), link: `/admin/payments.html`
    });

    res.json({
      success: true,
      message: 'Payment proof submitted successfully. An administrator will verify your transfer.',
      order_status: 'Payment Submitted',
      payment_status: 'Pending Verification',
      screenshot_url: screenshotUrl
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error uploading payment proof: ' + err.message });
  }
});

// Track order by Order Number OR Tracking Code
router.get('/track/:query', (req: Request, res: Response) => {
  try {
    const rawQuery = (req.params.query || '').trim();
    if (!rawQuery) {
      res.status(400).json({ success: false, message: 'Order number or tracking code required' });
      return;
    }

    const order = queryOne<any>(`
      SELECT o.*,
        sm.name as shipping_method_name,
        sm.estimated_days,
        pp.transaction_reference,
        pp.screenshot_url,
        pp.submitted_at as payment_submitted_at
      FROM orders o
      LEFT JOIN shipping_methods sm ON sm.id = o.shipping_method_id
      LEFT JOIN payment_proofs pp ON pp.order_id = o.id
      WHERE UPPER(o.order_number) = UPPER(?) OR UPPER(o.tracking_code) = UPPER(?)
      ORDER BY pp.id DESC LIMIT 1
    `, [rawQuery, rawQuery]);

    if (!order) {
      res.status(404).json({ success: false, message: `No order found matching "${rawQuery}"` });
      return;
    }

    const items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [order.id]);

    // Timeline calculation based strictly on real state:
    // Stages: Order Placed -> Payment Submitted -> Payment Verification -> Processing -> Packed -> Shipped -> Out for Delivery -> Delivered
    const allStages = [
      'Order Placed',
      'Payment Submitted',
      'Payment Verification Pending',
      'Payment Verified',
      'Processing',
      'Packed',
      'Shipped',
      'Out for Delivery',
      'Delivered'
    ];

    const currentStatus = order.order_status;
    const isCancelled = currentStatus === 'Cancelled';
    const isReturned = currentStatus === 'Returned';

    res.json({
      success: true,
      order: {
        ...order,
        items,
        isCancelled,
        isReturned
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error tracking order: ' + err.message });
  }
});

// Get user orders (authenticated)
router.get('/user', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const orders = queryAll<any>(`
      SELECT o.*,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as item_count,
        (SELECT oi.product_image FROM order_items oi WHERE oi.order_id = o.id LIMIT 1) as sample_image
      FROM orders o
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
    `, [req.user!.id]);

    const formatted = orders.map(order => {
      const items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      return { ...order, items };
    });

    res.json({ success: true, orders: formatted });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error loading orders: ' + err.message });
  }
});

// Single order details by order number
router.get('/:orderNumber', optionalCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderNumber } = req.params;
    const order = queryOne<any>(`
      SELECT o.*,
        sm.name as shipping_method_name,
        sm.estimated_days,
        pp.transaction_reference,
        pp.screenshot_url,
        pp.status as proof_status,
        pp.admin_notes
      FROM orders o
      LEFT JOIN shipping_methods sm ON sm.id = o.shipping_method_id
      LEFT JOIN payment_proofs pp ON pp.order_id = o.id
      WHERE o.order_number = ?
      ORDER BY pp.id DESC LIMIT 1
    `, [orderNumber]);

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const items = queryAll('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    res.json({ success: true, order: { ...order, items } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error loading order: ' + err.message });
  }
});

// Buy Again action: returns items ready for adding to cart
router.post('/:orderNumber/buy-again', optionalCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderNumber } = req.params;
    const order = queryOne<{ id: number }>('SELECT id FROM orders WHERE order_number = ?', [orderNumber]);
    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const items = queryAll<any>('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    res.json({
      success: true,
      items: items.map(it => ({
        product_id: it.product_id,
        size: it.size,
        variant_name: it.variant_name,
        player_name: it.player_name || '',
        player_number: it.player_number || '',
        quantity: it.quantity
      }))
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error with buy again: ' + err.message });
  }
});

export default router;
