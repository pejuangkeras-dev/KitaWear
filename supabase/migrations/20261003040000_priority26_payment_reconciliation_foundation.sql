create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  provider text not null default 'midtrans',
  event_key text not null,
  event_type text not null default 'notification',
  transaction_id text,
  transaction_status text,
  status_code text,
  status_message text,
  payment_type text,
  fraud_status text,
  gross_amount bigint,
  source text not null default 'webhook',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, event_key)
);

create index if not exists payment_events_order_idx
  on public.payment_events(order_id, created_at desc);

create index if not exists payment_events_provider_created_idx
  on public.payment_events(provider, created_at desc);

alter table public.payment_events enable row level security;

revoke all on table public.payment_events from anon, authenticated;

alter table public.orders
  add column if not exists payment_last_synced_at timestamptz,
  add column if not exists payment_status_code text,
  add column if not exists payment_status_message text,
  add column if not exists payment_type text,
  add column if not exists payment_fraud_status text;

create index if not exists orders_payment_reconcile_idx
  on public.orders(payment_status, updated_at desc)
  where payment_status = 'pending';

create policy "payment_events_no_client_access"
  on public.payment_events
  for all
  to anon, authenticated
  using (false)
  with check (false);
