# Mira Sport — Football Jersey Store

A deployment-oriented football jersey e-commerce application built with Node.js, Express, TypeScript, SQLite/sql.js, HTML, CSS and Vanilla JavaScript modules.

## Stack
- Node.js + Express + TypeScript
- SQLite via sql.js
- Vanilla HTML/CSS/JavaScript frontend
- JWT + bcrypt authentication
- WebSocket realtime events
- Web Push notifications with VAPID environment secrets

## Local setup
1. Install Node.js 20+ (22 LTS recommended).
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
5. For browser/system push, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Push remains disabled when VAPID variables are blank.
6. Run `npm run dev`.

## Production
- Use a strong random `JWT_SECRET`.
- Set the first administrator credentials only through deployment environment variables.
- Never put administrator or customer passwords in frontend files.
- Keep `VAPID_PRIVATE_KEY` private and out of the database/admin settings.
- Configure real store contact, payment, social, delivery and return information from the protected Admin Settings page before accepting live orders.
- Use HTTPS in production so browser Push API works reliably.

## Notifications
Customer and administrator notifications are persisted in SQLite, delivered over WebSocket when connected, and can be delivered as browser/system push notifications when VAPID is configured and the user/admin enables browser notifications. Notification history supports unread counts, mark-read and mark-all-read actions.
