-- KitaWear marketplace security upgrade
-- Run this AFTER the original schema.sql.

create or replace function public.is_seller_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('seller','admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

-- Replace broad store/product write policies with role-aware policies.
drop policy if exists stores_owner_all on public.stores;
drop policy if exists products_owner_all on public.products;
drop policy if exists sizes_owner_all on public.product_sizes;

create policy stores_seller_owner_all
on public.stores
for all
to authenticated
using (owner_id=auth.uid() and public.is_seller_or_admin())
with check (owner_id=auth.uid() and public.is_seller_or_admin());

create policy stores_admin_all
on public.stores
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy products_seller_owner_all
on public.products
for all
to authenticated
using (
  public.is_seller_or_admin()
  and exists (
    select 1 from public.stores s
    where s.id=store_id and s.owner_id=auth.uid()
  )
)
with check (
  public.is_seller_or_admin()
  and exists (
    select 1 from public.stores s
    where s.id=store_id and s.owner_id=auth.uid()
  )
);

create policy products_admin_all
on public.products
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy sizes_seller_owner_all
on public.product_sizes
for all
to authenticated
using (
  public.is_seller_or_admin()
  and exists (
    select 1
    from public.products p
    join public.stores s on s.id=p.store_id
    where p.id=product_id and s.owner_id=auth.uid()
  )
)
with check (
  public.is_seller_or_admin()
  and exists (
    select 1
    from public.products p
    join public.stores s on s.id=p.store_id
    where p.id=product_id and s.owner_id=auth.uid()
  )
);

create policy sizes_admin_all
on public.product_sizes
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Admin can inspect all marketplace operational data.
create policy profiles_admin_select
on public.profiles
for select
to authenticated
using (public.is_admin());

create policy orders_admin_select
on public.orders
for select
to authenticated
using (public.is_admin());

create policy order_items_admin_select
on public.order_items
for select
to authenticated
using (public.is_admin());

create policy payouts_admin_select
on public.seller_payouts
for select
to authenticated
using (public.is_admin());

create policy seller_apps_admin_all
on public.seller_applications
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy reviews_admin_all
on public.reviews
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy disputes_admin_all
on public.disputes
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
