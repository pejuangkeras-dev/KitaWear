-- Double-payout protection + seller payout audit trail
-- Applied to Supabase project eczozutsjwvkfgpyccou.

create table if not exists public.seller_payout_audit (
  id uuid primary key default gen_random_uuid(),
  payout_request_id uuid not null references public.seller_payout_requests(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  admin_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('approved','rejected','paid')),
  previous_status text not null,
  new_status text not null,
  amount integer not null check (amount > 0),
  admin_note text,
  created_at timestamptz not null default now(),
  unique (payout_request_id, action)
);

create index if not exists seller_payout_audit_request_idx on public.seller_payout_audit(payout_request_id, created_at desc);
create index if not exists seller_payout_audit_seller_idx on public.seller_payout_audit(seller_id, created_at desc);

alter table public.seller_payout_audit enable row level security;

drop policy if exists seller_payout_audit_admin_read on public.seller_payout_audit;
create policy seller_payout_audit_admin_read on public.seller_payout_audit for select to authenticated using (public.is_admin());

drop policy if exists seller_payout_audit_seller_read on public.seller_payout_audit;
create policy seller_payout_audit_seller_read on public.seller_payout_audit for select to authenticated using (seller_id = auth.uid());

-- The RPC locks the payout request row before changing state.
-- Only pending -> approved -> paid is allowed, so a paid request cannot be paid again.
-- The seller_payout_audit unique(request, action) is an additional DB-level idempotency guard.
-- The entire payout allocation and audit insert run in one transaction.
create or replace function public.admin_review_payout_request(
  p_request_id uuid,
  p_decision text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_req public.seller_payout_requests%rowtype;
  v_row record;
  v_take integer;
  v_remaining integer;
  v_paid_total integer := 0;
  v_partial_gross integer;
  v_partial_fee integer;
  v_decision text := lower(trim(coalesce(p_decision,'')));
  v_admin_id uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'Akses ditolak: hanya admin.'; end if;
  if v_decision not in ('approved','rejected','paid') then raise exception 'Keputusan payout tidak valid.'; end if;

  select * into v_req from public.seller_payout_requests where id=p_request_id for update;
  if not found then raise exception 'Permintaan payout tidak ditemukan.'; end if;
  if v_req.amount <= 0 then raise exception 'Nominal payout tidak valid.'; end if;

  if v_decision='approved' and v_req.status<>'pending' then raise exception 'Hanya payout pending yang dapat disetujui.'; end if;
  if v_decision='rejected' and v_req.status not in ('pending','approved') then raise exception 'Payout sudah selesai diproses.'; end if;
  if v_decision='paid' and v_req.status<>'approved' then raise exception 'Payout harus disetujui sebelum ditandai paid.'; end if;

  if v_decision='paid' then
    v_remaining := v_req.amount;

    for v_row in
      select * from public.seller_payouts
      where seller_id=v_req.seller_id and status='eligible'
      order by created_at,id for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_row.net_amount);

      if v_take = v_row.net_amount then
        update public.seller_payouts set status='paid', paid_at=now() where id=v_row.id;
      else
        v_partial_gross := case
          when v_row.net_amount <= 0 then 0
          else floor((v_take::numeric * v_row.gross_amount::numeric) / v_row.net_amount::numeric)
        end;
        v_partial_fee := v_partial_gross - v_take;

        update public.seller_payouts
        set gross_amount=gross_amount-v_partial_gross,
            platform_fee=platform_fee-v_partial_fee,
            net_amount=net_amount-v_take
        where id=v_row.id;

        insert into public.seller_payouts(
          order_item_id,seller_id,store_id,order_id,gross_amount,platform_fee,net_amount,status,paid_at
        ) values (
          v_row.order_item_id,v_row.seller_id,v_row.store_id,v_row.order_id,
          v_partial_gross,v_partial_fee,v_take,'paid'::public.payout_status,now()
        );
      end if;

      v_remaining := v_remaining-v_take;
      v_paid_total := v_paid_total+v_take;
    end loop;

    if v_paid_total <> v_req.amount then
      raise exception 'Payout tidak dapat dicocokkan dengan saldo eligible. Tersedia: %, diminta: %', v_paid_total, v_req.amount;
    end if;
  end if;

  update public.seller_payout_requests
  set status=v_decision,
      admin_note=left(nullif(trim(coalesce(p_admin_note,'')),''),1000),
      reviewed_at=case when v_decision in ('approved','rejected') then now() else reviewed_at end,
      paid_at=case when v_decision='paid' then now() else paid_at end
  where id=p_request_id;

  insert into public.seller_payout_audit(
    payout_request_id,seller_id,admin_id,action,previous_status,new_status,amount,admin_note
  ) values (
    v_req.id,v_req.seller_id,v_admin_id,v_decision,v_req.status,v_decision,v_req.amount,
    left(nullif(trim(coalesce(p_admin_note,'')),''),1000)
  )
  on conflict (payout_request_id,action) do nothing;

  insert into public.notifications(user_id,type,title,message,link)
  values(
    v_req.seller_id,'payout',
    case v_decision when 'approved' then 'Payout disetujui' when 'paid' then 'Payout dibayar' else 'Payout ditolak' end,
    case v_decision when 'approved' then 'Permintaan payout Anda telah disetujui.'
      when 'paid' then 'Payout Anda telah ditandai sebagai dibayar.'
      else 'Permintaan payout Anda ditolak.' end,
    '/seller.html'
  );

  return jsonb_build_object('ok',true,'request_id',v_req.id,'status',v_decision,'amount',v_req.amount);
end;
$function$;