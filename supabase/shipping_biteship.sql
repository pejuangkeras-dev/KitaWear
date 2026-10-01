-- MarketKita Shipping / Biteship foundation
-- Apply once to Supabase. Production deployment was also applied directly.

alter table public.products
  add column if not exists weight_gram integer not null default 500,
  add column if not exists length_cm numeric(10,2) not null default 20,
  add column if not exists width_cm numeric(10,2) not null default 15,
  add column if not exists height_cm numeric(10,2) not null default 5;

alter table public.stores
  add column if not exists pickup_name text,
  add column if not exists pickup_phone text,
  add column if not exists pickup_address text,
  add column if not exists pickup_city text,
  add column if not exists pickup_province text,
  add column if not exists pickup_postal_code text,
  add column if not exists pickup_latitude numeric(10,7),
  add column if not exists pickup_longitude numeric(10,7),
  add column if not exists pickup_note text;

alter table public.products
  add constraint products_shipping_dimensions_chk
  check (weight_gram > 0 and length_cm > 0 and width_cm > 0 and height_cm > 0);

alter table public.orders
  add column if not exists shipping_quote_id uuid references public.shipping_quotes(id),
  add column if not exists shipping_postal_code text,
  add column if not exists shipping_selections jsonb not null default '[]'::jsonb;

create table if not exists public.shipping_quotes (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete cascade,
  total_fee integer not null default 0,
  currency text not null default 'IDR',
  status text not null default 'active' check (status in ('active','used','expired')),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  selections jsonb not null default '[]'::jsonb,
  selected_selections jsonb not null default '[]'::jsonb,
  request_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists public.shipping_shipments (
  id uuid primary key default gen_random_uuid(),
  order_seller_id uuid not null unique references public.order_sellers(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'biteship',
  provider_order_id text,
  provider_tracking_id text,
  courier_company text,
  courier_type text,
  waybill_id text,
  status text not null default 'pending',
  shipping_fee integer not null default 0,
  tracking_url text,
  pickup_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_webhook_at timestamptz,
  raw_response jsonb not null default '{}'::jsonb
);

create index if not exists shipping_quotes_buyer_idx on public.shipping_quotes(buyer_id, created_at desc);
create index if not exists shipping_quotes_expiry_idx on public.shipping_quotes(status, expires_at);
create index if not exists shipping_shipments_order_idx on public.shipping_shipments(order_id);
create index if not exists shipping_shipments_waybill_idx on public.shipping_shipments(waybill_id);
create index if not exists shipping_shipments_provider_order_idx on public.shipping_shipments(provider_order_id);
create unique index if not exists orders_shipping_quote_unique_idx on public.orders(shipping_quote_id) where shipping_quote_id is not null;

alter table public.shipping_quotes enable row level security;
alter table public.shipping_shipments enable row level security;

drop policy if exists shipping_quotes_buyer_select on public.shipping_quotes;
create policy shipping_quotes_buyer_select on public.shipping_quotes for select to authenticated using (buyer_id = auth.uid());

drop policy if exists shipping_shipments_buyer_select on public.shipping_shipments;
create policy shipping_shipments_buyer_select on public.shipping_shipments for select to authenticated
using (exists (select 1 from public.orders o where o.id = shipping_shipments.order_id and o.buyer_id = auth.uid()));

drop policy if exists shipping_shipments_seller_select on public.shipping_shipments;
create policy shipping_shipments_seller_select on public.shipping_shipments for select to authenticated
using (exists (select 1 from public.order_sellers os where os.id = shipping_shipments.order_seller_id and os.seller_id = auth.uid()));

revoke all on public.shipping_quotes from anon;
revoke all on public.shipping_shipments from anon;
