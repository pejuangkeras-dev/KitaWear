-- MarketKita Priority 1 Hardening A-F
-- Production hardening for:
-- A webhook/payout idempotency
-- B double buyer confirmation
-- C multi-seller completion gate
-- D paid-order cancellation safety
-- E stock consistency
-- F RLS/function privilege hardening

-- A/F: payout ledger creation is server-only. The Midtrans webhook calls it
-- with service_role; buyer confirmation invokes it from SECURITY DEFINER.
revoke execute on function public.create_order_payouts(uuid) from public, anon, authenticated;
grant execute on function public.create_order_payouts(uuid) to service_role;

-- E/F: stock mutation functions are server-only.
revoke execute on function public.decrement_order_stock(uuid) from public, anon, authenticated;
grant execute on function public.decrement_order_stock(uuid) to service_role;

revoke execute on function public.restore_order_stock(uuid) from public, anon, authenticated;
grant execute on function public.restore_order_stock(uuid) to service_role;

-- F: sellers must use the guarded fulfillment RPC rather than direct UPDATE
-- access to orders.
drop policy if exists seller_update_orders on public.orders;

-- D: paid orders cannot be cancelled directly by a seller. Unpaid seller
-- cancellations close the order and release any stock reservation.
create or replace function public.seller_update_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_status text := lower(trim(coalesce(p_status,'')));
  v_payment public.payment_status;
  v_split record;
  v_order_number text;
  v_buyer_id uuid;
  v_all_processing boolean;
  v_all_shipped boolean;
  v_all_cancelled boolean;
  v_old_status text;
  v_shipping_status text;
  v_title text;
  v_message text;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;
  if not exists(select 1 from public.profiles where id=v_user and role='seller') then
    raise exception 'Akses ditolak. Akun bukan seller.';
  end if;

  if v_status='delivered' then v_status='shipped'; end if;
  if v_status not in ('processing','shipped','cancelled') then
    raise exception 'Status seller tidak valid. Penyelesaian order dilakukan oleh buyer setelah barang diterima.';
  end if;

  select o.payment_status,o.order_number,o.buyer_id
    into v_payment,v_order_number,v_buyer_id
  from public.orders o
  where o.id=p_order_id
  for update;

  if not found then raise exception 'Pesanan tidak ditemukan.'; end if;

  if v_status in ('processing','shipped') and v_payment<>'paid'::public.payment_status then
    raise exception 'Pesanan belum dibayar.';
  end if;

  if v_status='cancelled' and v_payment='paid'::public.payment_status then
    raise exception 'Pesanan yang sudah dibayar tidak dapat dibatalkan langsung oleh seller. Gunakan alur sengketa/refund.';
  end if;

  select os.id,os.seller_status,os.shipping_status
    into v_split
  from public.order_sellers os
  join public.stores s on s.id=os.store_id
  where os.order_id=p_order_id and s.owner_id=v_user
  for update;

  if not found then raise exception 'Pesanan tidak ditemukan atau bukan milik toko Anda.'; end if;

  v_old_status := coalesce(v_split.seller_status,'pending');

  if v_status='processing' and v_split.seller_status not in ('pending','paid','processing') then
    raise exception 'Toko Anda tidak dapat masuk ke status diproses dari status saat ini.';
  end if;
  if v_status='shipped' and v_split.seller_status<>'processing' then
    raise exception 'Toko Anda harus memproses pesanan sebelum mengirim.';
  end if;
  if v_status='cancelled' and v_split.seller_status not in ('pending','paid','processing') then
    raise exception 'Toko Anda tidak dapat membatalkan pesanan dari status saat ini.';
  end if;

  update public.order_sellers
  set seller_status=v_status,
      shipping_status=case
        when v_status='shipped' then 'shipped'
        when v_status='cancelled' then 'cancelled'
        when v_status='processing' then 'processing'
        else shipping_status
      end,
      updated_at=now()
  where id=v_split.id;

  v_shipping_status := case
    when v_status='shipped' then 'shipped'
    when v_status='cancelled' then 'cancelled'
    when v_status='processing' then 'processing'
    else v_split.shipping_status
  end;

  select
    bool_and(seller_status in ('processing','shipped')) as all_processing,
    bool_and(seller_status in ('shipped')) as all_shipped,
    bool_and(seller_status='cancelled') as all_cancelled
  into v_all_processing,v_all_shipped,v_all_cancelled
  from public.order_sellers
  where order_id=p_order_id;

  if v_all_cancelled then
    update public.orders
    set status='cancelled'::public.order_status,
        payment_status='failed'::public.payment_status,
        shipping_status='cancelled',
        updated_at=now()
    where id=p_order_id
      and payment_status<>'paid'::public.payment_status;

    perform public.release_order_stock_reservation(p_order_id,'seller_cancelled');
  elsif v_all_shipped then
    update public.orders
    set status='shipped'::public.order_status,
        shipping_status='shipped',
        shipped_at=coalesce(shipped_at,now()),
        updated_at=now()
    where id=p_order_id and payment_status='paid'::public.payment_status;
  elsif v_all_processing then
    update public.orders
    set status='processing'::public.order_status,
        shipping_status='processing',
        processing_at=coalesce(processing_at,now()),
        updated_at=now()
    where id=p_order_id and payment_status='paid'::public.payment_status;
  end if;

  if v_status='processing' and v_old_status<>v_status then
    v_title := 'Pesanan sedang diproses';
    v_message := format('Pesanan %s sedang diproses oleh seller.',v_order_number);
  elsif v_status='shipped' and v_old_status<>v_status then
    v_title := 'Pesanan telah dikirim';
    v_message := format('Pesanan %s telah dikirim oleh seller. Resi: %s',v_order_number,
      coalesce((select tracking_number from public.order_sellers where id=v_split.id),'belum tersedia'));
  elsif v_status='cancelled' and v_old_status<>v_status then
    v_title := 'Pesanan dibatalkan seller';
    v_message := format('Seller membatalkan pesanan %s sebelum pembayaran.',v_order_number);
  end if;

  if v_title is not null and v_buyer_id is not null then
    insert into public.notifications(user_id,type,title,message,link)
    values(v_buyer_id,'order',v_title,v_message,'?account=orders');
  end if;

  return jsonb_build_object(
    'ok',true,
    'order_id',p_order_id,
    'seller_order_seller_id',v_split.id,
    'previous_seller_status',v_old_status,
    'seller_status',v_status,
    'shipping_status',v_shipping_status
  );
