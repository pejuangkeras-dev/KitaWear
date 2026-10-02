create table if not exists public.checkout_idempotency (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  order_id uuid references public.orders(id) on delete set null,
  midtrans_order_id text,
  midtrans_token text,
  redirect_url text,
  status text not null default 'processing' check (status in ('processing','created','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_id,idempotency_key)
);

create index if not exists checkout_idempotency_order_idx on public.checkout_idempotency(order_id);
alter table public.checkout_idempotency enable row level security;
revoke all on table public.checkout_idempotency from anon,authenticated;
create policy "checkout_idempotency_no_client_access"
on public.checkout_idempotency for all to anon,authenticated
using(false) with check(false);
