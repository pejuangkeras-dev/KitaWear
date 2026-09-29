# KitaWear

KitaWear online marketplace running on **Cloudflare Pages + Cloudflare Pages Functions + Supabase + Midtrans**.

## Structure

- `index.html` — storefront, cart, checkout, product lightbox and buyer account
- `admin.html` — Supabase Auth protected Admin Center
- `seller.html` — Supabase Auth protected Seller Center
- `auth-guard.js` — shared Supabase Auth + role guard for protected pages
- `functions/api/*` — Cloudflare Pages Functions
- `marketplace_security.sql` — marketplace database/RLS security SQL

## Cloudflare environment variables

Public/runtime configuration:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (legacy compatible) or migrate the endpoint to a publishable key
- `MIDTRANS_CLIENT_KEY`
- `MIDTRANS_IS_PRODUCTION`

Server-only:
- `SUPABASE_SERVICE_ROLE_KEY`
- `MIDTRANS_SERVER_KEY`
- any reset/admin secret used by the API

Never expose server-only keys in HTML or client-side JavaScript.
