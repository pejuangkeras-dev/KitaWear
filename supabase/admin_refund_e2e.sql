-- MarketKita: Admin Review -> Midtrans Refund E2E
-- Applied to Supabase project eczozutsjwvkfgpyccou on 2026-10-01.

create table if not exists public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  admin_id uuid references public.profiles(id) on delete set null,
  refund_key text not null unique,
  amount integer not null check (amount > 0),
  reason text not null,
  status text not null default 'reviewing'
    check (status in ('reviewing','requested','pending_confirmation','succeeded','failed')),
  midtrans_status_code text,
  midtrans_status_message text,
  midtrans_refund_chargeback_id text,
  midtrans_refund_amount integer,
  midtrans_transaction_id text,
  bank_confirmed_at timestamptz,
  raw_response jsonb not null default '{}'::jsonb,
  error_message text,
  requested_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_requests_dispute_unique unique(dispute_id)
);

alter table public.refund_requests enable row level security;
revoke all on table public.refund_requests from anon, authenticated;
grant select on table public.refund_requests to authenticated;

drop policy if exists refund_requests_buyer_select on public.refund_requests;
create policy refund_requests_buyer_select
on public.refund_requests for select to authenticated
using (buyer_id = (select auth.uid()) or public.is_admin());

drop policy if exists refund_requests_admin_all on public.refund_requests;
create policy refund_requests_admin_all
on public.refund_requests for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create index if not exists idx_refund_requests_order_id on public.refund_requests(order_id);
create index if not exists idx_refund_requests_status on public.refund_requests(status);

create or replace function public.admin_begin_dispute_refund(p_dispute_id uuid,p_reason text default 'Refund sengketa MarketKita')
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_dispute public.disputes%rowtype;
  v_order public.orders%rowtype;
  v_existing public.refund_requests%rowtype;
  v_refund_key text;
  v_reason text;
begin
  if v_user is null then raise exception 'Login admin diperlukan.'; end if;
  if not exists (select 1 from public.profiles p where p.id=v_user and p.role='admin') then
    raise exception 'Akses ditolak. Hanya admin.';
  end if;
  select * into v_dispute from public.disputes where id=p_dispute_id for update;
  if not found then raise exception 'Sengketa tidak ditemukan.'; end if;
  if lower(coalesce(v_dispute.status,'')) not in ('open','reviewing') then
    select * into v_existing from public.refund_requests where dispute_id=p_dispute_id;
    if found then return jsonb_build_object('ok',true,'refund_request_id',v_existing.id,'status',v_existing.status,'refund_key',v_existing.refund_key); end if;
    raise exception 'Sengketa sudah diproses.';
  end if;
  select * into v_order from public.orders where id=v_dispute.order_id for update;
  if not found then raise exception 'Order sengketa tidak ditemukan.'; end if;
  if v_order.payment_status <> 'paid' then raise exception 'Order belum berstatus paid.'; end if;
  select * into v_existing from public.refund_requests where dispute_id=p_dispute_id for update;
  if found and v_existing.status in ('reviewing','requested','pending_confirmation','succeeded') then
    return jsonb_build_object('ok',true,'refund_request_id',v_existing.id,'status',v_existing.status,'refund_key',v_existing.refund_key);
  end if;
  v_reason := left(coalesce(nullif(trim(p_reason),''),'Refund sengketa MarketKita'),255);
  v_refund_key := 'MK-REFUND-' || replace(p_dispute_id::text,'-','');
  insert into public.refund_requests(dispute_id,order_id,buyer_id,admin_id,refund_key,amount,reason,status)
  values(p_dispute_id,v_order.id,v_dispute.buyer_id,v_user,v_refund_key,v_order.total,v_reason,'reviewing')
  on conflict (dispute_id) do update set admin_id=excluded.admin_id,refund_key=excluded.refund_key,amount=excluded.amount,reason=excluded.reason,status='reviewing',error_message=null,updated_at=now()
  returning * into v_existing;
  update public.disputes set status='reviewing',resolved_at=null where id=p_dispute_id;
  insert into public.notifications(user_id,type,title,message,link)
  values(v_dispute.buyer_id,'dispute','Sengketa sedang ditinjau','Admin MarketKita sedang memproses refund untuk sengketa pesanan Anda.','/#akun');
  return jsonb_build_object('ok',true,'refund_request_id',v_existing.id,'status',v_existing.status,'refund_key',v_existing.refund_key,'amount',v_existing.amount,'order_id',v_existing.order_id);
