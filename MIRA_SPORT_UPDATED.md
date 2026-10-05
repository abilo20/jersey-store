# Mira Sport Updated

## Admin login
Username: `Abilo@admin`
Password: `Ab1221`

## Run locally
1. Open this project folder in PowerShell.
2. Run `npm install` (do not copy `node_modules` from another operating system).
3. Run `npm run dev`.
4. Open `http://localhost:3000`.
5. Admin: `http://localhost:3000/admin/login.html`.

## Google sign-in
Google sign-in is wired into the customer login flow. Add these values to `.env` after creating a Google OAuth web application:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_URL` (for local development: `http://localhost:3000`)

The Google OAuth redirect URI must be:
`http://localhost:3000/api/auth/google/callback`

## Product images
- Admin product upload accepts JPG, JPEG, PNG and WebP.
- New products require 2-5 real images.
- Storefront product queries exclude products that do not have a real uploaded image.
- Generated SVG jersey images are not used.

## Homepage promotions
Admin can create a maximum of 2 promotions. Each promotion requires a real uploaded image and can have its own title/note, description, CTA text and link.

## Payment methods
Admin > Payments contains a separate payment-method manager. Add, edit, activate/deactivate, or delete any number of payment methods. Active methods appear dynamically at checkout.

## Search tags
Admin product tags accept values such as `#barca, #mancity, #arsenal`. Customers can search those terms and matching products are returned.
