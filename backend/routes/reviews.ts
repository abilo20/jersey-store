import { Router, Response } from 'express';
import { queryAll, queryOne, execute } from '../database/db.js';
import { optionalCustomer, AuthenticatedRequest } from '../middleware/auth.js';
import { uploadReviewImage } from '../middleware/upload.js';
import { notifyAdmins } from '../services/notificationService.js';

const router = Router();

// Get approved reviews for a product
router.get('/product/:productId', (_req, res: Response) => {
  try {
    const reviews = queryAll(`
      SELECT id, user_name, rating, title, comment, image_url, created_at
      FROM reviews
      WHERE product_id = ? AND status = 'Approved'
      ORDER BY created_at DESC
    `, [_req.params.productId]);

    const stats = queryOne<{ avg_rating: number; total_reviews: number }>(`
      SELECT ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as total_reviews
      FROM reviews
      WHERE product_id = ? AND status = 'Approved'
    `, [_req.params.productId]);

    // Rating breakdown (5, 4, 3, 2, 1 stars)
    const breakdown = [5, 4, 3, 2, 1].map(stars => {
      const countRes = queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM reviews WHERE product_id = ? AND status = \'Approved\' AND rating = ?',
        [_req.params.productId, stars]
      );
      return {
        stars,
        count: countRes?.count || 0
      };
    });

    res.json({
      success: true,
      reviews,
      stats: {
        avg_rating: stats?.avg_rating || 0,
        total_reviews: stats?.total_reviews || 0,
        breakdown
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error retrieving reviews: ' + err.message });
  }
});

// Submit a new review (starts as 'Pending' for admin moderation)
router.post('/product/:productId', optionalCustomer, uploadReviewImage.single('image'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const productId = Number(req.params.productId);
    const { rating, title, comment, user_name } = req.body;

    const numRating = Number(rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      res.status(400).json({ success: false, message: 'Please provide a valid rating from 1 to 5 stars' });
      return;
    }

    if (!title || !title.trim()) {
      res.status(400).json({ success: false, message: 'Review headline/title is required' });
      return;
    }

    if (!comment || !comment.trim()) {
      res.status(400).json({ success: false, message: 'Review feedback comment is required' });
      return;
    }

    const effectiveName = (user_name || '').trim() || (req.user ? req.user.full_name : 'Anonymous Football Fan');
    const imageUrl = req.file ? `/uploads/reviews/${req.file.filename}` : null;
    const userId = req.user ? req.user.id : null;

    const result = execute(`
      INSERT INTO reviews (product_id, user_id, user_name, rating, title, comment, image_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')
    `, [productId, userId, effectiveName, numRating, title.trim(), comment.trim(), imageUrl]);

    await notifyAdmins({
      type: 'review:new',
      title: 'New Customer Review',
      message: `${numRating}-star review submitted by ${effectiveName}: \"${title.trim()}\"`,
      entityType: 'review',
      entityId: String(result.lastInsertRowid),
      link: '/admin/reviews.html'
    });

    res.status(201).json({
      success: true,
      message: 'Thank you! Your review has been submitted and will appear publicly once approved by our moderation team.',
      review_id: result.lastInsertRowid
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error submitting review: ' + err.message });
  }
});

// Get reviews submitted by authenticated user
router.get('/user', optionalCustomer, (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const reviews = queryAll(`
    SELECT r.*, p.name as product_name, p.slug as product_slug,
      (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC LIMIT 1) as product_image
    FROM reviews r
    JOIN products p ON r.product_id = p.id
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC
  `, [req.user.id]);

  res.json({ success: true, reviews });
});

export default router;
