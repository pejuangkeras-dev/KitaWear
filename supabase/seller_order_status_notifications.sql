-- Seller fulfillment workflow: seller may process/ship/cancel.
-- Completion is reserved for buyer confirmation after all shipments are delivered.

create or replace function public.seller_update_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
    raise exception 'Akses ditolak. Akun bukan seller.'; end if;

  if v_status='delivered' then v_status='shipped'; end if;
  if v_status not in ('processing','shipped','cancelled') then
    raise exception 'Status seller tidak valid. Penyelesaian order dilakukan oleh buyer setelah barang diterima.'; end if;

  select o.payment_status,o.order_number,o.buyer_id
    into v_payment,v_order_number,v_buyer_id
  from public.orders o where o.id=p_order_id for update;
  if not found then raise exception 'Pesanan tidak ditemukan.'; end if;

  if v_payment<>'paid'::public.payment_status and v_status in ('processing','shipped') then
    raise exception 'Pesanan belum dibayar.'; end if;

  select os.id,os.seller_status,os.shipping_status
    into v_split
  from public.order_sellers os
  join public.stores s on s.id=os.store_id
  where os.order_id=p_order_id and s.owner_id=v_user for update;
  if not found then raise exception 'Pesanan tidak ditemukan atau bukan milik toko Anda.'; end if;

  v_old_status := coalesce(v_split.seller_status,'pending');

  if v_status='processing' and v_split.seller_status not in ('pending','paid','processing') then
    raise exception 'Toko Anda tidak dapat masuk ke status diproses dari status saat ini.'; end if;
  if v_status='shipped' and v_split.seller_status<>'processing' then
    raise exception 'Toko Anda harus memproses pesanan sebelum mengirim.'; end if;
  if v_status='cancelled' and v_split.seller_status not in ('pending','paid','processing') then
    raise exception 'Toko Anda tidak dapat membatalkan pesanan dari status saat ini.'; end if;

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
    else v_split.shipping_status end;

  select
    bool_and(seller_status in ('processing','shipped')) as all_processing,
    bool_and(seller_status='shipped') as all_shipped,
    bool_and(seller_status='cancelled') as all_cancelled
  into v_all_processing,v_all_shipped,v_all_cancelled
  from public.order_sellers where order_id=p_order_id;

  if v_all_cancelled then
    update public.orders set status='cancelled',shipping_status='cancelled',updated_at=now()
    where id=p_order_id and payment_status='paid';
  elsif v_all_shipped then
    update public.orders set status='shipped',shipping_status='shipped',
      shipped_at=coalesce(shipped_at,now()),updated_at=now()
    where id=p_order_id and payment_status='paid';
  elsif v_all_processing then
    update public.orders set status='processing',shipping_status='processing',
      processing_at=coalesce(processing_at,now()),updated_at=now()
    where id=p_order_id and payment_status='paid';
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
    v_message := format('Seller membatalkan pesanan %s. Hubungi MarketKita jika membutuhkan bantuan.',v_order_number);
  end if;

  if v_title is not null and v_buyer_id is not null then
    insert into public.notifications(user_id,type,title,message,link)
    values(v_buyer_id,'order',v_title,v_message,'?account=orders');
  end if;

  return jsonb_build_object('ok',true,'order_id',p_order_id,'seller_order_seller_id',v_split.id,
    'previous_seller_status',v_old_status,'seller_status',v_status,'shipping_status',v_shipping_status);
end;
$function$;

revoke execute on function public.seller_update_order_status(uuid,text) from anon;
grant execute on function public.seller_update_order_status(uuid,text) to authenticated;
