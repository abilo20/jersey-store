import { Router, Request, Response } from 'express';
import { queryAll } from '../database/db.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const methods = queryAll('SELECT * FROM shipping_methods WHERE is_active = 1 ORDER BY price ASC');
  res.json({ success: true, methods });
});

export default router;
