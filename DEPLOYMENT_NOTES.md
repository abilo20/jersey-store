# Mira Sport – Updated Deployment Notes

This package was rebuilt from the original Mira Sport project and includes the requested store/admin changes.

## Admin login
- Username: `Abilo@admin`
- Password: `Ab1221`
- Admin URL: `/admin/login.html`

## Customer accounts
- Email/password registration and login are supported.
- Existing customer accounts remain in the SQLite database.
- Google sign-in is implemented. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the correct callback URI in `.env` to enable it.

## Important changes
- Product/jersey SVG artwork removed. Product photos are uploaded files only.
- New products require 2–5 uploaded images.
- Homepage categories are normal text buttons.
- Homepage supports a maximum of 2 active promotions. Each promotion has an admin-written title/description and uploaded image. Two promotions rotate every 8 seconds with a smooth transition.
- Favorites replace Wishlist in the customer-facing UI. Saved favorites turn yellow.
- Admin notifications show unread notifications and support marking individual/all notifications as read.
- Admin can add/edit/disable/delete additional payment methods.
- Admin product search tags support terms such as `#barca`, `#mancity`, `#messi`, etc. Customer search matches those tags.
- Newly created admin products are returned by the live product API and appear in shop/search/category views.
- Existing SQLite data was preserved and migrated away from legacy product/category/banner SVG references.

## Install and run
Do not copy the included `node_modules` from another operating system. This package intentionally excludes `node_modules`.

```bash
npm install
npm run dev
```

## Google OAuth callback
For local development:

`http://localhost:3000/api/auth/google/callback`

For production, use your real HTTPS domain and set the same callback URI in Google Cloud and `.env`.
