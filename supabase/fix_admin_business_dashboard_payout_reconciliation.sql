-- Reconcile Admin Business Dashboard payout metrics with seller_payouts ledger.
-- Applied to Supabase project eczozutsjwvkfgpyccou.

create or replace function public.admin_business_dashboard(p_from date default (current_date - 29), p_to date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_orders bigint; v_paid bigint; v_completed bigint; v_gross bigint; v_shipping bigint;
  v_platform bigint; v_net bigint; v_refunded bigint; v_voucher bigint;
  v_payout_pending bigint; v_payout_eligible bigint; v_payout_paid bigint; v_payout_refunded bigint;
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_from > p_to then raise exception 'INVALID_DATE_RANGE'; end if;

  select count(*), count(*) filter(where payment_status='paid'), count(*) filter(where status='completed')
  into v_orders,v_paid,v_completed
  from public.orders
  where (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to;

  select coalesce(sum(os.subtotal + os.shipping_fee),0), coalesce(sum(os.shipping_fee),0),
         coalesce(sum(os.platform_fee),0), coalesce(sum(os.subtotal - os.platform_fee),0)
  into v_gross,v_shipping,v_platform,v_net
  from public.order_sellers os join public.orders o on o.id=os.order_id
  where o.payment_status='paid'
    and (coalesce(o.paid_at,o.updated_at,o.created_at) at time zone 'Asia/Jakarta')::date between p_from and p_to;

  select coalesce(sum(total),0) into v_refunded
  from public.orders
  where status='refunded'
    and (updated_at at time zone 'Asia/Jakarta')::date between p_from and p_to;

  select count(*) into v_voucher
  from public.orders
  where voucher_id is not null
    and (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to;

  select coalesce(sum(net_amount),0) into v_payout_pending
  from public.seller_payouts where status='pending';

  select coalesce(sum(net_amount),0) into v_payout_eligible
  from public.seller_payouts where status='eligible';

  select coalesce(sum(net_amount),0) into v_payout_paid
  from public.seller_payouts
  where status='paid'
    and (paid_at at time zone 'Asia/Jakarta')::date between p_from and p_to;

  select coalesce(sum(net_amount),0) into v_payout_refunded
  from public.seller_payouts
  where status='refunded'
    and (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to;

  return jsonb_build_object(
    'orders',v_orders,
    'paid_orders',v_paid,
    'completed_orders',v_completed,
    'gross_sales',v_gross,
    'shipping',v_shipping,
    'platform_fee',v_platform,
    'seller_net',v_net,
    'refunded',v_refunded,
    'voucher_orders',v_voucher,
    'payout_pending',v_payout_pending,
    'payout_eligible',v_payout_eligible,
    'payout_paid',v_payout_paid,
    'payout_refunded',v_payout_refunded
  );
end;
$function$;