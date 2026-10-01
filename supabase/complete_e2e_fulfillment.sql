-- Buyer confirmation closes the E2E fulfillment loop.
create or replace function public.buyer_confirm_order_received(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_current public.order_status;
  v_payment public.payment_status;
  v_order_number text;
  v_seller_id uuid;
  v_seller_count integer;
  v_delivered_count integer;
  v_payout_count integer;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;
  select status,payment_status,order_number into v_current,v_payment,v_order_number
  from public.orders where id=p_order_id and buyer_id=v_user for update;
  if not found then raise exception 'Pesanan tidak ditemukan.'; end if;
  if v_payment <> 'paid'::public.payment_status then raise exception 'Pesanan belum dibayar.'; end if;
  if v_current not in ('shipped'::public.order_status,'delivered'::public.order_status) then
    raise exception 'Pesanan belum berada pada tahap dikirim atau barang sampai.';
  end if;

  select count(*),count(*) filter (where shipping_status='delivered')
    into v_seller_count,v_delivered_count
  from public.order_sellers where order_id=p_order_id;
  if v_seller_count=0 or v_delivered_count<>v_seller_count then
    raise exception 'Belum semua pengiriman seller berstatus barang sampai.';
  end if;

  -- Ensure every paid order item has a payout ledger before making it eligible.
  perform public.create_order_payouts(p_order_id);

  update public.orders
  set status='completed'::public.order_status, delivered_at=coalesce(delivered_at,now()),
      completed_at=coalesce(completed_at,now()), shipping_status='delivered', updated_at=now()
  where id=p_order_id and buyer_id=v_user;

  update public.order_sellers
  set shipping_status='delivered', seller_status='completed', updated_at=now()
  where order_id=p_order_id;

  update public.seller_payouts set status='eligible'
  where order_id=p_order_id and status='pending';
  get diagnostics v_payout_count = row_count;

  for v_seller_id in
    select distinct s.owner_id from public.order_sellers os
    join public.stores s on s.id=os.store_id
    where os.order_id=p_order_id and s.owner_id is not null
  loop
    insert into public.notifications(user_id,type,title,message,link)
    values(v_seller_id,'payout','Pesanan selesai — saldo payout tersedia',
      format('Pesanan %s telah dikonfirmasi diterima pembeli. Saldo seller menjadi eligible untuk payout.',v_order_number),
      '?seller=payout');
  end loop;

  insert into public.notifications(user_id,type,title,message,link)
  values(v_user,'order','Pesanan selesai',
    format('Pesanan %s berhasil dikonfirmasi diterima. Payout seller telah menjadi eligible.',v_order_number),
    '?account=orders');

  return jsonb_build_object('ok',true,'order_id',p_order_id,'status','completed',
    'payout_rows_eligible',v_payout_count,
    'payout_rows_total',(select count(*) from public.seller_payouts where order_id=p_order_id));
end;
$function$;

revoke execute on function public.buyer_confirm_order_received(uuid) from anon;
grant execute on function public.buyer_confirm_order_received(uuid) to authenticated;
