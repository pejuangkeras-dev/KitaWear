-- Priority 6 — Voucher & Promotion E2E hardening
-- Release a consumed voucher when a buyer cancels an unpaid order.
-- The operation is idempotent through release_user_voucher().

create or replace function public.buyer_cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_status public.order_status;
  v_payment public.payment_status;
  v_voucher_id uuid;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;

  select status,payment_status,voucher_id
    into v_status,v_payment,v_voucher_id
  from public.orders
  where id=p_order_id and buyer_id=v_user
  for update;

  if not found then raise exception 'Pesanan tidak ditemukan.'; end if;

  if v_status <> 'pending_payment'::public.order_status
     or v_payment <> 'pending'::public.payment_status then
    raise exception 'Pesanan hanya dapat dibatalkan sebelum pembayaran berhasil.';
  end if;

  update public.orders
  set status='cancelled'::public.order_status,
      payment_status='failed'::public.payment_status,
      shipping_status='cancelled',
      updated_at=now()
  where id=p_order_id and buyer_id=v_user;

  update public.order_sellers
  set seller_status='cancelled',
      shipping_status='cancelled',
      updated_at=now()
  where order_id=p_order_id;

  if v_voucher_id is not null then
    perform public.release_user_voucher(v_voucher_id,v_user);
  end if;

  insert into public.notifications(user_id,type,title,message,link)
  values (
    v_user,
    'order',
    'Pesanan dibatalkan',
    'Pesanan ' || coalesce((select order_number from public.orders where id=p_order_id),'') || ' berhasil dibatalkan sebelum pembayaran.',
    '?account=orders'
  );

  return jsonb_build_object('ok',true,'order_id',p_order_id,'status','cancelled');
end;
$function$;
