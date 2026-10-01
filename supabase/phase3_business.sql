-- MarketKita Phase 3: Business
-- Applied live to Supabase project eczozutsjwvkfgpyccou.
-- Adds seller balance/report RPCs, admin business dashboard,
-- voucher administration, and concurrency hardening for voucher claims.

create or replace function public.seller_balance_summary()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_eligible bigint;
  v_pending bigint;
  v_paid bigint;
  v_requested bigint;
begin
  if v_user is null then raise exception 'LOGIN_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=v_user and role='seller') then raise exception 'SELLER_REQUIRED'; end if;
  select coalesce(sum(net_amount),0) into v_eligible from public.seller_payouts where seller_id=v_user and status='eligible';
  select coalesce(sum(net_amount),0) into v_pending from public.seller_payouts where seller_id=v_user and status='pending';
  select coalesce(sum(net_amount),0) into v_paid from public.seller_payouts where seller_id=v_user and status='paid';
  select coalesce(sum(amount),0) into v_requested from public.seller_payout_requests where seller_id=v_user and status in ('pending','approved');
  return jsonb_build_object('available',v_eligible,'pending',v_pending,'paid',v_paid,'requested',v_requested);
end;
$$;

create or replace function public.seller_sales_report(p_from date default (current_date - 29), p_to date default current_date)
returns table(sale_date date, orders bigint, gross_amount bigint, platform_fee bigint, net_amount bigint, shipping_fee bigint)
language plpgsql security definer set search_path to ''
as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'LOGIN_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=v_user and role='seller') then raise exception 'SELLER_REQUIRED'; end if;
  if p_from > p_to then raise exception 'INVALID_DATE_RANGE'; end if;
  return query
  select (coalesce(o.paid_at,o.updated_at,o.created_at) at time zone 'Asia/Jakarta')::date,
         count(distinct o.id),
         coalesce(sum(os.subtotal + os.shipping_fee),0)::bigint,
         coalesce(sum(os.platform_fee),0)::bigint,
         coalesce(sum(os.subtotal - os.platform_fee),0)::bigint,
         coalesce(sum(os.shipping_fee),0)::bigint
  from public.order_sellers os join public.orders o on o.id=os.order_id
  where os.seller_id=v_user and o.payment_status='paid' and o.paid_at is not null
    and (o.paid_at at time zone 'Asia/Jakarta')::date between p_from and p_to
  group by 1 order by 1;
end;
$$;

