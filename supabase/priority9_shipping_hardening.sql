-- Priority 9: Shipping hardening for RajaOngkir checkout, tracking and admin visibility.
create index if not exists shipping_quotes_buyer_created_idx on public.shipping_quotes(buyer_id, created_at desc);
create index if not exists shipping_shipments_seller_updated_idx on public.shipping_shipments(order_seller_id, updated_at desc);
create unique index if not exists shipping_shipments_order_seller_unique_idx on public.shipping_shipments(order_seller_id);

alter table public.shipping_quotes enable row level security;
alter table public.shipping_shipments enable row level security;

drop policy if exists shipping_quotes_admin_select on public.shipping_quotes;
create policy shipping_quotes_admin_select on public.shipping_quotes
for select to authenticated
using (public.is_admin());

drop policy if exists shipping_shipments_admin_select on public.shipping_shipments;
create policy shipping_shipments_admin_select on public.shipping_shipments
for select to authenticated
using (public.is_admin());

do $$ begin
  if not exists (select 1 from pg_constraint where conname='shipping_quotes_status_chk') then
    alter table public.shipping_quotes add constraint shipping_quotes_status_chk
      check (status in ('active','used','expired','cancelled'));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='shipping_quotes_total_fee_chk') then
    alter table public.shipping_quotes add constraint shipping_quotes_total_fee_chk
      check (total_fee >= 0);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='shipping_shipments_shipping_fee_chk') then
    alter table public.shipping_shipments add constraint shipping_shipments_shipping_fee_chk
      check (shipping_fee >= 0);
  end if;
end $$;
