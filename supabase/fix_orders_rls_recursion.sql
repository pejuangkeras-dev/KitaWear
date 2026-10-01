-- Fix circular RLS dependency between orders and order_sellers.
-- Applied directly to Supabase project eczozutsjwvkfgpyccou on 2026-10-01.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.order_belongs_to_buyer(p_order_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select exists (
    select 1 from public.orders o
    where o.id = $1 and o.buyer_id = $2
  );
$function$;

create or replace function private.order_has_seller(p_order_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select exists (
    select 1 from public.order_sellers os
    where os.order_id = $1 and os.seller_id = $2
  );
$function$;

revoke all on function private.order_belongs_to_buyer(uuid,uuid) from public, anon;
revoke all on function private.order_has_seller(uuid,uuid) from public, anon;
grant execute on function private.order_belongs_to_buyer(uuid,uuid) to authenticated;
grant execute on function private.order_has_seller(uuid,uuid) to authenticated;

drop policy if exists order_sellers_buyer_read on public.order_sellers;
create policy order_sellers_buyer_read on public.order_sellers
for select to authenticated
using (private.order_belongs_to_buyer(order_id, (select auth.uid())));

drop policy if exists seller_view_orders on public.orders;
create policy seller_view_orders on public.orders
for select to authenticated
using (
  seller_id = (select auth.uid())
  or private.order_has_seller(id, (select auth.uid()))
);

drop policy if exists "Admins can read all orders" on public.orders;
drop policy if exists admin_view_all_orders on public.orders;
drop policy if exists orders_admin_select on public.orders;
create policy orders_admin_select on public.orders
for select to authenticated
using (is_admin());
