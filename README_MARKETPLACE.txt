KitaWear Marketplace — Cloudflare Edition

Runtime:
- Cloudflare Pages
- Cloudflare Pages Functions under /functions/api
- Supabase Auth + Postgres/RLS
- Midtrans Snap

Protected pages:
- /admin.html -> Supabase Auth + role=admin
- /seller.html -> Supabase Auth + role=seller/admin

Public APIs:
- /api/public-config
- /api/public-products
- /api/public-products-detail
- /api/reviews

Payment APIs:
- /api/create-transaction
- /api/midtrans-notification

Do not add Netlify configuration or Netlify Functions. Server secrets stay in Cloudflare environment variables.
