import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'addis_football_jersey_secret_key_2026';

export interface TokenPayload {
  id: number;
  email: string;
  role?: string;
  type: 'customer' | 'admin';
}

export function generateToken(payload: TokenPayload, expiresIn: string = '7d'): string {
  return jwt.sign(payload as object, JWT_SECRET, { expiresIn: expiresIn as any });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (err) {
    return null;
  }
}
