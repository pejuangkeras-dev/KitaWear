-- Fix payout ledger creation after partial payout support removed the
-- single-row-per-order-item unique constraint.
create or replace function public.create_order_payouts(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_order record;
  v_item record;
  v_store record;
  v_seller_split record;
  v_item_fee integer;
  v_existing_id uuid;
  v_existing_status public.payout_status;
begin
  select id,payment_status into v_order
  from public.orders where id=p_order_id for update;

  if not found then raise exception 'Order tidak ditemukan.'; end if;
  if v_order.payment_status<>'paid'::public.payment_status then
    raise exception 'Payout hanya dapat dibuat untuk order paid.';
  end if;

  for v_item in
    select oi.id,oi.order_id,oi.store_id,oi.line_total
    from public.order_items oi
    where oi.order_id=p_order_id
    order by oi.id
  loop
    select s.id,s.owner_id into v_store
    from public.stores s
    where s.id=v_item.store_id and s.status='active';

    if not found then
      raise exception 'Toko untuk item order tidak ditemukan atau tidak aktif.';
    end if;

    select os.subtotal,os.platform_fee into v_seller_split
    from public.order_sellers os
    where os.order_id=p_order_id and os.store_id=v_item.store_id
    limit 1;

    v_item_fee := case
      when coalesce(v_seller_split.subtotal,0) > 0
        then floor(
          (coalesce(v_seller_split.platform_fee,0)::numeric * v_item.line_total::numeric)
          / v_seller_split.subtotal::numeric
        )::integer
      else 0
    end;

    -- Partial payouts intentionally allow multiple rows for one order item.
    -- If a non-pending allocation already exists, do not create another one.
    select p.id,p.status into v_existing_id,v_existing_status
    from public.seller_payouts p
    where p.order_item_id=v_item.id
    order by
      case when p.status <> 'pending'::public.payout_status then 0 else 1 end,
      p.created_at asc,
      p.id
    limit 1;

    if v_existing_id is null then
      insert into public.seller_payouts(
        order_item_id,seller_id,store_id,order_id,
        gross_amount,platform_fee,net_amount,status
      )
      values(
        v_item.id,v_store.owner_id,v_item.store_id,p_order_id,
        v_item.line_total,v_item_fee,
        greatest(0,v_item.line_total-v_item_fee),
        'pending'::public.payout_status
      );
    elsif v_existing_status='pending'::public.payout_status then
      update public.seller_payouts
      set seller_id=v_store.owner_id,
          store_id=v_item.store_id,
          gross_amount=v_item.line_total,
          platform_fee=v_item_fee,
          net_amount=greatest(0,v_item.line_total-v_item_fee)
      where id=v_existing_id
        and status='pending'::public.payout_status;
    end if;
  end loop;
end;
$function$;

revoke execute on function public.create_order_payouts(uuid) from public,anon;
grant execute on function public.create_order_payouts(uuid) to authenticated;