end;
$function$;

revoke execute on function public.seller_update_order_status(uuid,text) from public, anon;
grant execute on function public.seller_update_order_status(uuid,text) to authenticated;

-- B/C: repeated buyer confirmation is idempotent, and completion requires every
-- seller split to be delivered. Payout creation is idempotent and occurs
-- before pending -> eligible.
create or replace function public.buyer_confirm_order_received(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
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
  v_created_payouts integer;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;

  select status,payment_status,order_number
    into v_current,v_payment,v_order_number
  from public.orders
  where id=p_order_id and buyer_id=v_user
  for update;

  if not found then raise exception 'Pesanan tidak ditemukan.'; end if;

  if v_current='completed'::public.order_status then
    select count(*) into v_created_payouts
    from public.seller_payouts where order_id=p_order_id;
    return jsonb_build_object(
      'ok',true,'order_id',p_order_id,'status','completed',
      'already_completed',true,'payout_rows_total',v_created_payouts
    );
  end if;

  if v_payment <> 'paid'::public.payment_status then
    raise exception 'Pesanan belum dibayar.';
  end if;

  if v_current not in ('shipped'::public.order_status,'delivered'::public.order_status) then
    raise exception 'Pesanan belum berada pada tahap dikirim atau barang sampai.';
  end if;

  select count(*),count(*) filter (where shipping_status='delivered')
    into v_seller_count,v_delivered_count
  from public.order_sellers
  where order_id=p_order_id;

  if v_seller_count=0 or v_delivered_count<>v_seller_count then
    raise exception 'Belum semua pengiriman seller berstatus barang sampai.';
  end if;

  perform public.create_order_payouts(p_order_id);

  update public.orders
  set status='completed'::public.order_status,
      delivered_at=coalesce(delivered_at,now()),
      completed_at=coalesce(completed_at,now()),
      shipping_status='delivered',
      updated_at=now()
  where id=p_order_id and buyer_id=v_user;

  update public.order_sellers
  set shipping_status='delivered',
      seller_status='completed',
      updated_at=now()
  where order_id=p_order_id;

  update public.seller_payouts
  set status='eligible'
  where order_id=p_order_id and status='pending';

  get diagnostics v_payout_count = row_count;

  for v_seller_id in
    select distinct s.owner_id
    from public.order_sellers os
    join public.stores s on s.id=os.store_id
    where os.order_id=p_order_id and s.owner_id is not null
  loop
    insert into public.notifications(user_id,type,title,message,link)
    values(
      v_seller_id,'payout','Pesanan selesai — saldo payout tersedia',
      format('Pesanan %s telah dikonfirmasi diterima pembeli. Saldo seller menjadi eligible untuk payout.',v_order_number),
      '?seller=payout'
    );
  end loop;

  insert into public.notifications(user_id,type,title,message,link)
  values(
    v_user,'order','Pesanan selesai',
    format('Pesanan %s berhasil dikonfirmasi diterima. Payout seller telah menjadi eligible.',v_order_number),
    '?account=orders'
  );

  select count(*) into v_created_payouts
  from public.seller_payouts where order_id=p_order_id;

  return jsonb_build_object(
    'ok',true,
    'order_id',p_order_id,
    'status','completed',
    'payout_rows_eligible',v_payout_count,
    'payout_rows_total',v_created_payouts
  );
end;
$function$;

revoke execute on function public.buyer_confirm_order_received(uuid) from public, anon;
grant execute on function public.buyer_confirm_order_received(uuid) to authenticated;
