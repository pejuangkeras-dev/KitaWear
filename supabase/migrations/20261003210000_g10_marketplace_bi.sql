-- G10 Marketplace BI: admin-only business intelligence over existing marketplace data.
create or replace function public.marketplace_bi_dashboard(p_from date,p_to date)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare result jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from then raise exception 'Invalid BI period'; end if;
 if p_to-p_from>366 then raise exception 'BI period cannot exceed 366 days'; end if;
 with paid as (
  select o.* from public.orders o
  where coalesce(o.paid_at,o.created_at)>=p_from::timestamptz
    and coalesce(o.paid_at,o.created_at)<(p_to+1)::timestamptz
    and (o.paid_at is not null or o.payment_status::text in ('paid','settlement','capture','captured'))
 ), completed as (
  select * from paid where completed_at is not null or status::text='completed'
 ), daily as (
  select to_char(d,'YYYY-MM-DD') as day_label,
   coalesce((select sum(total) from paid x where coalesce(x.paid_at,x.created_at)::date=d),0) as gmv,
   (select count(*) from paid x where coalesce(x.paid_at,x.created_at)::date=d) as orders,
   (select count(*) from completed x where coalesce(x.paid_at,x.created_at)::date=d) as completed_orders,
   (select count(distinct buyer_id) from paid x where coalesce(x.paid_at,x.created_at)::date=d and buyer_id is not null) as buyers
  from generate_series(p_from::timestamptz,p_to::timestamptz,'1 day') d
 ), sellers as (
  select s.id,s.name,count(distinct p.id) as orders,coalesce(sum(oi.line_total),0) as gmv,
         coalesce(sum(oi.quantity),0) as units,count(distinct oi.product_id) as products
  from public.stores s
  join public.order_items oi on oi.store_id=s.id
  join paid p on p.id=oi.order_id
  group by s.id,s.name order by gmv desc limit 20
 ), products as (
  select oi.product_id,max(oi.product_name) as name,count(distinct oi.order_id) as orders,
         coalesce(sum(oi.quantity),0) as units,coalesce(sum(oi.line_total),0) as gmv
  from public.order_items oi join paid p on p.id=oi.order_id
  group by oi.product_id order by gmv desc limit 20
 ), categories as (
  select coalesce(pr.category,'Tanpa kategori') as category,count(distinct oi.order_id) as orders,
         coalesce(sum(oi.quantity),0) as units,coalesce(sum(oi.line_total),0) as gmv
  from public.order_items oi join paid p on p.id=oi.order_id
  left join public.products pr on pr.id=oi.product_id
  group by coalesce(pr.category,'Tanpa kategori') order by gmv desc limit 20
 ), payments as (
  select coalesce(nullif(trim(payment_type),''),'unknown') as payment_type,count(*) as orders,
         coalesce(sum(total),0) as gmv
  from paid group by coalesce(nullif(trim(payment_type),''),'unknown') order by gmv desc
 ), shipping as (
  select coalesce(nullif(trim(shipping_status),''),'unknown') as shipping_status,count(*) as orders
  from paid group by coalesce(nullif(trim(shipping_status),''),'unknown') order by orders desc
 ), refunds as (
  select count(*) as requests,
    coalesce(sum(amount) filter(where status::text in ('approved','processed','completed','success','succeeded')),0) as amount
  from public.refund_requests where created_at>=p_from::timestamptz and created_at<(p_to+1)::timestamptz
 ), returns as (
  select count(*) as requests,
    count(*) filter(where status::text not in ('resolved','rejected','cancelled','canceled')) as open_requests
  from public.return_requests where created_at>=p_from::timestamptz and created_at<(p_to+1)::timestamptz
 ), disputes as (
  select count(*) as requests,
    count(*) filter(where status::text not in ('resolved','closed','rejected','cancelled','canceled')) as open_requests
  from public.disputes where created_at>=p_from::timestamptz and created_at<(p_to+1)::timestamptz
 ), reviews as (
  select count(*) as review_count,coalesce(round(avg(rating)::numeric,2),0) as avg_rating
  from public.product_reviews where created_at>=p_from::timestamptz and created_at<(p_to+1)::timestamptz
 )
 select jsonb_build_object(
  'period',jsonb_build_object('from',p_from,'to',p_to),
  'kpi',jsonb_build_object(
   'gmv',coalesce((select sum(total) from paid),0),'orders',(select count(*) from paid),
   'completed_orders',(select count(*) from completed),'buyers',(select count(distinct buyer_id) from paid where buyer_id is not null),
   'aov',case when (select count(*) from paid)>0 then round((select sum(total)::numeric from paid)/(select count(*) from paid),2) else 0 end,
   'platform_fee',coalesce((select sum(platform_fee) from paid),0),'shipping_fee',coalesce((select sum(shipping_fee) from paid),0),
   'discount',coalesce((select sum(discount_amount) from paid),0)
  ),
  'daily',coalesce((select jsonb_agg(daily order by day_label) from daily),'[]'::jsonb),
  'sellers',coalesce((select jsonb_agg(sellers) from sellers),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(products) from products),'[]'::jsonb),
  'categories',coalesce((select jsonb_agg(categories) from categories),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(payments) from payments),'[]'::jsonb),
  'shipping',coalesce((select jsonb_agg(shipping) from shipping),'[]'::jsonb),
  'service_health',jsonb_build_object(
   'refunds',jsonb_build_object('requests',(select requests from refunds),'amount',(select amount from refunds)),
   'returns',jsonb_build_object('requests',(select requests from returns),'open_requests',(select open_requests from returns)),
   'disputes',jsonb_build_object('requests',(select requests from disputes),'open_requests',(select open_requests from disputes)),
   'reviews',jsonb_build_object('reviews',(select review_count from reviews),'avg_rating',(select avg_rating from reviews))
  )
 ) into result;
 return result;
end; $$;

revoke all on function public.marketplace_bi_dashboard(date,date) from public,anon,authenticated;
grant execute on function public.marketplace_bi_dashboard(date,date) to service_role;
create index if not exists analytics_events_store_event_created_idx on public.analytics_events(store_id,event_name,created_at desc);
create index if not exists order_items_store_order_idx on public.order_items(store_id,order_id);
create index if not exists order_items_product_order_idx on public.order_items(product_id,order_id);
