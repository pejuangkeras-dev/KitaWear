-- MarketKita P14: Returns & Replacement foundation

create table if not exists public.return_requests(
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  type text not null check(type in ('return_refund','replacement')),
  reason text not null,
  description text,
  evidence_urls jsonb not null default '[]'::jsonb,
  status text not null default 'requested' check(status in ('requested','approved','rejected','shipping_back','received','resolved','cancelled')),
  requested_amount integer not null default 0 check(requested_amount>=0),
  approved_amount integer check(approved_amount is null or approved_amount>=0),
  resolution_note text,
  return_tracking_number text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_item_id)
);

create index if not exists return_requests_buyer_created_idx on public.return_requests(buyer_id,created_at desc);
create index if not exists return_requests_seller_status_idx on public.return_requests(seller_id,status,created_at desc);
create index if not exists return_requests_order_idx on public.return_requests(order_id);

alter table public.return_requests enable row level security;
revoke all on public.return_requests from public,anon,authenticated;
grant select on public.return_requests to authenticated;

drop policy if exists return_requests_buyer_select on public.return_requests;
create policy return_requests_buyer_select on public.return_requests
for select to authenticated using (buyer_id=auth.uid() or public.is_admin());

drop policy if exists return_requests_seller_select on public.return_requests;
create policy return_requests_seller_select on public.return_requests
for select to authenticated using (seller_id=auth.uid() or public.is_admin());

create or replace function public.request_return(p_order_item_id uuid,p_type text,p_reason text,p_description text default null,p_evidence_urls jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v record; v_id uuid;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;
  if p_type not in ('return_refund','replacement') then raise exception 'Jenis pengajuan tidak valid.'; end if;
  if length(trim(coalesce(p_reason,'')))<3 or length(trim(coalesce(p_reason,'')))>500 then raise exception 'Alasan pengajuan harus 3-500 karakter.'; end if;
  if length(coalesce(p_description,''))>2000 then raise exception 'Deskripsi maksimal 2000 karakter.'; end if;
  if jsonb_typeof(coalesce(p_evidence_urls,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_evidence_urls,'[]'::jsonb))>8 then raise exception 'Bukti tidak valid atau melebihi 8 item.'; end if;

  select oi.id,oi.order_id,oi.store_id,oi.line_total,o.buyer_id,o.status,o.payment_status,s.owner_id
  into v from public.order_items oi join public.orders o on o.id=oi.order_id join public.stores s on s.id=oi.store_id
  where oi.id=p_order_item_id and o.buyer_id=v_user for update of oi,o;

  if not found then raise exception 'Item pesanan tidak ditemukan.'; end if;
  if v.status not in ('delivered','completed')::text[] then raise exception 'Pengajuan hanya tersedia setelah pesanan diterima/delivered.'; end if;
  if v.payment_status<>'paid'::public.payment_status then raise exception 'Pesanan belum lunas.'; end if;
  if v.owner_id is null then raise exception 'Seller tidak valid.'; end if;
  if exists(select 1 from public.return_requests where order_item_id=v.id and status not in ('rejected','cancelled')) then raise exception 'Item ini sudah memiliki pengajuan aktif.'; end if;

  insert into public.return_requests(order_item_id,order_id,buyer_id,seller_id,type,reason,description,evidence_urls,requested_amount)
  values(v.id,v.order_id,v_user,v.owner_id,p_type,trim(p_reason),nullif(trim(coalesce(p_description,'')),''),coalesce(p_evidence_urls,'[]'::jsonb),v.line_total)
  returning id into v_id;

  insert into public.notifications(user_id,type,title,message,link)
  values(v.owner_id,'dispute','Pengajuan retur baru','Buyer mengajukan retur/penggantian untuk pesanan Anda.','/seller.html');
  return jsonb_build_object('ok',true,'return_request_id',v_id);
end; $$;

revoke execute on function public.request_return(uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.request_return(uuid,text,text,text,jsonb) to authenticated,service_role;

create or replace function public.admin_resolve_return(p_request_id uuid,p_status text,p_approved_amount integer default null,p_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_id uuid;
begin
  if v_user is null or not public.is_admin() then raise exception 'Akses ditolak: hanya admin.'; end if;
  if p_status not in ('approved','rejected','resolved','cancelled') then raise exception 'Status resolusi tidak valid.'; end if;
  if p_approved_amount is not null and p_approved_amount<0 then raise exception 'Nominal tidak valid.'; end if;
  update public.return_requests set status=p_status,
    approved_amount=case when p_status in ('approved','resolved') then coalesce(p_approved_amount,requested_amount) else approved_amount end,
    resolution_note=nullif(trim(coalesce(p_note,'')),''),approved_at=case when p_status='approved' then now() else approved_at end,
    resolved_at=case when p_status in ('resolved','rejected','cancelled') then now() else resolved_at end,updated_at=now()
  where id=p_request_id returning id into v_id;
  if v_id is null then raise exception 'Pengajuan retur tidak ditemukan.'; end if;
  return jsonb_build_object('ok',true,'return_request_id',v_id);
end; $$;

revoke execute on function public.admin_resolve_return(uuid,text,integer,text) from public,anon;
grant execute on function public.admin_resolve_return(uuid,text,integer,text) to authenticated,service_role;

create or replace function public.touch_return_requests_updated_at()
returns trigger language plpgsql security definer set search_path=''
as $$ begin new.updated_at=now(); return new; end $$;
revoke execute on function public.touch_return_requests_updated_at() from public,anon,authenticated;
grant execute on function public.touch_return_requests_updated_at() to service_role;
drop trigger if exists return_requests_updated_at on public.return_requests;
create trigger return_requests_updated_at before update on public.return_requests for each row execute function public.touch_return_requests_updated_at();

create or replace function public.notify_return_status_change()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='UPDATE' and old.status is distinct from new.status then
    insert into public.notifications(user_id,type,title,message,link)
    values(new.buyer_id,'dispute','Status pengajuan retur diperbarui','Status pengajuan retur/penggantian Anda sekarang: '||new.status||'.','/?account=orders');
  end if;
  return new;
end $$;
revoke execute on function public.notify_return_status_change() from public,anon,authenticated;
grant execute on function public.notify_return_status_change() to service_role;
drop trigger if exists return_status_notification on public.return_requests;
create trigger return_status_notification after update of status on public.return_requests for each row execute function public.notify_return_status_change();
