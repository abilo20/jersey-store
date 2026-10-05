import { Router, Request, Response } from 'express';
import { queryAll, queryOne, execute } from '../database/db.js';
import { optionalCustomer, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

// Get categories
router.get('/categories', (_req: Request, res: Response) => {
  const categories = queryAll(`
    SELECT c.*, COUNT(p.id) as product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id
    GROUP BY c.id
    ORDER BY c.display_order ASC, c.id ASC
  `);
  res.json({ success: true, categories });
});

// Get active banners
router.get('/banners', (_req: Request, res: Response) => {
  const banners = queryAll('SELECT * FROM banners WHERE is_active = 1 ORDER BY display_order ASC, id ASC');
  res.json({ success: true, banners });
});

// Get filter metadata (distinct teams, leagues, seasons, sizes from real database)
router.get('/filters', (_req: Request, res: Response) => {
  const teams = queryAll<{ team: string }>('SELECT DISTINCT team FROM products ORDER BY team ASC').map(r => r.team);
  const leagues = queryAll<{ league: string }>('SELECT DISTINCT league FROM products ORDER BY league ASC').map(r => r.league);
  const seasons = queryAll<{ season: string }>('SELECT DISTINCT season FROM products ORDER BY season DESC').map(r => r.season);
  const sizes = queryAll<{ size: string }>('SELECT DISTINCT size FROM product_sizes ORDER BY id ASC').map(r => r.size);
  const priceRange = queryOne<{ min_price: number; max_price: number }>('SELECT MIN(price) as min_price, MAX(price) as max_price FROM products');

  res.json({
    success: true,
    filters: {
      teams,
      leagues,
      seasons,
      sizes,
      priceRange: {
        min: priceRange?.min_price || 0,
        max: priceRange?.max_price || 5000
      }
    }
  });
});

// List products with search, filter, and sorting
router.get('/', optionalCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      search,
      category,
      team,
      league,
      season,
      size,
      variant,
      min_price,
      max_price,
      in_stock,
      featured,
      is_new,
      sort,
      limit = 50,
      offset = 0
    } = req.query;

    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (search) {
      conditions.push('(p.name LIKE ? OR p.team LIKE ? OR p.league LIKE ? OR p.season LIKE ? OR p.description LIKE ? OR p.search_tags LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term, term, term);
    }

    if (category) {
      conditions.push('(c.slug = ? OR c.id = ?)');
      params.push(category, category);
    }

    if (team) {
      conditions.push('p.team = ?');
      params.push(team);
    }

    if (league) {
      conditions.push('p.league = ?');
      params.push(league);
    }

    if (season) {
      conditions.push('p.season = ?');
      params.push(season);
    }

    if (min_price) {
      conditions.push('p.price >= ?');
      params.push(Number(min_price));
    }

    if (max_price) {
      conditions.push('p.price <= ?');
      params.push(Number(max_price));
    }

    if (featured === '1' || featured === 'true') {
      conditions.push('p.is_featured = 1');
    }

    if (is_new === '1' || is_new === 'true') {
      conditions.push('p.is_new = 1');
    }

    if (size) {
      conditions.push('EXISTS (SELECT 1 FROM product_sizes ps WHERE ps.product_id = p.id AND ps.size = ? AND ps.is_available = 1)');
      params.push(size);
    }

    if (variant) {
      conditions.push('EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.name = ?)');
      params.push(variant);
    }

    if (in_stock === '1' || in_stock === 'true') {
      conditions.push('EXISTS (SELECT 1 FROM inventory inv WHERE inv.product_id = p.id AND inv.stock_quantity > 0)');
    }

    let orderBy = 'p.is_featured DESC, p.created_at DESC';
    if (sort === 'newest') {
      orderBy = 'p.created_at DESC';
    } else if (sort === 'price_asc') {
      orderBy = 'p.price ASC';
    } else if (sort === 'price_desc') {
      orderBy = 'p.price DESC';
    } else if (sort === 'rating') {
      orderBy = 'avg_rating DESC NULLS LAST';
    }

    const sql = `
      SELECT p.*,
        c.name as category_name,
        c.slug as category_slug,
        (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) as primary_image,
        (SELECT COALESCE(SUM(inv.stock_quantity), 0) FROM inventory inv WHERE inv.product_id = p.id) as total_stock,
        (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id AND r.status = 'Approved') as avg_rating,
        (SELECT COUNT(r.id) FROM reviews r WHERE r.product_id = p.id AND r.status = 'Approved') as review_count,
        (SELECT COUNT(*) FROM wishlists w WHERE w.product_id = p.id AND w.user_id = ?) as is_favorite
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    // Favorite state is account-specific; guests simply receive false.
    if (req.user) params.push(req.user.id); else { /* placeholder already bound below */ }
    params.push(Number(limit), Number(offset));
    const products = queryAll(sql, params);

    // Get total count for pagination
    const countSql = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${conditions.join(' AND ')}
    `;
    const countRes = queryOne<{ total: number }>(countSql, params.slice(0, -2));

    res.json({
      success: true,
      products,
      pagination: {
        total: countRes?.total || 0,
        limit: Number(limit),
        offset: Number(offset)
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error retrieving products: ' + err.message });
  }
});

// Get single product details by slug or ID
router.get('/:identifier', optionalCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { identifier } = req.params;
    const isId = /^\d+$/.test(identifier);

    const product = queryOne<any>(
      `SELECT p.*,
        c.name as category_name,
        c.slug as category_slug,
        (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id AND r.status = 'Approved') as avg_rating,
        (SELECT COUNT(r.id) FROM reviews r WHERE r.product_id = p.id AND r.status = 'Approved') as review_count,
        (SELECT COUNT(*) FROM wishlists w WHERE w.product_id = p.id AND w.user_id = ?) as is_favorite,
        (SELECT COALESCE(SUM(inv.stock_quantity), 0) FROM inventory inv WHERE inv.product_id = p.id) as total_stock
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE ${isId ? 'p.id = ?' : 'p.slug = ?'}`,
      [identifier]
    );

    if (!product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    // Images
    const images = queryAll('SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, display_order ASC', [product.id]);

    // Variants
    const variants = queryAll('SELECT * FROM product_variants WHERE product_id = ?', [product.id]);

    // Sizes with real stock per size
    const sizes = queryAll(`
      SELECT ps.size, ps.is_available,
        (SELECT COALESCE(SUM(inv.stock_quantity), 0) FROM inventory inv WHERE inv.product_id = ps.product_id AND inv.size = ps.size) as stock
      FROM product_sizes ps
      WHERE ps.product_id = ?
      ORDER BY ps.id ASC
    `, [product.id]);

    // Full inventory breakdown
    const inventory = queryAll('SELECT * FROM inventory WHERE product_id = ?', [product.id]);

    // Check if user liked it
    let isLiked = false;
    const clientId = (req.query.client_id as string) || '';
    if (req.user) {
      const likeCheck = queryOne('SELECT 1 FROM product_likes WHERE product_id = ? AND user_id = ?', [product.id, req.user.id]);
      if (likeCheck) isLiked = true;
    } else if (clientId) {
      const likeCheck = queryOne('SELECT 1 FROM product_likes WHERE product_id = ? AND client_id = ?', [product.id, clientId]);
      if (likeCheck) isLiked = true;
    }

    // Approved reviews
    const reviews = queryAll(`
      SELECT r.id, r.user_name, r.rating, r.title, r.comment, r.image_url, r.created_at
      FROM reviews r
      WHERE r.product_id = ? AND r.status = 'Approved'
      ORDER BY r.created_at DESC
    `, [product.id]);

    // Related products (same category or league)
    const related = queryAll(`
      SELECT p.id, p.name, p.slug, p.team, p.price, p.old_price, p.is_customizable,
        (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) as primary_image,
        (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id AND r.status = 'Approved') as avg_rating
      FROM products p
      WHERE (p.category_id = ? OR p.league = ?) AND p.id != ?
      LIMIT 4
    `, [product.category_id, product.league, product.id]);

    res.json({
      success: true,
      product: {
        ...product,
        images,
        variants,
        sizes,
        inventory,
        isLiked,
        reviews,
        related
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error retrieving product: ' + err.message });
  }
});

// Toggle product like (Real stored like system)
router.post('/:id/like', optionalCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const productId = Number(req.params.id);
    const { client_id } = req.body;
    const effectiveClientId = client_id || (req.user ? `user-${req.user.id}` : 'anon-' + req.ip);

    const product = queryOne<{ id: number; likes_count: number }>('SELECT id, likes_count FROM products WHERE id = ?', [productId]);
    if (!product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    const userId = req.user ? req.user.id : null;
    const existing = queryOne(
      'SELECT id FROM product_likes WHERE product_id = ? AND (client_id = ? OR (user_id IS NOT NULL AND user_id = ?))',
      [productId, effectiveClientId, userId]
    );

    let liked = false;
    if (existing) {
      execute('DELETE FROM product_likes WHERE id = ?', [(existing as any).id]);
      execute('UPDATE products SET likes_count = MAX(0, likes_count - 1) WHERE id = ?', [productId]);
      liked = false;
    } else {
      execute('INSERT INTO product_likes (product_id, client_id, user_id) VALUES (?, ?, ?)', [productId, effectiveClientId, userId]);
      execute('UPDATE products SET likes_count = likes_count + 1 WHERE id = ?', [productId]);
      liked = true;
    }

    const updated = queryOne<{ likes_count: number }>('SELECT likes_count FROM products WHERE id = ?', [productId]);

    res.json({
      success: true,
      liked,
      likes_count: updated?.likes_count || 0
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error toggling like: ' + err.message });
  }
});

export default router;