create or replace function public.admin_business_dashboard(p_from date default (current_date - 29), p_to date default current_date)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_orders bigint; v_paid bigint; v_completed bigint; v_gross bigint; v_shipping bigint;
  v_platform bigint; v_net bigint; v_refunded bigint; v_voucher bigint;
  v_payout_pending bigint; v_payout_eligible bigint; v_payout_paid bigint;
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_from > p_to then raise exception 'INVALID_DATE_RANGE'; end if;
  select count(*), count(*) filter(where payment_status='paid'), count(*) filter(where status='completed')
  into v_orders,v_paid,v_completed from public.orders
  where (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to;
  select coalesce(sum(os.subtotal + os.shipping_fee),0), coalesce(sum(os.shipping_fee),0),
         coalesce(sum(os.platform_fee),0), coalesce(sum(os.subtotal - os.platform_fee),0)
  into v_gross,v_shipping,v_platform,v_net
  from public.order_sellers os join public.orders o on o.id=os.order_id
  where o.payment_status='paid' and (o.paid_at at time zone 'Asia/Jakarta')::date between p_from and p_to;
  select coalesce(sum(total),0) into v_refunded from public.orders
  where status='refunded' and (updated_at at time zone 'Asia/Jakarta')::date between p_from and p_to;
  select count(*) into v_voucher from public.orders
  where voucher_id is not null and (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to;
  select coalesce(sum(net_amount),0) into v_payout_pending from public.seller_payouts where status='pending';
  select coalesce(sum(net_amount),0) into v_payout_eligible from public.seller_payouts where status='eligible';
  select coalesce(sum(net_amount),0) into v_payout_paid from public.seller_payouts
  where status='paid' and (paid_at at time zone 'Asia/Jakarta')::date between p_from and p_to;
  return jsonb_build_object(
    'orders',v_orders,'paid_orders',v_paid,'completed_orders',v_completed,'gross_sales',v_gross,
    'shipping',v_shipping,'platform_fee',v_platform,'seller_net',v_net,'refunded',v_refunded,
    'voucher_orders',v_voucher,'payout_pending',v_payout_pending,'payout_eligible',v_payout_eligible,'payout_paid',v_payout_paid
  );
end;
$$;

create or replace function public.admin_create_voucher(
  p_code text,p_title text,p_description text default null,p_discount_type text default 'percent',
  p_discount_value integer default 0,p_min_order_amount integer default 0,p_max_discount integer default null,
  p_usage_limit integer default null,p_starts_at timestamptz default now(),p_expires_at timestamptz default null
)
returns public.vouchers
language plpgsql security definer set search_path to 'public'
as $$
declare v public.vouchers;
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if trim(coalesce(p_code,''))='' then raise exception 'CODE_REQUIRED'; end if;
  if lower(p_discount_type) not in ('percent','fixed') then raise exception 'INVALID_DISCOUNT_TYPE'; end if;
  if p_discount_value <= 0 then raise exception 'INVALID_DISCOUNT_VALUE'; end if;
  if lower(p_discount_type)='percent' and p_discount_value>100 then raise exception 'INVALID_PERCENT'; end if;
  if p_min_order_amount < 0 or coalesce(p_max_discount,0) < 0 or coalesce(p_usage_limit,0) < 0 then raise exception 'INVALID_VOUCHER_LIMIT'; end if;
  if p_expires_at is not null and p_expires_at <= p_starts_at then raise exception 'INVALID_VOUCHER_DATES'; end if;
  insert into public.vouchers(code,title,description,discount_type,discount_value,min_order_amount,max_discount,usage_limit,used_count,starts_at,expires_at,active)
  values(upper(trim(p_code)),left(trim(p_title),150),left(nullif(trim(coalesce(p_description,'')),''),1000),lower(p_discount_type),
         p_discount_value,p_min_order_amount,nullif(p_max_discount,0),nullif(p_usage_limit,0),0,p_starts_at,p_expires_at,true)
  returning * into v;
  return v;
exception when unique_violation then raise exception 'VOUCHER_CODE_EXISTS';
end;
$$;

create or replace function public.admin_set_voucher_active(p_voucher_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  update public.vouchers set active=p_active,updated_at=now() where id=p_voucher_id;
  if not found then raise exception 'VOUCHER_NOT_FOUND'; end if;
  return jsonb_build_object('ok',true,'id',p_voucher_id,'active',p_active);
end;
$$;

create or replace function public.claim_voucher(p_voucher_id uuid)
returns public.user_vouchers language plpgsql security definer set search_path to 'public'
as $$
declare v public.user_vouchers; x public.vouchers%rowtype;
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  select * into x from public.vouchers where id=p_voucher_id for update;
  if not found or not x.active or x.starts_at>now() or (x.expires_at is not null and x.expires_at<=now())
     or (x.usage_limit is not null and x.used_count>=x.usage_limit) then raise exception 'VOUCHER_UNAVAILABLE'; end if;
  insert into public.user_vouchers(voucher_id,user_id) values(p_voucher_id,auth.uid()) returning * into v;
  return v;
exception when unique_violation then raise exception 'VOUCHER_ALREADY_CLAIMED';
end;
$$;

revoke execute on function public.seller_balance_summary() from public,anon;
revoke execute on function public.seller_sales_report(date,date) from public,anon;
revoke execute on function public.admin_business_dashboard(date,date) from public,anon;
revoke execute on function public.admin_create_voucher(text,text,text,text,integer,integer,integer,integer,timestamptz,timestamptz) from public,anon;
revoke execute on function public.admin_set_voucher_active(uuid,boolean) from public,anon;
grant execute on function public.seller_balance_summary() to authenticated;
grant execute on function public.seller_sales_report(date,date) to authenticated;
grant execute on function public.admin_business_dashboard(date,date) to authenticated;
grant execute on function public.admin_create_voucher(text,text,text,text,integer,integer,integer,integer,timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_set_voucher_active(uuid,boolean) to authenticated;


create or replace function public.admin_list_vouchers()
returns setof public.vouchers
language plpgsql security definer set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  return query select v.* from public.vouchers v order by v.created_at desc limit 200;
end;
$$;
revoke execute on function public.admin_list_vouchers() from public,anon;
grant execute on function public.admin_list_vouchers() to authenticated;
