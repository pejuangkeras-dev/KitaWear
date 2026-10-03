create table if not exists public.shipping_tracking_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipping_shipments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_seller_id uuid not null references public.order_sellers(id) on delete cascade,
  event_key text not null,
  status text not null,
  description text,
  city text,
  event_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (shipment_id,event_key)
);
create index if not exists shipping_tracking_events_order_idx on public.shipping_tracking_events(order_id,event_at desc);
create index if not exists shipping_tracking_events_shipment_idx on public.shipping_tracking_events(shipment_id,event_at desc);
alter table public.shipping_tracking_events enable row level security;
drop policy if exists shipping_tracking_events_buyer_read on public.shipping_tracking_events;
create policy shipping_tracking_events_buyer_read on public.shipping_tracking_events
for select to authenticated
using (
  exists (select 1 from public.orders o where o.id=shipping_tracking_events.order_id and o.buyer_id=auth.uid())
  or exists (select 1 from public.order_sellers os where os.id=shipping_tracking_events.order_seller_id and os.seller_id=auth.uid())
  or exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
);
revoke all on public.shipping_tracking_events from anon;
revoke insert,update,delete on public.shipping_tracking_events from authenticated;
grant select on public.shipping_tracking_events to authenticated;

create or replace function public.get_order_timeline(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'order_status_events', coalesce((select jsonb_agg(to_jsonb(x) order by x.changed_at asc) from public.order_status_events x where x.order_id=p_order_id),'[]'::jsonb),
    'shipping_events', coalesce((select jsonb_agg(to_jsonb(x) order by x.event_at asc) from public.shipping_tracking_events x where x.order_id=p_order_id),'[]'::jsonb),
    'shipments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at asc) from public.shipping_shipments x where x.order_id=p_order_id),'[]'::jsonb)
  );
$$;
revoke execute on function public.get_order_timeline(uuid) from public,anon,authenticated;
grant execute on function public.get_order_timeline(uuid) to service_role;