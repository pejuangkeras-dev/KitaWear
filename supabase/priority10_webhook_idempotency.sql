create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null,
  order_id uuid references public.orders(id) on delete set null,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(provider, event_key)
);

create index if not exists webhook_events_provider_received_idx
  on public.webhook_events(provider, received_at desc);

create index if not exists webhook_events_order_idx
  on public.webhook_events(order_id);

alter table public.webhook_events enable row level security;

drop policy if exists webhook_events_admin_select on public.webhook_events;
create policy webhook_events_admin_select
  on public.webhook_events
  for select to authenticated
  using (public.is_admin());

revoke all on public.webhook_events from public, anon, authenticated;
grant select on public.webhook_events to authenticated;
grant all on public.webhook_events to service_role;
