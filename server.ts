import 'dotenv/config';
import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { initDatabase } from './backend/database/init.js';
import { initWebSocketServer } from './backend/websocket.js';

import authRoutes from './backend/routes/auth.js';
import productRoutes from './backend/routes/products.js';
import cartRoutes from './backend/routes/cart.js';
import wishlistRoutes from './backend/routes/wishlist.js';
import orderRoutes from './backend/routes/orders.js';
import reviewRoutes from './backend/routes/reviews.js';
import settingsRoutes from './backend/routes/settings.js';
import shippingRoutes from './backend/routes/shipping.js';
import notificationRoutes from './backend/routes/notifications.js';
import adminRoutes from './backend/routes/admin.js';

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Generate seed assets & initialize database
  await initDatabase();

  // Basic security and request middleware
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Static uploads directory
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/wishlist', wishlistRoutes);
  app.use('/api/favorites', wishlistRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/reviews', reviewRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/shipping', shippingRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/admin', adminRoutes);

  // Health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', store: 'Mira Sport', timestamp: new Date().toISOString() });
  });

  // Serve static files from frontend directory
  const frontendDir = path.resolve(process.cwd(), 'frontend');
  app.use(express.static(frontendDir));

  // Friendly rewrite routes for HTML pages
  const htmlRoutes = [
    { path: '/', file: 'index.html' },
    { path: '/shop', file: 'shop.html' },
    { path: '/product', file: 'product.html' },
    { path: '/cart', file: 'cart.html' },
    { path: '/checkout', file: 'checkout.html' },
    { path: '/tracking', file: 'tracking.html' },
    { path: '/orders', file: 'orders.html' },
    { path: '/wishlist', file: 'favorites.html' },
    { path: '/favorites', file: 'favorites.html' },
    { path: '/profile', file: 'profile.html' },
    { path: '/login', file: 'login.html' },
    { path: '/register', file: 'register.html' },
    { path: '/admin', file: 'admin/index.html' },
    { path: '/admin/', file: 'admin/index.html' },
    { path: '/admin/login', file: 'admin/login.html' },
    { path: '/admin/products', file: 'admin/products.html' },
    { path: '/admin/orders', file: 'admin/orders.html' },
    { path: '/admin/payments', file: 'admin/payments.html' },
    { path: '/admin/inventory', file: 'admin/inventory.html' },
    { path: '/admin/categories', file: 'admin/categories.html' },
    { path: '/admin/reviews', file: 'admin/reviews.html' },
    { path: '/admin/customers', file: 'admin/customers.html' },
    { path: '/admin/banners', file: 'admin/banners.html' },
    { path: '/admin/shipping', file: 'admin/shipping.html' },
    { path: '/admin/settings', file: 'admin/settings.html' },
  ];

  for (const route of htmlRoutes) {
    app.get(route.path, (_req: Request, res: Response) => {
      const filePath = path.join(frontendDir, route.file);
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send('Page not found');
      }
    });
  }

  // Vite middleware mounting in development as required by environment guidelines
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom'
    });
    app.use(vite.middlewares);
  }

  // Fallback for SPA/HTML
  app.use((req: Request, res: Response, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/uploads/') && !req.path.startsWith('/ws')) {
      const target = path.join(frontendDir, 'index.html');
      if (fs.existsSync(target)) {
        return res.sendFile(target);
      }
    }
    next();
  });

  const httpServer = http.createServer(app);
  initWebSocketServer(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Mira Sport server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
