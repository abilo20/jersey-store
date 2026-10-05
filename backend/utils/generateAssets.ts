import fs from 'fs';
import path from 'path';

/**
 * User-uploaded media is the only storefront product/promotion imagery.
 * This function intentionally creates directories only and never generates SVG jerseys/icons/banners.
 */
export function generateAllSeedAssets(): void {
  for (const folder of ['uploads/products', 'uploads/banners', 'uploads/reviews', 'uploads/payments', 'uploads/profiles']) {
    const dir = path.resolve(process.cwd(), folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
