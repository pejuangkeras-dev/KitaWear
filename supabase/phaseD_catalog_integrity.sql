-- Persist Tahap D catalog integrity schema in repository
create or replace view public.marketplace_product_stats
with (security_invoker = true)
as
select
  p.id as product_id,
  p.store_id,
  coalesce(pr.product_rating,0)::numeric(3,2) as product_rating,
  coalesce(pr.review_count,0)::bigint as review_count,
  coalesce(sr.seller_rating,0)::numeric(3,2) as seller_rating,
  coalesce(sr.seller_review_count,0)::bigint as seller_review_count,
  exists (select 1 from public.product_sizes ps where ps.product_id=p.id and ps.stock > 0) as has_stock
from public.products p
left join (select product_id,avg(rating)::numeric(3,2) product_rating,count(*)::bigint review_count from public.product_reviews group by product_id) pr on pr.product_id=p.id
left join (select store_id,avg(rating)::numeric(3,2) seller_rating,count(*)::bigint seller_review_count from public.seller_reviews group by store_id) sr on sr.store_id=p.store_id;

grant select on public.marketplace_product_stats to anon, authenticated;
create index if not exists products_active_store_idx on public.products(store_id,status);
create index if not exists product_sizes_available_idx on public.product_sizes(product_id,stock) where stock > 0;

create or replace function public.admin_catalog_audit()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_invalid_products bigint;
  v_active_products bigint;
  v_active_stores bigint;
  v_pending_sellers bigint;
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select count(*) into v_invalid_products
  from public.products p join public.stores s on s.id=p.store_id
  where p.status='active'::public.product_status and s.status='active'::public.store_status
    and (p.price<=0 or trim(coalesce(p.name,''))='' or trim(coalesce(p.image_url,''))=''
      or not exists(select 1 from public.product_sizes ps where ps.product_id=p.id and ps.stock>0));
  select count(*) into v_active_products from public.products where status='active'::public.product_status;
  select count(*) into v_active_stores from public.stores where status='active'::public.store_status;
  select count(*) into v_pending_sellers from public.seller_applications where status='pending';
  return jsonb_build_object('ok',true,'invalid_active_products',v_invalid_products,'active_products',v_active_products,'active_stores',v_active_stores,'pending_seller_applications',v_pending_sellers);
end;
$$;
revoke all on function public.admin_catalog_audit() from public,anon,authenticated;
grant execute on function public.admin_catalog_audit() to authenticated;
