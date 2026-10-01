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


-- Financial/dispute/review hardening additions applied on 2026-10-01.
create table if not exists public.seller_payout_requests (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id),
  amount integer not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  note text,
  admin_note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz
);
alter table public.seller_payout_requests enable row level security;
drop policy if exists payout_requests_seller_select on public.seller_payout_requests;
create policy payout_requests_seller_select on public.seller_payout_requests for select to authenticated using (seller_id=(select auth.uid()) or public.is_admin());
drop policy if exists payout_requests_admin_all on public.seller_payout_requests;
create policy payout_requests_admin_all on public.seller_payout_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.seller_request_payout(p_amount integer,p_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_user uuid := (select auth.uid()); v_available integer; v_request uuid;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;
  if not exists(select 1 from public.profiles where id=v_user and role='seller') then raise exception 'Akses ditolak. Akun bukan seller.'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Nominal payout tidak valid.'; end if;
  select coalesce(sum(net_amount),0)::integer into v_available from public.seller_payouts where seller_id=v_user and status='eligible';
  if p_amount>v_available then raise exception 'Saldo tersedia tidak mencukupi. Saldo tersedia: %',v_available; end if;
  if exists(select 1 from public.seller_payout_requests where seller_id=v_user and status in ('pending','approved')) then raise exception 'Masih ada permintaan payout yang sedang diproses.'; end if;
  insert into public.seller_payout_requests(seller_id,amount,note) values(v_user,p_amount,left(nullif(trim(coalesce(p_note,'')),''),500)) returning id into v_request;
  return jsonb_build_object('ok',true,'request_id',v_request,'amount',p_amount,'available',v_available);
end;$function$;

create or replace function public.admin_review_payout_request(p_request_id uuid,p_decision text,p_admin_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_req public.seller_payout_requests%rowtype; v_consumed integer:=0; v_payout record;
begin
  if not public.is_admin() then raise exception 'Akses ditolak: hanya admin.'; end if;
  if lower(p_decision) not in ('approved','rejected','paid') then raise exception 'Keputusan payout tidak valid.'; end if;
  select * into v_req from public.seller_payout_requests where id=p_request_id for update;
  if not found then raise exception 'Permintaan payout tidak ditemukan.'; end if;
  if lower(p_decision)='approved' and v_req.status<>'pending' then raise exception 'Hanya payout pending yang dapat disetujui.'; end if;
  if lower(p_decision)='rejected' and v_req.status not in ('pending','approved') then raise exception 'Payout sudah selesai diproses.'; end if;
  if lower(p_decision)='paid' and v_req.status<>'approved' then raise exception 'Payout harus disetujui sebelum ditandai paid.'; end if;

  if lower(p_decision)='paid' then
    for v_payout in select id,net_amount from public.seller_payouts where seller_id=v_req.seller_id and status='eligible' order by created_at,id for update loop
      if v_consumed+v_payout.net_amount<=v_req.amount then
        update public.seller_payouts set status='paid',paid_at=now() where id=v_payout.id;
        v_consumed:=v_consumed+v_payout.net_amount;
      end if;
      exit when v_consumed=v_req.amount;
    end loop;
    if v_consumed<>v_req.amount then raise exception 'Saldo eligible tidak dapat dicocokkan tepat dengan nominal payout.'; end if;
  end if;

  update public.seller_payout_requests set status=lower(p_decision),admin_note=left(nullif(trim(coalesce(p_admin_note,'')),''),1000),reviewed_at=case when lower(p_decision) in ('approved','rejected') then now() else reviewed_at end,paid_at=case when lower(p_decision)='paid' then now() else paid_at end where id=p_request_id;
  insert into public.notifications(user_id,type,title,message,link) values(v_req.seller_id,'payout',case lower(p_decision) when 'approved' then 'Payout disetujui' when 'paid' then 'Payout dibayar' else 'Payout ditolak' end,case lower(p_decision) when 'approved' then 'Permintaan payout Anda telah disetujui.' when 'paid' then 'Payout Anda telah ditandai sebagai dibayar.' else 'Permintaan payout Anda ditolak.' end,'/seller.html');
  return jsonb_build_object('ok',true,'request_id',p_request_id,'status',lower(p_decision));
end;$function$;

create or replace function public.admin_resolve_dispute(p_dispute_id uuid,p_resolution text,p_admin_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_dispute public.disputes%rowtype;
begin
  if not public.is_admin() then raise exception 'Akses ditolak: hanya admin.'; end if;
  if lower(p_resolution) not in ('resolved_buyer','resolved_seller','closed') then raise exception 'Resolusi sengketa tidak valid.'; end if;
  select * into v_dispute from public.disputes where id=p_dispute_id for update;
  if not found then raise exception 'Sengketa tidak ditemukan.'; end if;
  update public.disputes set status=lower(p_resolution),resolved_at=case when lower(p_resolution) in ('resolved_buyer','resolved_seller') then now() else resolved_at end where id=p_dispute_id;
  if lower(p_resolution)='resolved_buyer' then
    update public.orders set status='refunded'::public.order_status,payment_status='refunded'::public.payment_status,updated_at=now() where id=v_dispute.order_id;
    update public.seller_payouts set status='refunded'::public.payout_status where order_id=v_dispute.order_id and status in ('pending','eligible');
  end if;
  insert into public.notifications(user_id,type,title,message,link) values(v_dispute.buyer_id,'dispute','Sengketa diperbarui',case lower(p_resolution) when 'resolved_buyer' then 'Sengketa Anda diselesaikan untuk pembeli.' when 'resolved_seller' then 'Sengketa Anda diselesaikan untuk seller.' else 'Sengketa Anda telah ditutup.' end,'/#akun');
  return jsonb_build_object('ok',true,'dispute_id',p_dispute_id,'status',lower(p_resolution));
end;$function$;

create or replace function public.buyer_create_product_review(p_order_item_id uuid,p_rating integer,p_comment text default null)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_user uuid := (select auth.uid()); v_item record; v_id uuid;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;
  if p_rating not between 1 and 5 then raise exception 'Rating harus 1 sampai 5.'; end if;
  select oi.*,o.buyer_id,o.status as order_status into v_item from public.order_items oi join public.orders o on o.id=oi.order_id where oi.id=p_order_item_id and o.buyer_id=v_user;
  if not found then raise exception 'Item order tidak ditemukan.'; end if;
  if v_item.order_status<>'completed'::public.order_status then raise exception 'Review hanya dapat diberikan setelah pesanan selesai.'; end if;
  if exists(select 1 from public.product_reviews where order_id=v_item.order_id and product_id=v_item.product_id and reviewer_id=v_user) then raise exception 'Produk ini sudah Anda review untuk pesanan tersebut.'; end if;
  insert into public.product_reviews(reviewer_id,reviewer_name,order_id,store_id,product_id,product_name,rating,comment) select v_user,p.full_name,v_item.order_id,v_item.store_id,v_item.product_id,v_item.product_name,p_rating,left(nullif(trim(coalesce(p_comment,'')),''),1000) from public.profiles p where p.id=v_user returning id into v_id;
  return jsonb_build_object('ok',true,'review_id',v_id);
end;$function$;

create or replace function public.buyer_create_seller_review(p_order_id uuid,p_store_id uuid,p_rating integer,p_comment text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_user uuid := (select auth.uid()); v_id uuid; v_name text;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;
  if p_rating not between 1 and 5 then raise exception 'Rating harus 1 sampai 5.'; end if;
  if char_length(trim(coalesce(p_comment,''))) not between 3 and 1000 then raise exception 'Komentar harus 3-1000 karakter.'; end if;
  if not exists(select 1 from public.orders o join public.order_items oi on oi.order_id=o.id where o.id=p_order_id and o.buyer_id=v_user and o.status='completed'::public.order_status and oi.store_id=p_store_id) then raise exception 'Anda belum memiliki transaksi selesai dengan toko ini.'; end if;
  if exists(select 1 from public.seller_reviews where order_id=p_order_id and store_id=p_store_id and reviewer_id=v_user) then raise exception 'Toko ini sudah Anda review untuk pesanan tersebut.'; end if;
  select full_name into v_name from public.profiles where id=v_user;
  insert into public.seller_reviews(reviewer_id,reviewer_name,order_id,store_id,rating,comment) values(v_user,coalesce(v_name,'Pembeli'),p_order_id,p_store_id,p_rating,trim(p_comment)) returning id into v_id;
  return jsonb_build_object('ok',true,'review_id',v_id);
end;$function$;

revoke execute on function public.seller_request_payout(integer,text) from public,anon;
grant execute on function public.seller_request_payout(integer,text) to authenticated;
revoke execute on function public.admin_review_payout_request(uuid,text,text) from public,anon;
grant execute on function public.admin_review_payout_request(uuid,text,text) to authenticated;
revoke execute on function public.admin_resolve_dispute(uuid,text,text) from public,anon;
grant execute on function public.admin_resolve_dispute(uuid,text,text) to authenticated;
revoke execute on function public.buyer_create_product_review(uuid,integer,text) from public,anon;
grant execute on function public.buyer_create_product_review(uuid,integer,text) to authenticated;
revoke execute on function public.buyer_create_seller_review(uuid,uuid,integer,text) from public,anon;
grant execute on function public.buyer_create_seller_review(uuid,uuid,integer,text) to authenticated;

create or replace function public.create_order_payouts(p_order_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_order record; v_item record; v_store record; v_seller_split record; v_item_fee integer;
begin
  select id,payment_status into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan.'; end if;
  if v_order.payment_status<>'paid' then raise exception 'Payout hanya dapat dibuat untuk order paid.'; end if;
  for v_item in select oi.id,oi.order_id,oi.store_id,oi.line_total from public.order_items oi where oi.order_id=p_order_id order by oi.id loop
    select s.id,s.owner_id into v_store from public.stores s where s.id=v_item.store_id and s.status='active';
    if not found then raise exception 'Toko untuk item order tidak ditemukan atau tidak aktif.'; end if;
    select os.subtotal,os.platform_fee into v_seller_split from public.order_sellers os where os.order_id=p_order_id and os.store_id=v_item.store_id limit 1;
    v_item_fee:=case when coalesce(v_seller_split.subtotal,0)>0 then floor((coalesce(v_seller_split.platform_fee,0)::numeric*v_item.line_total::numeric)/v_seller_split.subtotal::numeric)::integer else 0 end;
    insert into public.seller_payouts(order_item_id,seller_id,store_id,order_id,gross_amount,platform_fee,net_amount,status) values(v_item.id,v_store.owner_id,v_item.store_id,p_order_id,v_item.line_total,v_item_fee,greatest(0,v_item.line_total-v_item_fee),'pending') on conflict(order_item_id) do update set seller_id=excluded.seller_id,store_id=excluded.store_id,gross_amount=excluded.gross_amount,platform_fee=excluded.platform_fee,net_amount=excluded.net_amount where seller_payouts.status='pending';
  end loop;
end;$function$;
revoke execute on function public.create_order_payouts(uuid) from public,anon,authenticated;
grant execute on function public.create_order_payouts(uuid) to service_role;

create or replace function public.admin_resolve_dispute_service(p_dispute_id uuid,p_resolution text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_dispute public.disputes%rowtype;
begin
  if lower(p_resolution) not in ('resolved_buyer','resolved_seller','closed','reviewing') then raise exception 'Resolusi sengketa tidak valid.'; end if;
  select * into v_dispute from public.disputes where id=p_dispute_id for update;
  if not found then raise exception 'Sengketa tidak ditemukan.'; end if;
  update public.disputes set status=lower(p_resolution),resolved_at=case when lower(p_resolution) in ('resolved_buyer','resolved_seller') then now() else resolved_at end where id=p_dispute_id;
  if lower(p_resolution)='resolved_buyer' then
    update public.orders set status='refunded'::public.order_status,payment_status='refunded'::public.payment_status,updated_at=now() where id=v_dispute.order_id;
    update public.seller_payouts set status='refunded'::public.payout_status where order_id=v_dispute.order_id and status in ('pending','eligible');
  end if;
  insert into public.notifications(user_id,type,title,message,link)
  values(v_dispute.buyer_id,'dispute','Sengketa diperbarui',
    case lower(p_resolution) when 'resolved_buyer' then 'Refund sengketa telah diproses.' when 'resolved_seller' then 'Sengketa diselesaikan untuk seller.' when 'reviewing' then 'Refund sedang diproses.' else 'Sengketa telah ditutup.' end,'/#akun');
  return jsonb_build_object('ok',true,'dispute_id',p_dispute_id,'status',lower(p_resolution));
end;$function$;
revoke execute on function public.admin_resolve_dispute_service(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_resolve_dispute_service(uuid,text) to service_role;


-- Stock restoration for paid orders that are fully refunded/cancelled.
alter table public.orders add column if not exists stock_restored_at timestamptz;

create or replace function public.restore_order_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path=public
as $function$
declare v_order record; v_item record;
begin
  select id,payment_status,stock_decremented_at,stock_restored_at into v_order
  from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan.'; end if;
  if v_order.stock_decremented_at is null or v_order.stock_restored_at is not null then return; end if;
  if v_order.payment_status not in ('refunded','cancelled','failed','expired') then
    raise exception 'Stok hanya dapat dikembalikan untuk order yang dibatalkan/refund.';
  end if;
  for v_item in select product_id,size,quantity from public.order_items where order_id=p_order_id order by id for update loop
    update public.product_sizes set stock=stock+v_item.quantity
    where product_id=v_item.product_id and upper(size)=upper(v_item.size);
    if not found then raise exception 'Ukuran % tidak ditemukan untuk produk %.',v_item.size,v_item.product_id; end if;
  end loop;
  update public.orders set stock_restored_at=now(),updated_at=now() where id=p_order_id;
end;$function$;
revoke all on function public.restore_order_stock(uuid) from public,anon,authenticated;
grant execute on function public.restore_order_stock(uuid) to service_role;

create or replace function public.admin_resolve_dispute_service(p_dispute_id uuid,p_resolution text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_dispute public.disputes%rowtype;
begin
  if lower(p_resolution) not in ('resolved_buyer','resolved_seller','closed','reviewing') then raise exception 'Resolusi sengketa tidak valid.'; end if;
  select * into v_dispute from public.disputes where id=p_dispute_id for update;
  if not found then raise exception 'Sengketa tidak ditemukan.'; end if;
  update public.disputes set status=lower(p_resolution),resolved_at=case when lower(p_resolution) in ('resolved_buyer','resolved_seller') then now() else resolved_at end where id=p_dispute_id;
  if lower(p_resolution)='resolved_buyer' then
    update public.orders set status='refunded'::public.order_status,payment_status='refunded'::public.payment_status,updated_at=now() where id=v_dispute.order_id;
    perform public.restore_order_stock(v_dispute.order_id);
    update public.seller_payouts set status='refunded'::public.payout_status where order_id=v_dispute.order_id and status in ('pending','eligible');
  end if;
  insert into public.notifications(user_id,type,title,message,link)
  values(v_dispute.buyer_id,'dispute','Sengketa diperbarui',
    case lower(p_resolution) when 'resolved_buyer' then 'Refund sengketa telah diproses.' when 'resolved_seller' then 'Sengketa diselesaikan untuk seller.' when 'reviewing' then 'Refund sedang diproses.' else 'Sengketa telah ditutup.' end,'/#akun');
  return jsonb_build_object('ok',true,'dispute_id',p_dispute_id,'status',lower(p_resolution));
end;$function$;
revoke all on function public.admin_resolve_dispute_service(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_resolve_dispute_service(uuid,text) to service_role;


-- Fulfillment/payment hardening applied on 2026-10-01.
-- Sellers and admins cannot move an unpaid order into fulfillment states.
-- Tracking numbers are only accepted after payment and processing/shipping.
create or replace function public.seller_update_order_status(p_order_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_status text := lower(trim(coalesce(p_status,'')));
  v_current public.order_status;
  v_payment public.payment_status;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;
  if not exists(select 1 from public.profiles where id=v_user and role='seller') then
    raise exception 'Akses ditolak. Akun bukan seller.';
  end if;
  if not exists(
    select 1 from public.order_items oi join public.stores s on s.id=oi.store_id
    where oi.order_id=p_order_id and s.owner_id=v_user
  ) then raise exception 'Pesanan tidak ditemukan atau bukan milik toko Anda.'; end if;
  if exists(
    select 1 from public.order_items oi
    left join public.stores s on s.id=oi.store_id
    where oi.order_id=p_order_id
      and coalesce(s.owner_id,'00000000-0000-0000-0000-000000000000'::uuid)<>v_user
  ) then raise exception 'Pesanan ini berisi toko lain dan tidak dapat diubah oleh seller ini.'; end if;

  if v_status='delivered' then v_status='completed'; end if;
  if v_status not in ('processing','shipped','completed','cancelled') then
    raise exception 'Status seller tidak valid.';
  end if;

  select status,payment_status into v_current,v_payment
  from public.orders where id=p_order_id for update;
  if not found then raise exception 'Pesanan tidak ditemukan.'; end if;

  if v_status in ('processing','shipped','completed') and v_payment<>'paid'::public.payment_status then
    raise exception 'Pesanan belum dibayar. Seller hanya dapat memproses pesanan yang sudah paid.';
  end if;
  if v_status='processing' and v_current<>'paid'::public.order_status then
    raise exception 'Pesanan hanya dapat diproses dari status Paid.';
  end if;
  if v_status='shipped' and v_current<>'processing'::public.order_status then
    raise exception 'Pesanan hanya dapat dikirim setelah diproses.';
  end if;
  if v_status='completed' and v_current<>'shipped'::public.order_status then
    raise exception 'Pesanan hanya dapat diselesaikan setelah dikirim.';
  end if;
  if v_status='cancelled' and v_current not in ('pending_payment'::public.order_status,'paid'::public.order_status,'processing'::public.order_status) then
    raise exception 'Pesanan tidak dapat dibatalkan dari status saat ini.';
  end if;

  update public.orders set
    status=v_status::public.order_status,
    processing_at=case when v_status='processing' and processing_at is null then now() else processing_at end,
    shipped_at=case when v_status='shipped' and shipped_at is null then now() else shipped_at end,
    delivered_at=case when v_status='completed' and delivered_at is null then now() else delivered_at end,
    completed_at=case when v_status='completed' and completed_at is null then now() else completed_at end,
    updated_at=now()
  where id=p_order_id;

  update public.order_sellers set
    seller_status=case when v_status='processing' then 'processing' when v_status='shipped' then 'shipped' when v_status='completed' then 'completed' when v_status='cancelled' then 'cancelled' else seller_status end,
    shipping_status=case when v_status='shipped' then 'shipped' when v_status='completed' then 'delivered' when v_status='cancelled' then 'cancelled' else shipping_status end,
    updated_at=now()
  where order_id=p_order_id;

  return jsonb_build_object('ok',true,'order_id',p_order_id,'status',v_status);
end;
$function$;

create or replace function public.admin_update_order_status(p_order_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_role text; v_payment public.payment_status;
begin
  select role into v_role from public.profiles where id=(select auth.uid());
  if v_role is distinct from 'admin' then
    raise exception 'Akses ditolak. Hanya admin yang dapat mengubah status pesanan.';
  end if;
  if p_status not in ('pending_payment','paid','processing','shipped','delivered','completed','cancelled','refunded','disputed') then
    raise exception 'Status order tidak valid: %',p_status;
  end if;
  select payment_status into v_payment from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan: %',p_order_id; end if;
  if p_status in ('processing','shipped','delivered','completed') and v_payment<>'paid'::public.payment_status then
    raise exception 'Order belum dibayar. Status % hanya boleh setelah payment_status=paid.',p_status;
  end if;
  update public.orders set status=p_status::public.order_status,updated_at=now() where id=p_order_id;
  return jsonb_build_object('ok',true,'order_id',p_order_id,'status',p_status);
end;
$function$;

create or replace function public.seller_set_tracking_number(p_order_id uuid, p_tracking_number text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_user uuid := (select auth.uid()); v_tracking text := trim(coalesce(p_tracking_number,'')); v_count integer; v_status public.order_status; v_payment public.payment_status;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;
  if not exists(select 1 from public.profiles where id=v_user and role='seller') then
    raise exception 'Akses ditolak. Akun bukan seller.'; end if;
  if v_tracking='' then raise exception 'Nomor resi wajib diisi.'; end if;
  if length(v_tracking)>120 then raise exception 'Nomor resi terlalu panjang.'; end if;
  if not exists(
    select 1 from public.order_items oi join public.stores s on s.id=oi.store_id
    where oi.order_id=p_order_id and s.owner_id=v_user
  ) then raise exception 'Pesanan tidak ditemukan atau bukan milik toko Anda.'; end if;

  select status,payment_status into v_status,v_payment from public.orders where id=p_order_id for update;
  if not found then raise exception 'Pesanan tidak ditemukan.'; end if;
  if v_payment<>'paid'::public.payment_status then
    raise exception 'Resi hanya dapat dipasang untuk pesanan yang sudah dibayar.';
  end if;
  if v_status not in ('processing'::public.order_status,'shipped'::public.order_status) then
    raise exception 'Resi hanya dapat dipasang setelah pesanan diproses atau dikirim.';
  end if;

  select count(*) into v_count
  from public.order_items oi join public.stores s on s.id=oi.store_id
  where oi.order_id=p_order_id and s.owner_id=v_user;

  update public.order_sellers os
  set tracking_number=v_tracking,
      shipping_status=case when v_status='shipped'::public.order_status then 'shipped' else os.shipping_status end,
      updated_at=now()
  where os.order_id=p_order_id
    and exists(select 1 from public.stores s where s.id=os.store_id and s.owner_id=v_user);

  if not found then raise exception 'Data pengiriman toko tidak ditemukan.'; end if;

  update public.orders o
  set tracking_number=case when v_count=1 then v_tracking else o.tracking_number end,
      shipping_status=case when v_status='shipped'::public.order_status then 'shipped' else o.shipping_status end,
      updated_at=now()
  where o.id=p_order_id;

  return jsonb_build_object('ok',true,'order_id',p_order_id,'tracking_number',v_tracking);
end;
$function$;

revoke execute on function public.seller_update_order_status(uuid,text) from public,anon;
grant execute on function public.seller_update_order_status(uuid,text) to authenticated;
revoke execute on function public.admin_update_order_status(uuid,text) from public,anon;
grant execute on function public.admin_update_order_status(uuid,text) to authenticated;
revoke execute on function public.seller_set_tracking_number(uuid,text) from public,anon;
grant execute on function public.seller_set_tracking_number(uuid,text) to authenticated;


-- Marketplace stock reservation hardening applied on 2026-10-01.
-- Reservations protect product-size stock while a Midtrans transaction is pending.
alter table public.product_sizes
  add column if not exists reserved_stock integer not null default 0;

alter table public.product_sizes
  add constraint product_sizes_reserved_stock_nonnegative
  check (reserved_stock >= 0);

create table if not exists public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  product_id uuid not null references public.products(id),
  size text not null,
  quantity integer not null check (quantity > 0),
  status text not null default 'reserved' check (status in ('reserved','finalized','released','expired')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_item_id)
);

create index if not exists stock_reservations_order_idx on public.stock_reservations(order_id,status);
create index if not exists stock_reservations_expiry_idx on public.stock_reservations(status,expires_at);

alter table public.stock_reservations enable row level security;
drop policy if exists stock_reservations_buyer_select on public.stock_reservations;
create policy stock_reservations_buyer_select on public.stock_reservations
for select to authenticated using (
  exists(select 1 from public.orders o where o.id=stock_reservations.order_id and o.buyer_id=(select auth.uid()))
);
revoke all on public.stock_reservations from anon,authenticated;
grant select on public.stock_reservations to authenticated;

create or replace function public.reserve_order_stock(p_order_id uuid,p_minutes integer default 1440)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_order record; v_item record; v_size record; v_reserved integer:=0; v_minutes integer:=greatest(5,least(coalesce(p_minutes,1440),10080));
begin
  select id,status,payment_status,stock_decremented_at into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan.'; end if;
  if v_order.status<>'pending_payment'::public.order_status or v_order.payment_status<>'pending'::public.payment_status then
    raise exception 'Reservation hanya dapat dibuat untuk order pending_payment.';
  end if;
  if v_order.stock_decremented_at is not null then raise exception 'Stok order sudah difinalisasi.'; end if;
  if exists(select 1 from public.stock_reservations where order_id=p_order_id and status='reserved') then
    return jsonb_build_object('ok',true,'order_id',p_order_id,'already_reserved',true);
  end if;
  for v_item in select id,product_id,size,quantity from public.order_items where order_id=p_order_id order by id loop
    select id,stock,reserved_stock into v_size from public.product_sizes
    where product_id=v_item.product_id and upper(size)=upper(v_item.size) for update;
    if not found then raise exception 'Ukuran % tidak ditemukan untuk produk %.',v_item.size,v_item.product_id; end if;
    if v_size.stock-v_size.reserved_stock<v_item.quantity then
      raise exception 'Stok % ukuran % tidak mencukupi. Tersedia %.',v_item.product_id,v_item.size,greatest(0,v_size.stock-v_size.reserved_stock);
    end if;
    update public.product_sizes set reserved_stock=reserved_stock+v_item.quantity where id=v_size.id;
    insert into public.stock_reservations(order_id,order_item_id,product_id,size,quantity,status,expires_at)
    values(p_order_id,v_item.id,v_item.product_id,v_item.size,v_item.quantity,'reserved',now()+(v_minutes||' minutes')::interval);
    v_reserved:=v_reserved+v_item.quantity;
  end loop;
  return jsonb_build_object('ok',true,'order_id',p_order_id,'reserved_items',v_reserved,'expires_at',now()+(v_minutes||' minutes')::interval);
end;$function$;

create or replace function public.finalize_order_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_order record; v_item record; v_size record; v_reservation record;
begin
  select id,payment_status,stock_decremented_at into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan.'; end if;
  if v_order.payment_status<>'paid'::public.payment_status then raise exception 'Stok hanya dapat difinalisasi untuk order paid.'; end if;
  if v_order.stock_decremented_at is not null then return; end if;
  for v_item in select id,product_id,size,quantity from public.order_items where order_id=p_order_id order by id loop
    select * into v_reservation from public.stock_reservations where order_item_id=v_item.id for update;
    select id,stock,reserved_stock into v_size from public.product_sizes
    where product_id=v_item.product_id and upper(size)=upper(v_item.size) for update;
    if not found then raise exception 'Ukuran % tidak ditemukan untuk produk %.',v_item.size,v_item.product_id; end if;
    if v_reservation.id is not null and v_reservation.status='reserved' then
      update public.product_sizes set stock=stock-v_item.quantity,reserved_stock=greatest(0,reserved_stock-v_item.quantity)
      where id=v_size.id and stock>=v_item.quantity;
      if not found then raise exception 'Stok % ukuran % tidak mencukupi saat finalisasi.',v_item.product_id,v_item.size; end if;
      update public.stock_reservations set status='finalized',finalized_at=now() where id=v_reservation.id;
    else
      update public.product_sizes set stock=stock-v_item.quantity where id=v_size.id and stock>=v_item.quantity;
      if not found then raise exception 'Stok % ukuran % tidak mencukupi.',v_item.product_id,v_item.size; end if;
    end if;
  end loop;
  update public.orders set stock_decremented_at=now(),updated_at=now() where id=p_order_id;
end;$function$;

create or replace function public.release_order_stock_reservation(p_order_id uuid,p_reason text default 'released')
returns void language plpgsql security definer set search_path=''
as $function$
declare v_order record; v_reservation record; v_size record; v_status text:=case when lower(coalesce(p_reason,''))='expired' then 'expired' else 'released' end;
begin
  select id,payment_status,stock_decremented_at into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.stock_decremented_at is not null or v_order.payment_status='paid'::public.payment_status then return; end if;
  for v_reservation in select id,product_id,size,quantity from public.stock_reservations where order_id=p_order_id and status='reserved' order by id for update loop
    select id,reserved_stock into v_size from public.product_sizes where product_id=v_reservation.product_id and upper(size)=upper(v_reservation.size) for update;
    if found then update public.product_sizes set reserved_stock=greatest(0,reserved_stock-v_reservation.quantity) where id=v_size.id; end if;
    update public.stock_reservations set status=v_status,released_at=now() where id=v_reservation.id;
  end loop;
end;$function$;

create or replace function public.release_expired_stock_reservations()
returns integer language plpgsql security definer set search_path=''
as $function$
declare v_order_id uuid; v_count integer:=0;
begin
  for v_order_id in select distinct order_id from public.stock_reservations where status='reserved' and expires_at<=now() order by order_id for update loop
    perform public.release_order_stock_reservation(v_order_id,'expired');
    v_count:=v_count+1;
  end loop;
  return v_count;
end;$function$;

revoke all on function public.reserve_order_stock(uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_order_stock(uuid,integer) to service_role;
revoke all on function public.finalize_order_stock(uuid) from public,anon,authenticated;
grant execute on function public.finalize_order_stock(uuid) to service_role;
revoke all on function public.release_order_stock_reservation(uuid,text) from public,anon,authenticated;
grant execute on function public.release_order_stock_reservation(uuid,text) to service_role;
revoke all on function public.release_expired_stock_reservations() from public,anon,authenticated;
grant execute on function public.release_expired_stock_reservations() to service_role;

create or replace function private.release_order_reservation_on_status_change()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.payment_status in ('failed'::public.payment_status,'expired'::public.payment_status,'refunded'::public.payment_status)
     or new.status in ('cancelled'::public.order_status,'refunded'::public.order_status)
  then perform public.release_order_stock_reservation(new.id,'released'); end if;
  return new;
end;$function$;

drop trigger if exists trg_release_order_reservation_on_status_change on public.orders;
create trigger trg_release_order_reservation_on_status_change
after update of status,payment_status on public.orders for each row
execute function private.release_order_reservation_on_status_change();

create or replace function public.decrement_order_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path='public'
as $function$
declare v_order record; v_item record; v_size record;
begin
  select id,payment_status,stock_decremented_at into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan.'; end if;
  if v_order.payment_status<>'paid' then raise exception 'Stok hanya dapat dikurangi untuk order yang sudah paid.'; end if;
  if v_order.stock_decremented_at is not null then return; end if;
  if exists(select 1 from public.stock_reservations where order_id=p_order_id and status='reserved') then
    perform public.finalize_order_stock(p_order_id); return;
  end if;
  for v_item in select product_id,size,quantity from public.order_items where order_id=p_order_id order by id loop
    select id,stock into v_size from public.product_sizes where product_id=v_item.product_id and upper(size)=upper(v_item.size) for update;
    if not found then raise exception 'Ukuran % tidak ditemukan untuk produk %.',v_item.size,v_item.product_id; end if;
    update public.product_sizes set stock=stock-v_item.quantity where id=v_size.id and stock>=v_item.quantity;
    if not found then raise exception 'Stok % ukuran % tidak mencukupi.',v_item.product_id,v_item.size; end if;
  end loop;
  update public.orders set stock_decremented_at=now(),updated_at=now() where id=p_order_id;
end;$function$;

revoke all on function public.decrement_order_stock(uuid) from public,anon,authenticated;
grant execute on function public.decrement_order_stock(uuid) to service_role;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('marketkita-release-expired-stock','*/10 * * * *',$$select public.release_expired_stock_reservations();$$);
