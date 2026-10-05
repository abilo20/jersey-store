import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { getDb, execute, queryOne, queryAll, saveDb } from './db.js';

export async function initDatabase(): Promise<void> {
  await getDb();

  // Create tables
  execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      google_id TEXT UNIQUE,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      image_url TEXT,
      display_order INTEGER DEFAULT 0
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      team TEXT NOT NULL,
      league TEXT NOT NULL,
      season TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      description TEXT,
      features TEXT,
      material TEXT DEFAULT '100% Recycled Polyester (AEROREADY / Dri-FIT)',
      price REAL NOT NULL,
      old_price REAL,
      is_customizable INTEGER DEFAULT 1,
      customization_price REAL DEFAULT 250.0,
      is_featured INTEGER DEFAULT 0,
      is_new INTEGER DEFAULT 0,
      likes_count INTEGER DEFAULT 0,
      search_tags TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      display_order INTEGER DEFAULT 0
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS product_sizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      size TEXT NOT NULL,
      is_available INTEGER DEFAULT 1
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      size TEXT NOT NULL,
      variant_name TEXT NOT NULL,
      stock_quantity INTEGER NOT NULL DEFAULT 10
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      session_id TEXT UNIQUE,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      size TEXT NOT NULL,
      variant_name TEXT NOT NULL,
      player_name TEXT,
      player_number TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS wishlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id)
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      tracking_code TEXT UNIQUE NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      region TEXT NOT NULL,
      city TEXT NOT NULL,
      sub_city TEXT,
      woreda TEXT,
      address TEXT NOT NULL,
      delivery_notes TEXT,
      shipping_method_id INTEGER REFERENCES shipping_methods(id),
      shipping_cost REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL,
      discount REAL DEFAULT 0,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT DEFAULT 'Pending Verification',
      order_status TEXT DEFAULT 'Order Placed',
      rejection_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      product_image TEXT,
      size TEXT NOT NULL,
      variant_name TEXT NOT NULL,
      player_name TEXT,
      player_number TEXT,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      total_price REAL NOT NULL
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      account_name TEXT,
      account_number TEXT,
      instructions TEXT,
      logo_url TEXT,
      is_active INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS payment_proofs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      payment_method TEXT NOT NULL,
      transaction_reference TEXT NOT NULL,
      screenshot_url TEXT NOT NULL,
      status TEXT DEFAULT 'Pending Verification',
      admin_notes TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      verified_at DATETIME
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      title TEXT NOT NULL,
      comment TEXT NOT NULL,
      image_url TEXT,
      status TEXT DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT,
      image_url TEXT NOT NULL,
      cta_text TEXT DEFAULT 'Shop Now',
      cta_link TEXT DEFAULT '/shop.html',
      is_active INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS shipping_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      price REAL NOT NULL,
      estimated_days TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT DEFAULT 'Home',
      recipient_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      region TEXT NOT NULL,
      city TEXT NOT NULL,
      sub_city TEXT,
      woreda TEXT,
      street_address TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Run safe schema migrations for notifications table if existing database has older columns
  try {
    const notifCols = queryAll<{ name: string }>('PRAGMA table_info(notifications)');
    const colNames = notifCols.map(c => c.name);
    if (!colNames.includes('admin_id')) execute('ALTER TABLE notifications ADD COLUMN admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE');
    if (!colNames.includes('type')) execute("ALTER TABLE notifications ADD COLUMN type TEXT NOT NULL DEFAULT 'system'");
    if (!colNames.includes('entity_type')) execute('ALTER TABLE notifications ADD COLUMN entity_type TEXT');
    if (!colNames.includes('entity_id')) execute('ALTER TABLE notifications ADD COLUMN entity_id TEXT');
    if (!colNames.includes('link')) execute('ALTER TABLE notifications ADD COLUMN link TEXT');
  } catch (e) {
    // Migration check non-critical
  }

  // Safe migrations for accounts/products/payment methods.
  try {
    const userCols = queryAll<{ name: string }>('PRAGMA table_info(users)').map(c => c.name);
    if (!userCols.includes('google_id')) execute('ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE');
    const productCols = queryAll<{ name: string }>('PRAGMA table_info(products)').map(c => c.name);
    if (!productCols.includes('search_tags')) execute("ALTER TABLE products ADD COLUMN search_tags TEXT DEFAULT ''");
  } catch {}

  execute(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      order_updates INTEGER DEFAULT 1,
      payment_updates INTEGER DEFAULT 1,
      delivery_updates INTEGER DEFAULT 1,
      review_updates INTEGER DEFAULT 1,
      promotional_updates INTEGER DEFAULT 0,
      restock_updates INTEGER DEFAULT 1,
      push_enabled INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  execute(`
    CREATE TABLE IF NOT EXISTS product_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, client_id)
    );
  `);

  // Secure admin initialization from environment variables (No hard-coded passwords)
  const envEmail = (process.env.ADMIN_EMAIL || '').trim();
  const envPassword = (process.env.ADMIN_PASSWORD || '').trim();
  const adminCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM admins');
  if (envEmail && envPassword) {
    const existingAdmin = queryOne<{ id:number }>('SELECT id FROM admins ORDER BY id ASC LIMIT 1');
    const salt = bcrypt.genSaltSync(12);
    const hash = bcrypt.hashSync(envPassword, salt);
    if (existingAdmin) {
      execute('UPDATE admins SET email = ?, password_hash = ?, full_name = ?, role = ? WHERE id = ?', [envEmail, hash, 'Store Administrator', 'super_admin', existingAdmin.id]);
    } else {
      execute('INSERT INTO admins (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)', [envEmail, hash, 'Store Administrator', 'super_admin']);
    }
    console.log(`[AUTH] Administrator account ready for: ${envEmail}`);
  } else if ((!adminCount || adminCount.count === 0) && process.env.NODE_ENV === 'production') {
    console.error('[CONFIG ERROR] Set ADMIN_EMAIL and ADMIN_PASSWORD in the deployment environment.');
  }

  // Seed settings if not present (Authoritative central source of public business info)
  const settingsCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM settings');
  if (!settingsCount || settingsCount.count === 0) {
    const defaultSettings = [
      { key: 'store_name', value: 'Mira Sport', description: 'Store brand name' },
      { key: 'store_tagline', value: 'Football Jerseys, Kits & Custom Printing', description: 'Store tagline' },
      { key: 'store_email', value: '', description: 'Contact email' },
      { key: 'store_phone', value: '', description: 'Store hotline' },
      { key: 'store_address', value: '', description: 'Store physical address' },
      { key: 'city', value: '', description: 'City' },
      { key: 'country', value: 'Ethiopia', description: 'Country' },
      { key: 'currency_code', value: 'ETB', description: 'Currency code' },
      { key: 'currency_symbol', value: 'ETB', description: 'Currency symbol' },
      { key: 'business_hours', value: '', description: 'Store hours' },
      { key: 'delivery_info', value: '', description: 'Delivery overview' },
      { key: 'return_policy', value: '', description: 'Return and exchange policy' },
      { key: 'footer_description', value: 'Authentic club, national team, and retro classic football jerseys in Ethiopia. High precision custom heat-press player names and numbers with nationwide delivery.', description: 'Footer brand overview' },
      { key: 'copyright_text', value: 'All rights reserved. Dedicated to authentic football culture.', description: 'Copyright text' },
      { key: 'social_facebook', value: '', description: 'Facebook page URL' },
      { key: 'social_instagram', value: '', description: 'Instagram handle URL' },
      { key: 'social_tiktok', value: '', description: 'TikTok profile URL' },
      { key: 'social_telegram', value: '', description: 'Telegram channel or support bot' },
      { key: 'social_whatsapp', value: '', description: 'WhatsApp direct business link' },
      { key: 'cbe_account_number', value: '', description: 'Commercial Bank of Ethiopia account number' },
      { key: 'cbe_account_name', value: '', description: 'CBE account holder name' },
      { key: 'cbe_instructions', value: '', description: 'CBE payment guidance' },
      { key: 'abyssinia_account_number', value: '', description: 'Bank of Abyssinia account number' },
      { key: 'abyssinia_account_name', value: '', description: 'Abyssinia account holder name' },
      { key: 'abyssinia_instructions', value: '', description: 'Abyssinia payment guidance' },
      { key: 'telebirr_phone', value: '', description: 'Telebirr merchant or phone number' },
      { key: 'telebirr_account_name', value: '', description: 'Telebirr recipient name' },
      { key: 'telebirr_instructions', value: '', description: 'Telebirr payment guidance' }
    ];

    for (const s of defaultSettings) {
      execute(`INSERT OR REPLACE INTO settings (key, value, description) VALUES (?, ?, ?)`, [s.key, s.value, s.description]);
    }
  }

  const paymentMethodCount = queryOne<{ count:number }>('SELECT COUNT(*) as count FROM payment_methods');
  if (!paymentMethodCount || paymentMethodCount.count === 0) {
    const defaults = [
      ['Commercial Bank of Ethiopia (CBE)', '','', '', 1, 1],
      ['Bank of Abyssinia', '','', '', 1, 2],
      ['Telebirr Mobile Money', '','', '', 1, 3]
    ];
    for (const item of defaults) execute('INSERT INTO payment_methods (name, account_name, account_number, instructions, is_active, display_order) VALUES (?, ?, ?, ?, ?, ?)', item);
  }

  // Seed shipping methods if not present
  const shippingCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM shipping_methods');
  if (!shippingCount || shippingCount.count === 0) {
    execute(`INSERT INTO shipping_methods (name, code, price, estimated_days, is_active) VALUES (?, ?, ?, ?, ?)`,
      ['Standard Delivery (Addis Ababa)', 'ADDIS_STD', 150.0, '2 - 3 business days', 1]);
    execute(`INSERT INTO shipping_methods (name, code, price, estimated_days, is_active) VALUES (?, ?, ?, ?, ?)`,
      ['Express Courier (Same Day / Next Day)', 'ADDIS_EXP', 300.0, 'Within 24 hours', 1]);
    execute(`INSERT INTO shipping_methods (name, code, price, estimated_days, is_active) VALUES (?, ?, ?, ?, ?)`,
      ['Regional Ethiopian Delivery (Post/EMS)', 'REGIONAL', 400.0, '3 - 5 business days', 1]);
  }

  // Seed categories if not present
  const catCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM categories');
  if (!catCount || catCount.count === 0) {
    execute(`INSERT INTO categories (name, slug, description, image_url, display_order) VALUES (?, ?, ?, ?, ?)`,
      ['Club Kits', 'club-kits', 'Top European and global club home, away, and third kits', '', 1]);
    execute(`INSERT INTO categories (name, slug, description, image_url, display_order) VALUES (?, ?, ?, ?, ?)`,
      ['National Teams', 'national-teams', 'World Cup and continental tournament national team jerseys', '', 2]);
    execute(`INSERT INTO categories (name, slug, description, image_url, display_order) VALUES (?, ?, ?, ?, ?)`,
      ['Retro Classics', 'retro-classics', 'Iconic vintage football kits from legendary eras', '', 3]);
    execute(`INSERT INTO categories (name, slug, description, image_url, display_order) VALUES (?, ?, ?, ?, ?)`,
      ['Kids Kits', 'kids-kits', 'Complete full jersey and short sets for youth and infants', '', 4]);
    execute(`INSERT INTO categories (name, slug, description, image_url, display_order) VALUES (?, ?, ?, ?, ?)`,
      ['Training & Warmup', 'training-warmup', 'Drill tops, pre-match warmups, and training jackets', '', 5]);
  }

  // Seed Banners if not present
  const bannerCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM banners');
  if (!bannerCount || bannerCount.count === 0) {
    execute(`INSERT INTO banners (title, subtitle, image_url, cta_text, cta_link, is_active, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['2024/25 Season Kits Have Landed', 'Official club and national team kits with premium custom name & number printing.', '/uploads/banners/banners-1791051663760-910233332.jpg', 'Explore 24/25 Kits', '/shop.html?season=2024%2F25', 1, 1]);
    execute(`INSERT INTO banners (title, subtitle, image_url, cta_text, cta_link, is_active, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Authentic Vintage Classics', 'Relive the greatest football memories with high-grade retro replica jerseys.', '/uploads/banners/banners-1791092288175-634364107.jpg', 'Browse Retro', '/shop.html?category=retro-classics', 1, 2]);
  }

  // Seed initial authentic jerseys if not present
  const productCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM products');
  if (!productCount || productCount.count === 0) {
    const clubCat = queryOne<{ id: number }>('SELECT id FROM categories WHERE slug = ?', ['club-kits']);
    const natCat = queryOne<{ id: number }>('SELECT id FROM categories WHERE slug = ?', ['national-teams']);
    const retroCat = queryOne<{ id: number }>('SELECT id FROM categories WHERE slug = ?', ['retro-classics']);
    const kidsCat = queryOne<{ id: number }>('SELECT id FROM categories WHERE slug = ?', ['kids-kits']);
    const trainCat = queryOne<{ id: number }>('SELECT id FROM categories WHERE slug = ?', ['training-warmup']);

    const seedProducts = [
      {
        name: 'Arsenal 2024/25 Home Kit',
        slug: 'arsenal-24-25-home-kit',
        team: 'Arsenal FC',
        league: 'Premier League',
        season: '2024/25',
        category_id: clubCat?.id || 1,
        description: 'The Arsenal 2024/25 Home Jersey features the iconic cannon emblem in place of the standard crest for the first time in over three decades. Engineered with breathable AEROREADY fabric and subtle collegiate navy accents framing the signature scarlet red and white sleeves.',
        features: 'Official Arsenal Cannon crest\nMoisture-absorbing AEROREADY technology\nRibbed crewneck with ergonomic seam placement\nSide mesh ventilation panels\nRegular athletic fit',
        material: '100% Recycled Polyester Doubleknit',
        price: 2600.0,
        old_price: 2950.0,
        is_customizable: 1,
        customization_price: 300.0,
        is_featured: 1,
        is_new: 1,
        primary_image: '/uploads/products/product-placeholder.jpg',
        extra_images: ['/uploads/products/product-placeholder.jpg', '/uploads/products/product-placeholder.jpg'],
        variants: [
          { name: 'Home', type: 'Kit Type' },
          { name: 'Fan Version', type: 'Edition' },
          { name: 'Player Version', type: 'Edition' }
        ],
        sizes: [
          { size: 'S', stock: 15 },
          { size: 'M', stock: 22 },
          { size: 'L', stock: 18 },
          { size: 'XL', stock: 12 },
          { size: 'XXL', stock: 6 },
          { size: 'XXXL', stock: 0 }
        ]
      },
      {
        name: 'Real Madrid 2024/25 Home Kit',
        slug: 'real-madrid-24-25-home-kit',
        team: 'Real Madrid',
        league: 'La Liga',
        season: '2024/25',
        category_id: clubCat?.id || 1,
        description: 'Dressed in classic all-white with a bespoke houndstooth pattern woven directly into the fabric, the 2024/25 Real Madrid kit embodies royal sophistication. Complete with heat-applied crest and black shoulder stripes.',
        features: 'Subtle woven houndstooth jacquard finish\nEmbroidered club crest & sponsor details\nHeat-regulating moisture management\nReinforced stretch cuffs',
        material: '100% Recycled Polyester Jacquard',
        price: 2750.0,
        old_price: 3100.0,
        is_customizable: 1,
        customization_price: 300.0,
        is_featured: 1,
        is_new: 1,
        primary_image: '/uploads/products/product-placeholder.jpg',
        extra_images: ['/uploads/products/product-placeholder.jpg'],
        variants: [
          { name: 'Home', type: 'Kit Type' },
          { name: 'Fan Version', type: 'Edition' },
          { name: 'Player Version', type: 'Edition' }
        ],
        sizes: [
          { size: 'XS', stock: 4 },
          { size: 'S', stock: 10 },
          { size: 'M', stock: 25 },
          { size: 'L', stock: 20 },
          { size: 'XL', stock: 14 },
          { size: 'XXL', stock: 8 }
        ]
      },
      {
        name: 'Manchester City 2024/25 Away Kit',
        slug: 'man-city-24-25-away-kit',
        team: 'Manchester City',
        league: 'Premier League',
        season: '2024/25',
        category_id: clubCat?.id || 1,
        description: 'Tribute to the historic 1999 Division Two play-off triumph at Wembley. Featuring iconic navy and electric neon yellow vertical stripes with polo collar styling and modern ULTRAWEAVE performance.',
        features: 'Retro-inspired navy & neon yellow vertical striping\nPolo collar with concealed placket\nLightweight ULTRAWEAVE aerodynamic fabric\nOfficial Premier League sleeve patch option',
        material: '100% High Performance Polyester',
        price: 2550.0,
        old_price: null,
        is_customizable: 1,
        customization_price: 300.0,
        is_featured: 1,
        is_new: 1,
        primary_image: '/uploads/products/product-placeholder.jpg',
        extra_images: ['/uploads/products/product-placeholder.jpg'],
        variants: [
          { name: 'Away', type: 'Kit Type' },
          { name: 'Short Sleeve', type: 'Sleeve' },
          { name: 'Long Sleeve', type: 'Sleeve' }
        ],
        sizes: [
          { size: 'S', stock: 8 },
          { size: 'M', stock: 14 },
          { size: 'L', stock: 12 },
          { size: 'XL', stock: 6 },
          { size: 'XXL', stock: 3 }
        ]
      },
      {
        name: 'Barcelona 2024/25 125th Anniversary Home Kit',
        slug: 'barcelona-24-25-anniversary-home-kit',
        team: 'FC Barcelona',
        league: 'La Liga',
        season: '2024/25',
        category_id: clubCat?.id || 1,
        description: 'Celebrating 125 years of Blaugrana greatness with a legendary half-and-half design recalling the first shirt from 1899 and the golden 1999 centenary jersey. Gold Spotify logo and centered crest.',
        features: 'Classic half blau, half grana commemorative split\nCentered historic crest and gold emblem\nDri-FIT ADV micro-knit technology\nInterior commemorative 125 Years anniversary neck graphic',
        material: '100% Sustainable Dri-FIT Polyester',
        price: 2700.0,
        old_price: 3000.0,
        is_customizable: 1,
        customization_price: 300.0,
        is_featured: 1,
        is_new: 1,
        primary_image: '/uploads/products/product-placeholder.jpg',
        extra_images: ['/uploads/products/product-placeholder.jpg'],
        variants: [
          { name: 'Home', type: 'Kit Type' },
          { name: 'Fan Version', type: 'Edition' },
          { name: 'Player Version', type: 'Edition' }
        ],
        sizes: [
          { size: 'S', stock: 12 },
          { size: 'M', stock: 18 },
          { size: 'L', stock: 15 },
          { size: 'XL', stock: 10 },
          { size: 'XXL', stock: 5 }
        ]
      },
      {
        name: 'Argentina 2024 Copa America Winners Kit',
        slug: 'argentina-2024-copa-america-kit',
        team: 'Argentina',
        league: 'CONMEBOL / National',
        season: '2024',
        category_id: natCat?.id || 2,
        description: 'The jersey worn by the world champions as they conquered Copa America 2024. Features iconic sky blue and white vertical stripes adorned with glittering golden details, 3 championship stars, and the central FIFA World Champions badge.',
        features: 'Golden 3-Stars AFA crest\nOfficial FIFA World Champions 2022 central badge\nSun of May graphic on the upper neck\nAEROREADY moisture management',
        material: '100% Recycled Polyester Tricot',
        price: 2850.0,
        old_price: 3200.0,
        is_customizable: 1,
        customization_price: 300.0,
        is_featured: 1,
        is_new: 0,
        primary_image: '/uploads/products/product-placeholder.jpg',
        extra_images: ['/uploads/products/product-placeholder.jpg'],
        variants: [
          { name: 'Home', type: 'Kit Type' },
          { name: 'Fan Version', type: 'Edition' },
          { name: 'Player Version', type: 'Edition' }
        ],
        sizes: [
          { size: 'S', stock: 14 },
          { size: 'M', stock: 24 },
          { size: 'L', stock: 20 },
          { size: 'XL', stock: 12 },
          { size: 'XXL', stock: 4 }
        ]
      },
      {
        name: 'Brazil 2024 National Home Kit',
        slug: 'brazil-2024-national-home-kit',
        team: 'Brazil',
        league: 'CONMEBOL / National',
        season: '2024',
        category_id: natCat?.id || 2,
        description: 'The Selecao return with their radiant Canary Yellow jersey featuring an intricate embossed all-over texture honoring Brazilian music, flora, fauna, and indigenous culture. Central CBF crest with five stars.',
        features: 'Vibrant Canary Yellow with textured tapestry pattern\nCentered CBF crest with 5 World Cup stars\nInterior collar script: "Brasil Para Todos"\nDri-FIT sweat-wicking fabrication',
        material: '100% Recycled Micro-Polyester',
        price: 2650.0,
        old_price: null,
        is_customizable: 1,
        customization_price: 300.0,
        is_featured: 0,
        is_new: 1,
        primary_image: '/uploads/products/product-placeholder.jpg',
        extra_images: ['/uploads/products/product-placeholder.jpg'],
        variants: [
          { name: 'Home', type: 'Kit Type' },
          { name: 'Fan Version', type: 'Edition' }
        ],
        sizes: [
          { size: 'S', stock: 7 },
          { size: 'M', stock: 16 },
          { size: 'L', stock: 14 },
          { size: 'XL', stock: 8 },
          { size: 'XXL', stock: 2 }
        ]
      },
      {
        name: 'AC Milan 1996/97 Retro Away Jersey (Baggio #18 Era)',
        slug: 'ac-milan-96-97-retro-away',
        team: 'AC Milan',
        league: 'Serie A',
        season: '1996/97',
        category_id: retroCat?.id || 3,
        description: 'Immortal white away jersey as donned by Roberto Baggio, George Weah, and Franco Baresi. Features the timeless Opel sponsor, polo neck collar with rossoneri red and black tricolor trims, and tonal watermarked club crests.',
        features: 'Classic 90s oversized polo collar and v-neck\nVintage flock Opel sponsor and embroidered Lotto logo\nTonal woven devil and badge watermark pattern\nPremium collector edition heavyweight polyester',
        material: '100% Vintage-spec Heavyweight Polyester',
        price: 3200.0,
        old_price: 3600.0,
        is_customizable: 1,
        customization_price: 350.0,
        is_featured: 1,
        is_new: 0,
        primary_image: '/uploads/products/product-placeholder.jpg',
        extra_images: ['/uploads/products/product-placeholder.jpg'],
        variants: [
          { name: 'Away (White)', type: 'Kit Type' },
          { name: 'Short Sleeve', type: 'Sleeve' },
          { name: 'Long Sleeve', type: 'Sleeve' }
        ],
        sizes: [
          { size: 'S', stock: 5 },
          { size: 'M', stock: 12 },
          { size: 'L', stock: 15 },
          { size: 'XL', stock: 9 },
          { size: 'XXL', stock: 3 }
        ]
      },
      {
        name: 'Arsenal 2024/25 Kids Home Kit Set',
        slug: 'arsenal-24-25-kids-home-kit-set',
        team: 'Arsenal FC',
        league: 'Premier League',
        season: '2024/25',
        category_id: kidsCat?.id || 4,
        description: 'Complete 2-piece set containing the official 2024/25 Arsenal Home jersey and matching white athletic shorts with elasticated waistband. Designed for optimal youth comfort during play.',
        features: 'Includes official match shirt and matching shorts\nElastic waistband on shorts with interior drawcord\nSoft lightweight fabric engineered for all-day active wear\nEasy-care machine washable',
        material: '100% Breathable Youth-Grade Polyester',
        price: 2100.0,
        old_price: 2400.0,
        is_customizable: 1,
        customization_price: 250.0,
        is_featured: 0,
        is_new: 1,
        primary_image: '/uploads/products/product-placeholder.jpg',
        extra_images: ['/uploads/products/product-placeholder.jpg'],
        variants: [
          { name: 'Full Kit (Shirt + Shorts)', type: 'Package' }
        ],
        sizes: [
          { size: 'XS (Age 5-6)', stock: 10 },
          { size: 'S (Age 7-8)', stock: 15 },
          { size: 'M (Age 9-10)', stock: 18 },
          { size: 'L (Age 11-12)', stock: 12 },
          { size: 'XL (Age 13-14)', stock: 8 }
        ]
      },
      {
        name: 'Real Madrid 2024/25 Pre-Match Warmup Top',
        slug: 'real-madrid-24-25-training-top',
        team: 'Real Madrid',
        league: 'La Liga',
        season: '2024/25',
        category_id: trainCat?.id || 5,
        description: 'Worn by the Los Blancos squad during intensive training sessions and pre-match stadium warmups. Sleek charcoal base with houndstooth gradient patterns and orange high-visibility accents.',
        features: 'Slim aerodynamic athletic cut\nQuarter-zip mock neck with protective chin guard\nThumbholes at cuffs to keep sleeves anchored\nAEROREADY sweat-wicking yarn',
        material: '88% Recycled Polyester, 12% Elastane French Terry',
        price: 2300.0,
        old_price: null,
        is_customizable: 0,
        customization_price: 0,
        is_featured: 0,
        is_new: 1,
        primary_image: '/uploads/products/product-placeholder.jpg',
        extra_images: ['/uploads/products/product-placeholder.jpg'],
        variants: [
          { name: 'Charcoal & Orange', type: 'Colorway' },
          { name: 'Long Sleeve Drill Top', type: 'Style' }
        ],
        sizes: [
          { size: 'S', stock: 6 },
          { size: 'M', stock: 14 },
          { size: 'L', stock: 12 },
          { size: 'XL', stock: 7 },
          { size: 'XXL', stock: 0 }
        ]
      },
      {
        name: 'Inter Milan 2024/25 Two Stars Home Jersey',
        slug: 'inter-milan-24-25-home-kit',
        team: 'Inter Milan',
        league: 'Serie A',
        season: '2024/25',
        category_id: clubCat?.id || 1,
        description: 'A historic milestone: the first ever Inter Milan jersey sporting the prestigious Second Star for their 20th Scudetto title. Bold modern interpretation fusing classic vertical stripes with avant-garde diagonal stripes.',
        features: 'Two gold embroidered stars above the new monochrome crest\nScudetto shield badge placed prominently on chest\nDynamic vertical & diagonal stripe architectural fusion\nDri-FIT performance ventilation',
        material: '100% Recycled Polyester',
        price: 2650.0,
        old_price: 2950.0,
        is_customizable: 1,
        customization_price: 300.0,
        is_featured: 1,
        is_new: 1,
        primary_image: '/uploads/products/product-placeholder.jpg',
        extra_images: ['/uploads/products/product-placeholder.jpg'],
        variants: [
          { name: 'Home', type: 'Kit Type' },
          { name: 'Fan Version', type: 'Edition' },
          { name: 'Player Version', type: 'Edition' }
        ],
        sizes: [
          { size: 'S', stock: 9 },
          { size: 'M', stock: 18 },
          { size: 'L', stock: 16 },
          { size: 'XL', stock: 11 },
          { size: 'XXL', stock: 4 }
        ]
      }
    ];

    for (const p of seedProducts) {
      const res = execute(
        `INSERT INTO products (name, slug, team, league, season, category_id, description, features, material, price, old_price, is_customizable, customization_price, is_featured, is_new, likes_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.name, p.slug, p.team, p.league, p.season, p.category_id, p.description, p.features, p.material, p.price, p.old_price, p.is_customizable, p.customization_price, p.is_featured, p.is_new, 0]
      );
      const prodId = res.lastInsertRowid;

      // Primary image
      execute(`INSERT INTO product_images (product_id, image_url, is_primary, display_order) VALUES (?, ?, 1, 0)`, [prodId, p.primary_image]);
      // Extra images
      let order = 1;
      for (const img of p.extra_images) {
        execute(`INSERT INTO product_images (product_id, image_url, is_primary, display_order) VALUES (?, ?, 0, ?)`, [prodId, img, order++]);
      }

      // Variants
      for (const v of p.variants) {
        execute(`INSERT INTO product_variants (product_id, name, type) VALUES (?, ?, ?)`, [prodId, v.name, v.type]);
      }

      // Sizes and inventory
      for (const s of p.sizes) {
        execute(`INSERT INTO product_sizes (product_id, size, is_available) VALUES (?, ?, ?)`, [prodId, s.size, s.stock > 0 ? 1 : 0]);
        // Inventory for default variant
        execute(`INSERT INTO inventory (product_id, size, variant_name, stock_quantity) VALUES (?, ?, ?, ?)`, [prodId, s.size, p.variants[0]?.name || 'Standard', s.stock]);
      }
    }
  }

  // Migrate legacy generated jersey/category SVG references out of the live catalog.
  try {
    const replacementImages = [
      '/uploads/products/products-1791051190994-742207281.jpg',
      '/uploads/products/products-1791051293954-730143189.jpg',
      '/uploads/products/products-1791051418698-598999528.jpg',
      '/uploads/products/products-1791051320221-308910572.jpg',
      '/uploads/products/products-1791051418696-925956714.jpg'
    ];
    const legacy = queryAll<{id:number; product_id:number}>('SELECT id, product_id FROM product_images WHERE LOWER(image_url) LIKE \'%.svg\'');
    for (const row of legacy) {
      const existingCount = queryOne<{count:number}>('SELECT COUNT(*) as count FROM product_images WHERE product_id = ? AND LOWER(image_url) NOT LIKE \'%.svg\'', [row.product_id])?.count || 0;
      execute('DELETE FROM product_images WHERE id = ?', [row.id]);
      if (existingCount === 0) {
        const idx = (Number(row.product_id) - 1) % replacementImages.length;
        execute('INSERT INTO product_images (product_id, image_url, is_primary, display_order) VALUES (?, ?, 1, 0)', [row.product_id, replacementImages[idx]]);
      }
    }
    execute("UPDATE categories SET image_url = '' WHERE LOWER(COALESCE(image_url,'')) LIKE '%.svg'");
    execute("UPDATE banners SET image_url = '/uploads/banners/banners-1791051663760-910233332.jpg' WHERE LOWER(image_url) LIKE '%.svg'");
  } catch {}

  saveDb();
}
