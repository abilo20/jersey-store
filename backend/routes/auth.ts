import { Router, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { queryOne, queryAll, execute } from '../database/db.js';
import { generateToken } from '../utils/jwt.js';
import { authCustomer, AuthenticatedRequest } from '../middleware/auth.js';
import { notifyAdmins } from '../services/notificationService.js';

const router = Router();

// Register customer
router.post('/register', async (req, res: Response) => {
  try {
    const { full_name, email, password, phone } = req.body;

    if (!full_name || !email || !password) {
      res.status(400).json({ success: false, message: 'Full name, email, and password are required' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ success: false, message: 'Please provide a valid email address' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
      return;
    }

    const existing = queryOne('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (existing) {
      res.status(409).json({ success: false, message: 'An account with this email already exists' });
      return;
    }

    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);

    const result = execute(
      'INSERT INTO users (full_name, email, password_hash, phone) VALUES (?, ?, ?, ?)',
      [full_name.trim(), email.trim().toLowerCase(), password_hash, phone ? phone.trim() : null]
    );

    const token = generateToken({
      id: result.lastInsertRowid,
      email: email.trim().toLowerCase(),
      type: 'customer'
    });

    await notifyAdmins({
      type: 'customer', title: 'New Customer Account',
      message: `${full_name.trim()} created a Mira Sport account.`,
      entityType: 'customer', entityId: String(result.lastInsertRowid), link: `/admin/customers.html`
    });

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        id: result.lastInsertRowid,
        full_name: full_name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone ? phone.trim() : null
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Server error during registration: ' + err.message });
  }
});

// Login customer
router.post('/login', (req, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required' });
      return;
    }

    const user = queryOne<{ id: number; full_name: string; email: string; password_hash: string; phone: string }>(
      'SELECT id, full_name, email, password_hash, phone FROM users WHERE LOWER(email) = LOWER(?)',
      [email.trim()]
    );

    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      type: 'customer'
    });

    res.json({
      success: true,
      message: 'Logged in successfully',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Server error during login: ' + err.message });
  }
});

// Google OAuth login. Add GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET in .env to enable it.
router.get('/google', (req, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const redirect = process.env.GOOGLE_REDIRECT_URI?.trim() || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  if (!clientId) { res.status(503).send('Google sign-in is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.'); return; }
  const params = new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:'openid email profile',access_type:'offline',prompt:'select_account'});
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async (req, res: Response) => {
  try {
    const code = String(req.query.code || '');
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const redirect = process.env.GOOGLE_REDIRECT_URI?.trim() || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
    if (!code || !clientId || !clientSecret) { res.redirect('/login.html?google=error'); return; }
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirect,grant_type:'authorization_code'})});
    const tokenData:any = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) throw new Error('Google token exchange failed');
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {headers:{Authorization:`Bearer ${tokenData.access_token}`}});
    const profile:any = await profileRes.json();
    if (!profileRes.ok || !profile.email) throw new Error('Google profile lookup failed');
    let user:any = queryOne('SELECT id,full_name,email,password_hash,phone,google_id FROM users WHERE LOWER(email)=LOWER(?) OR google_id=?',[profile.email, profile.sub]);
    if (!user) {
      const randomHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
      const r=execute('INSERT INTO users (full_name,email,password_hash,google_id) VALUES (?,?,?,?)',[profile.name || profile.email.split('@')[0], profile.email.toLowerCase(), randomHash, profile.sub]);
      user={id:r.lastInsertRowid,full_name:profile.name || profile.email.split('@')[0],email:profile.email.toLowerCase(),password_hash:randomHash,phone:null,google_id:profile.sub};
      await notifyAdmins({type:'customer',title:'New Google Customer Account',message:`${user.full_name} created an account with Google.`,entityType:'customer',entityId:String(user.id),link:'/admin/customers.html'});
    } else if (!user.google_id) { execute('UPDATE users SET google_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',[profile.sub,user.id]); }
    const token=generateToken({id:user.id,email:user.email,type:'customer'});
    res.redirect(`/login.html?google_token=${encodeURIComponent(token)}&google_name=${encodeURIComponent(user.full_name)}`);
  } catch (err) { res.redirect('/login.html?google=error'); }
});

// Get current profile
router.get('/me', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const ordersCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM orders WHERE user_id = ?', [user.id]);
  const wishlistCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM wishlists WHERE user_id = ?', [user.id]);
  const unreadNotifs = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [user.id]);

  res.json({
    success: true,
    user: {
      ...user,
      total_orders: ordersCount?.count || 0,
      total_favorites: wishlistCount?.count || 0,
      total_wishlist: wishlistCount?.count || 0,
      unread_notifications: unreadNotifs?.count || 0
    }
  });
});

// Update profile
router.put('/profile', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { full_name, phone } = req.body;
    if (!full_name) {
      res.status(400).json({ success: false, message: 'Full name is required' });
      return;
    }

    execute('UPDATE users SET full_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
      full_name.trim(),
      phone ? phone.trim() : null,
      req.user!.id
    ]);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: req.user!.id,
        email: req.user!.email,
        full_name: full_name.trim(),
        phone: phone ? phone.trim() : null
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error updating profile: ' + err.message });
  }
});

// Change password
router.put('/password', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      res.status(400).json({ success: false, message: 'Current and new password are required' });
      return;
    }

    if (new_password.length < 6) {
      res.status(400).json({ success: false, message: 'New password must be at least 6 characters long' });
      return;
    }

    const user = queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [req.user!.id]);
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      res.status(400).json({ success: false, message: 'Current password is incorrect' });
      return;
    }

    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(new_password, salt);

    execute('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newHash, req.user!.id]);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error changing password: ' + err.message });
  }
});

// Address book
router.get('/addresses', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  const addresses = queryAll('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', [req.user!.id]);
  res.json({ success: true, addresses });
});

router.post('/addresses', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { label, recipient_name, phone, region, city, sub_city, woreda, street_address, is_default } = req.body;
    if (!recipient_name || !phone || !region || !city || !street_address) {
      res.status(400).json({ success: false, message: 'Recipient name, phone, region, city, and street address are required' });
      return;
    }

    if (is_default) {
      execute('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [req.user!.id]);
    }

    const resDb = execute(
      `INSERT INTO addresses (user_id, label, recipient_name, phone, region, city, sub_city, woreda, street_address, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user!.id, label || 'Home', recipient_name, phone, region, city, sub_city || '', woreda || '', street_address, is_default ? 1 : 0]
    );

    res.status(201).json({ success: true, message: 'Address saved', id: resDb.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Error saving address: ' + err.message });
  }
});

router.delete('/addresses/:id', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  execute('DELETE FROM addresses WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  res.json({ success: true, message: 'Address removed' });
});

// Notifications
router.get('/notifications', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  const notifications = queryAll('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', [req.user!.id]);
  res.json({ success: true, notifications });
});

router.post('/notifications/:id/read', authCustomer, (req: AuthenticatedRequest, res: Response) => {
  execute('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  res.json({ success: true });
});

export default router;
