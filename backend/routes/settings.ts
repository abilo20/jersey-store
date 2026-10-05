import { Router, Request, Response } from 'express';
import { queryAll } from '../database/db.js';

const router = Router();

router.get('/public', (_req: Request, res: Response) => {
  const rows = queryAll<{ key: string; value: string }>('SELECT key, value FROM settings');
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  res.json({
    success: true,
    settings: {
      store_name: settings.store_name || 'Mira Sport',
      store_tagline: settings.store_tagline || 'Authentic Football Kits',
      store_email: settings.store_email || '',
      store_phone: settings.store_phone || '',
      store_address: settings.store_address || '',
      currency_code: settings.currency_code || 'ETB',
      cbe: {
        account_number: settings.cbe_account_number || '',
        account_name: settings.cbe_account_name || '',
        instructions: settings.cbe_instructions || ''
      },
      abyssinia: {
        account_number: settings.abyssinia_account_number || '',
        account_name: settings.abyssinia_account_name || '',
        instructions: settings.abyssinia_instructions || ''
      },
      telebirr: {
        phone: settings.telebirr_phone || '',
        account_name: settings.telebirr_account_name || '',
        instructions: settings.telebirr_instructions || ''
      },
      payment_methods: queryAll('SELECT id,name,account_name,account_number,instructions,logo_url FROM payment_methods WHERE is_active=1 ORDER BY display_order ASC,id ASC')
    }
  });
});

export default router;