end;
$function$;

revoke execute on function public.admin_begin_dispute_refund(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_begin_dispute_refund(uuid,text) to authenticated,service_role;

create or replace function public.service_update_refund_request(
  p_refund_key text,p_status text,p_status_code text default null,p_status_message text default null,
  p_refund_chargeback_id text default null,p_refund_amount integer default null,p_midtrans_transaction_id text default null,
  p_bank_confirmed_at timestamptz default null,p_raw_response jsonb default '{}'::jsonb,p_error_message text default null
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_refund public.refund_requests%rowtype;
begin
  if p_status not in ('reviewing','requested','pending_confirmation','succeeded','failed') then raise exception 'Status refund tidak valid.'; end if;
  select * into v_refund from public.refund_requests where refund_key=p_refund_key for update;
  if not found then raise exception 'Refund request tidak ditemukan.'; end if;
  update public.refund_requests
  set status=p_status,midtrans_status_code=coalesce(p_status_code,midtrans_status_code),
      midtrans_status_message=coalesce(p_status_message,midtrans_status_message),
      midtrans_refund_chargeback_id=coalesce(p_refund_chargeback_id,midtrans_refund_chargeback_id),
      midtrans_refund_amount=coalesce(p_refund_amount,midtrans_refund_amount),
      midtrans_transaction_id=coalesce(p_midtrans_transaction_id,midtrans_transaction_id),
      bank_confirmed_at=coalesce(p_bank_confirmed_at,bank_confirmed_at),
      raw_response=coalesce(p_raw_response,raw_response),error_message=p_error_message,
      requested_at=case when p_status in ('requested','pending_confirmation','succeeded') then coalesce(requested_at,now()) else requested_at end,
      confirmed_at=case when p_status='succeeded' then coalesce(p_bank_confirmed_at,now()) else confirmed_at end,
      updated_at=now()
  where id=v_refund.id returning * into v_refund;
  if p_status='succeeded' then
    update public.orders set status='refunded'::public.order_status,payment_status='refunded'::public.payment_status,updated_at=now()
    where id=v_refund.order_id and payment_status in ('paid','refunded');
    perform public.restore_order_stock(v_refund.order_id);
    update public.seller_payouts set status='refunded'::public.payout_status where order_id=v_refund.order_id and status in ('pending','eligible');
    update public.disputes set status='resolved_buyer',resolved_at=coalesce(p_bank_confirmed_at,now()) where id=v_refund.dispute_id;
    insert into public.notifications(user_id,type,title,message,link)
    values(v_refund.buyer_id,'dispute','Refund berhasil dikonfirmasi','Refund sengketa pesanan Anda telah dikonfirmasi oleh Midtrans/payment provider.','/#akun');
  elsif p_status='failed' then
    update public.disputes set status='reviewing',resolved_at=null where id=v_refund.dispute_id;
  end if;
  return jsonb_build_object('ok',true,'refund_request_id',v_refund.id,'status',v_refund.status,'dispute_id',v_refund.dispute_id,'order_id',v_refund.order_id);
end;
$function$;

revoke execute on function public.service_update_refund_request(text,text,text,text,text,integer,text,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.service_update_refund_request(text,text,text,text,text,integer,text,timestamptz,jsonb,text) to service_role;
