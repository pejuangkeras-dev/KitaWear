-- P16: prevent concurrent checkout/address events from creating duplicate active shipping quotes.
alter table public.shipping_quotes
  add column if not exists request_hash text;

create index if not exists shipping_quotes_request_hash_idx
  on public.shipping_quotes(buyer_id, request_hash, status, expires_at);

create unique index if not exists shipping_quotes_active_request_unique_idx
  on public.shipping_quotes(buyer_id, request_hash)
  where status = 'active' and request_hash is not null;
