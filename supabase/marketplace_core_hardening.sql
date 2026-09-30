-- MarketKita marketplace core hardening — 2026-10-01
-- Applied to Supabase project eczozutsjwvkfgpyccou.
-- Keep this file as the reproducible SQL for the production database.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

drop policy if exists order_sellers_buyer_read on public.order_sellers;
create policy order_sellers_buyer_read
on public.order_sellers for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_sellers.order_id
      and o.buyer_id = (select auth.uid())
  )
);

drop policy if exists order_sellers_seller_read on public.order_sellers;
create policy order_sellers_seller_read
on public.order_sellers for select to authenticated
using (seller_id = (select auth.uid()));

create unique index if not exists seller_applications_one_pending_per_user
on public.seller_applications (user_id) where status = 'pending';

revoke execute on function public.admin_review_seller_application(uuid,text) from public, anon;
grant execute on function public.admin_review_seller_application(uuid,text) to authenticated;

revoke execute on function public.buyer_confirm_order_received(uuid) from public, anon;
grant execute on function public.buyer_confirm_order_received(uuid) to authenticated;

revoke execute on function public.create_order_payouts(uuid) from public, anon, authenticated;
grant execute on function public.create_order_payouts(uuid) to service_role;

revoke execute on function public.admin_update_order_status(uuid,text) from public, anon;
grant execute on function public.admin_update_order_status(uuid,text) to authenticated;

revoke execute on function public.seller_update_order_status(uuid,text) from public, anon;
grant execute on function public.seller_update_order_status(uuid,text) to authenticated;

revoke execute on function public.seller_set_tracking_number(uuid,text) from public, anon;
grant execute on function public.seller_set_tracking_number(uuid,text) to authenticated;

revoke execute on function public.get_seller_order_items(uuid) from public, anon;
grant execute on function public.get_seller_order_items(uuid) to authenticated;

