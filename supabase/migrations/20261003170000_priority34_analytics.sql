-- P34 Analytics: buyer, seller, GMV, conversion, retention and campaign analytics.

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  event_name text not null check (event_name in (
    'page_view','product_view','search','add_to_cart','checkout_started',
    'purchase_success','login','signup'
  )),
  session_id uuid,
  user_id uuid references auth.users(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  voucher_id uuid references public.vouchers(id) on delete set null,
  path text,
  referrer text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_idx
  on public.analytics_events(created_at desc);
create index if not exists analytics_events_name_created_idx
  on public.analytics_events(event_name,created_at desc);
create index if not exists analytics_events_session_created_idx
  on public.analytics_events(session_id,created_at desc);
create index if not exists analytics_events_user_created_idx
  on public.analytics_events(user_id,created_at desc);
create index if not exists analytics_events_product_created_idx
  on public.analytics_events(product_id,created_at desc);
create index if not exists analytics_events_store_created_idx
  on public.analytics_events(store_id,created_at desc);
create index if not exists analytics_events_voucher_created_idx
  on public.analytics_events(voucher_id,created_at desc);

alter table public.analytics_events enable row level security;

create or replace function public.analytics_track_event(
  p_event_id uuid,
  p_event_name text,
  p_session_id uuid default null,
  p_user_id uuid default null,
  p_product_id uuid default null,
  p_store_id uuid default null,
  p_voucher_id uuid default null,
  p_path text default null,
  p_referrer text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_id uuid;
begin
  if p_event_name not in ('page_view','product_view','search','add_to_cart','checkout_started','purchase_success','login','signup')
    then raise exception 'Invalid analytics event'; end if;
  if length(coalesce(p_path,''))>500 or length(coalesce(p_referrer,''))>1000 then
    raise exception 'Analytics field too long';
  end if;
  if pg_column_size(coalesce(p_metadata,'{}'::jsonb))>8192 then
    raise exception 'Analytics metadata too large';
  end if;

  insert into public.analytics_events(
    event_id,event_name,session_id,user_id,product_id,store_id,voucher_id,path,referrer,metadata
  )
  values(
    p_event_id,p_event_name,p_session_id,p_user_id,p_product_id,p_store_id,p_voucher_id,
    left(p_path,500),left(p_referrer,1000),coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict(event_id) do update set event_id=excluded.event_id
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.analytics_dashboard(
  p_from date,
  p_to date,
  p_store_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  result jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Invalid analytics period';
  end if;
  if p_to-p_from > 366 then
    raise exception 'Analytics period cannot exceed 366 days';
  end if;

  with paid as (
    select o.id,o.buyer_id,o.total,o.subtotal,o.shipping_fee,o.discount_amount,o.voucher_id,
           o.created_at,o.paid_at,o.completed_at,o.status::text as status
    from public.orders o
    where coalesce(o.paid_at,o.created_at) >= p_from::timestamptz
      and coalesce(o.paid_at,o.created_at) < (p_to+1)::timestamptz
      and (o.paid_at is not null or o.payment_status::text in ('paid','settlement','capture','captured'))
      and (p_store_id is null or exists (
        select 1 from public.order_sellers os
        where os.order_id=o.id and os.store_id=p_store_id
      ))
  ),
  completed as (
    select * from paid where completed_at is not null or status='completed'
  ),
  visitors as (
    select count(distinct session_id) filter(where event_name='page_view') as sessions,
           count(distinct session_id) filter(where event_name='product_view') as product_sessions,
           count(distinct session_id) filter(where event_name='checkout_started') as checkout_sessions,
           count(distinct user_id) filter(where event_name='page_view' and user_id is not null) as logged_visitors
    from public.analytics_events
    where created_at>=p_from::timestamptz and created_at<(p_to+1)::timestamptz
      and (p_store_id is null or store_id=p_store_id)
  ),
  current_buyers as (
    select distinct buyer_id from completed where buyer_id is not null
  ),
  prior_buyers as (
    select distinct o.buyer_id
    from public.orders o
    where o.buyer_id is not null
      and (o.paid_at is not null or o.payment_status::text in ('paid','settlement','capture','captured'))
      and coalesce(o.paid_at,o.created_at) < p_from::timestamptz
  ),
  daily as (
    select to_char(d,'YYYY-MM-DD') as day,
           coalesce((select sum(total) from paid x where coalesce(x.paid_at,x.created_at)::date=d),0) as gmv,
           (select count(*) from paid x where coalesce(x.paid_at,x.created_at)::date=d) as orders,
           (select count(*) from completed x where coalesce(x.paid_at,x.created_at)::date=d) as completed_orders
    from generate_series(p_from::timestamptz,p_to::timestamptz,'1 day') d
  ),
  campaigns as (
    select v.id,v.code,v.title,
           count(p.id) as orders,
           coalesce(sum(p.total),0) as gmv,
           coalesce(sum(p.discount_amount),0) as discount
    from public.vouchers v
    left join paid p on p.voucher_id=v.id
    where v.id is not null
    group by v.id,v.code,v.title
    order by gmv desc
    limit 20
  )
  select jsonb_build_object(
    'period',jsonb_build_object('from',p_from,'to',p_to),
    'gmv',coalesce((select sum(total) from paid),0),
    'orders',(select count(*) from paid),
    'paid_orders',(select count(*) from paid),
    'completed_orders',(select count(*) from completed),
    'buyers',(select count(*) from current_buyers),
    'aov',case when (select count(*) from paid)>0 then round((select sum(total)::numeric from paid)/(select count(*) from paid),2) else 0 end,
    'platform_fee',coalesce((select sum(platform_fee) from public.orders o where o.id in (select id from paid)),0),
    'shipping',coalesce((select sum(shipping_fee) from paid),0),
    'discount',coalesce((select sum(discount_amount) from paid),0),
    'visitors',(select row_to_json(visitors)::jsonb from visitors),
    'conversion',jsonb_build_object(
      'visitor_to_purchase_pct',
        case when coalesce((select sessions from visitors),0)>0
          then round(((select count(distinct buyer_id) from completed where buyer_id is not null)::numeric*100)/(select sessions from visitors),2) else 0 end,
      'visitor_to_checkout_pct',
        case when coalesce((select sessions from visitors),0)>0
          then round(((select checkout_sessions from visitors)::numeric*100)/(select sessions from visitors),2) else 0 end,
      'checkout_to_purchase_pct',
        case when coalesce((select checkout_sessions from visitors),0)>0
          then round(((select count(distinct buyer_id) from completed where buyer_id is not null)::numeric*100)/(select checkout_sessions from visitors),2) else 0 end
    ),
    'retention',jsonb_build_object(
      'repeat_buyers', (select count(*) from current_buyers c join prior_buyers p using(buyer_id)),
      'retention_pct',
        case when (select count(*) from current_buyers)>0
          then round(((select count(*) from current_buyers c join prior_buyers p using(buyer_id))::numeric*100)/(select count(*) from current_buyers),2) else 0 end
    ),
    'campaigns',coalesce((select jsonb_agg(campaigns) from campaigns),'[]'::jsonb),
    'daily',coalesce((select jsonb_agg(daily order by day) from daily),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.analytics_track_event(uuid,text,uuid,uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.analytics_dashboard(date,date,uuid) from public,anon,authenticated;
grant execute on function public.analytics_track_event(uuid,text,uuid,uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.analytics_dashboard(date,date,uuid) to service_role;
