MarketKita Payment — Cloudflare Pages

Required Cloudflare environment variables:
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY (server only)
- MIDTRANS_CLIENT_KEY
- MIDTRANS_SERVER_KEY (server only)
- MIDTRANS_IS_PRODUCTION=true|false

Payment endpoint:
/api/create-transaction

Midtrans notification endpoint:
/api/midtrans-notification

Never place MIDTRANS_SERVER_KEY or SUPABASE_SERVICE_ROLE_KEY in HTML, browser JavaScript, or public configuration.
