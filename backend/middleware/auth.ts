import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../utils/jwt.js';
import { queryOne } from '../database/db.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
    full_name: string;
    phone?: string;
  };
  admin?: {
    id: number;
    email: string;
    full_name: string;
    role: string;
  };
}

export function authCustomer(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload || payload.type !== 'customer') {
    res.status(401).json({ success: false, message: 'Invalid or expired session token' });
    return;
  }

  const user = queryOne<{ id: number; email: string; full_name: string; phone: string }>(
    'SELECT id, email, full_name, phone FROM users WHERE id = ?',
    [payload.id]
  );

  if (!user) {
    res.status(401).json({ success: false, message: 'User account not found' });
    return;
  }

  req.user = user;
  next();
}

export function optionalCustomer(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload && payload.type === 'customer') {
      const user = queryOne<{ id: number; email: string; full_name: string; phone: string }>(
        'SELECT id, email, full_name, phone FROM users WHERE id = ?',
        [payload.id]
      );
      if (user) req.user = user;
    }
  }
  next();
}

export function authAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Admin authentication required' });
    return;
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload || payload.type !== 'admin') {
    res.status(403).json({ success: false, message: 'Forbidden. Admin privileges required' });
    return;
  }

  const admin = queryOne<{ id: number; email: string; full_name: string; role: string }>(
    'SELECT id, email, full_name, role FROM admins WHERE id = ?',
    [payload.id]
  );

  if (!admin) {
    res.status(403).json({ success: false, message: 'Admin account not found' });
    return;
  }

  req.admin = admin;
  next();
}