create or replace function public.create_order_payouts(p_order_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
declare
  v_order record;
  v_item record;
  v_store record;
  v_fee integer := 0;
begin
  select id, payment_status into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan.'; end if;
  if v_order.payment_status <> 'paid' then raise exception 'Payout hanya dapat dibuat untuk order paid.'; end if;

  for v_item in
    select oi.id, oi.order_id, oi.store_id, oi.line_total
    from public.order_items oi where oi.order_id = p_order_id order by oi.id
  loop
    select id, owner_id into v_store
    from public.stores where id = v_item.store_id and status = 'active';
    if not found then raise exception 'Toko untuk item order tidak ditemukan atau tidak aktif.'; end if;

    insert into public.seller_payouts
      (order_item_id,seller_id,store_id,order_id,gross_amount,platform_fee,net_amount,status)
    values
      (v_item.id,v_store.owner_id,v_item.store_id,p_order_id,v_item.line_total,v_fee,v_item.line_total-v_fee,'pending')
    on conflict (order_item_id) do nothing;
  end loop;
end;
$function$;

create or replace function public.buyer_confirm_order_received(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_current public.order_status;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;

  select status into v_current from public.orders
  where id = p_order_id and buyer_id = v_user for update;

  if not found then raise exception 'Pesanan tidak ditemukan.'; end if;
  if v_current <> 'shipped'::public.order_status then
    raise exception 'Pesanan belum berada pada tahap dikirim.';
  end if;

  update public.orders
  set status='completed'::public.order_status,
      delivered_at=coalesce(delivered_at,now()),
      completed_at=coalesce(completed_at,now()),
      shipping_status='delivered',
      updated_at=now()
  where id=p_order_id and buyer_id=v_user;

  update public.order_sellers
  set shipping_status='delivered',seller_status='completed',updated_at=now()
  where order_id=p_order_id;

  update public.seller_payouts
  set status='eligible'
  where order_id=p_order_id and status='pending';

  return jsonb_build_object('ok',true,'order_id',p_order_id,'status','completed');
end;
$function$;

create or replace function private.notify_seller_application_change()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    insert into public.notifications(user_id,type,title,message,link)
    values (
      new.user_id,'seller_application',
      case when new.status='approved' then 'Pengajuan seller disetujui' else 'Pengajuan seller ditolak' end,
      case when new.status='approved'
        then 'Toko Anda telah disetujui. Seller Center sekarang sudah dapat digunakan.'
        else 'Pengajuan toko Anda belum disetujui. Silakan periksa kembali data pengajuan.'
      end,
      '/seller.html'
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_notify_seller_application_change on public.seller_applications;
create trigger trg_notify_seller_application_change
after update of status on public.seller_applications for each row
execute function private.notify_seller_application_change();

create or replace function private.notify_order_status_change()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare v_title text; v_message text;
begin
  if new.status is not distinct from old.status and new.payment_status is not distinct from old.payment_status then return new; end if;

  if new.status='paid' then v_title='Pembayaran diterima'; v_message='Pembayaran untuk pesanan '||coalesce(new.order_number,'')||' telah diterima.';
  elsif new.status='processing' then v_title='Pesanan sedang diproses'; v_message='Seller sedang memproses pesanan '||coalesce(new.order_number,'')||'.';
  elsif new.status='shipped' then v_title='Pesanan dikirim'; v_message='Pesanan '||coalesce(new.order_number,'')||' telah dikirim.';
  elsif new.status='delivered' then v_title='Pesanan telah sampai'; v_message='Pesanan '||coalesce(new.order_number,'')||' telah ditandai sampai.';
  elsif new.status='completed' then v_title='Pesanan selesai'; v_message='Pesanan '||coalesce(new.order_number,'')||' telah selesai.';
  elsif new.status='cancelled' then v_title='Pesanan dibatalkan'; v_message='Pesanan '||coalesce(new.order_number,'')||' telah dibatalkan.';
  elsif new.status='refunded' then v_title='Pesanan dikembalikan'; v_message='Pesanan '||coalesce(new.order_number,'')||' telah diproses sebagai refund.';
  elsif new.status='disputed' then v_title='Sengketa pesanan'; v_message='Pesanan '||coalesce(new.order_number,'')||' memiliki sengketa.';
  else return new;
  end if;

  if new.buyer_id is not null then
    insert into public.notifications(user_id,type,title,message,link)
    values(new.buyer_id,'order',v_title,v_message,'/#akun');
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_notify_order_status_change on public.orders;
create trigger trg_notify_order_status_change
after update of status,payment_status on public.orders for each row
execute function private.notify_order_status_change();

create or replace function private.notify_seller_order_status_change()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare v_title text; v_message text; v_order_number text;
begin
  if new.seller_id is null then return new; end if;
  if new.seller_status is not distinct from old.seller_status
     and new.shipping_status is not distinct from old.shipping_status then return new; end if;

  select order_number into v_order_number from public.orders where id=new.order_id;

  if new.seller_status='paid' then v_title='Pesanan baru'; v_message='Pesanan '||coalesce(v_order_number,'')||' sudah dibayar dan menunggu diproses.';
  elsif new.seller_status='processing' then v_title='Pesanan sedang diproses'; v_message='Pesanan '||coalesce(v_order_number,'')||' sedang diproses.';
  elsif new.seller_status='shipped' then v_title='Pesanan dikirim'; v_message='Pesanan '||coalesce(v_order_number,'')||' telah dikirim.';
  elsif new.seller_status='completed' then v_title='Pesanan selesai'; v_message='Pesanan '||coalesce(v_order_number,'')||' telah selesai.';
  else return new;
  end if;

  insert into public.notifications(user_id,type,title,message,link)
  values(new.seller_id,'seller_order',v_title,v_message,'/seller.html');
  return new;
end;
$function$;

drop trigger if exists trg_notify_seller_order_status_change on public.order_sellers;
create trigger trg_notify_seller_order_status_change
after update of seller_status,shipping_status on public.order_sellers for each row
execute function private.notify_seller_order_status_change();

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.notify_seller_application_change() to postgres;
grant execute on function private.notify_order_status_change() to postgres;
grant execute on function private.notify_seller_order_status_change() to postgres;

revoke execute on function public.buyer_create_dispute(uuid,text,text) from public,anon;
grant execute on function public.buyer_create_dispute(uuid,text,text) to authenticated;

revoke execute on function public.claim_voucher(uuid) from public,anon;
grant execute on function public.claim_voucher(uuid) to authenticated;

revoke execute on function public.consume_user_voucher(uuid,uuid) from public,anon,authenticated;
grant execute on function public.consume_user_voucher(uuid,uuid) to service_role;

revoke execute on function public.notify_chat_message() from public,anon,authenticated;
revoke execute on function public.notify_order_status_change() from public,anon,authenticated;

revoke execute on function public.is_admin() from public,anon;
grant execute on function public.is_admin() to authenticated;

revoke execute on function public.is_seller_or_admin() from public,anon;
grant execute on function public.is_seller_or_admin() to authenticated;
