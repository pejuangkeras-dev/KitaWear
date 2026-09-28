# KitaWear

KitaWear online store with Netlify Functions and Midtrans payment integration.

## Structure

- `index.html` — storefront, cart, checkout, product lightbox
- `netlify.toml` — tells Netlify to use `netlify/functions`
- `netlify/functions/config.mjs` — exposes safe Midtrans client configuration
- `netlify/functions/create-transaction.mjs` — creates Midtrans Snap transactions
- `netlify/functions/midtrans-notification.mjs` — receives Midtrans notifications

## Important

Do **not** put Midtrans Server Key in this repository. Keep these values in Netlify Environment Variables:

- `MIDTRANS_CLIENT_KEY`
- `MIDTRANS_SERVER_KEY`
- `MIDTRANS_IS_PRODUCTION` = `false` for Sandbox

The Netlify Functions directory is `netlify/functions`.
Cloudflare config update
