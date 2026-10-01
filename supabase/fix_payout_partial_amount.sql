-- MarketKita: allow seller payout requests that partially consume eligible payout ledger rows.
-- Fixes arbitrary payout amounts such as Rp100.000 when eligible ledger rows are Rp75.000 + Rp65.000.

-- One order item may now be split between an eligible remainder and a paid payout allocation.
alter table public.seller_payouts drop constraint if exists seller_payouts_order_item_id_key;

create or replace function public.admin_review_payout_request(p_request_id uuid,p_decision text,p_admin_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_req public.seller_payout_requests%rowtype;
  v_row record;
  v_take integer;
  v_remaining integer;
  v_paid_total integer := 0;
  v_partial_gross integer;
  v_partial_fee integer;
begin
  if not public.is_admin() then raise exception 'Akses ditolak: hanya admin.'; end if;
  if lower(p_decision) not in ('approved','rejected','paid') then raise exception 'Keputusan payout tidak valid.'; end if;

  select * into v_req from public.seller_payout_requests where id=p_request_id for update;
  if not found then raise exception 'Permintaan payout tidak ditemukan.'; end if;

  if lower(p_decision)='approved' and v_req.status<>'pending' then
    raise exception 'Hanya payout pending yang dapat disetujui.';
  end if;
  if lower(p_decision)='rejected' and v_req.status not in ('pending','approved') then
    raise exception 'Payout sudah selesai diproses.';
  end if;
  if lower(p_decision)='paid' and v_req.status<>'approved' then
    raise exception 'Payout harus disetujui sebelum ditandai paid.';
  end if;

  if lower(p_decision)='paid' then
    v_remaining := v_req.amount;

    for v_row in
      select *
      from public.seller_payouts
      where seller_id=v_req.seller_id and status='eligible'
      order by created_at,id
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_row.net_amount);

      if v_take = v_row.net_amount then
        update public.seller_payouts
        set status='paid', paid_at=now()
        where id=v_row.id;
      else
        v_partial_gross := case
          when v_row.net_amount <= 0 then 0
          else floor((v_take::numeric * v_row.gross_amount::numeric) / v_row.net_amount::numeric)
        end;
        v_partial_fee := v_partial_gross - v_take;

        update public.seller_payouts
        set gross_amount = gross_amount - v_partial_gross,
            platform_fee = platform_fee - v_partial_fee,
            net_amount = net_amount - v_take
        where id=v_row.id;

        insert into public.seller_payouts(
          order_item_id,seller_id,store_id,order_id,gross_amount,platform_fee,net_amount,status,paid_at
        ) values (
          v_row.order_item_id,v_row.seller_id,v_row.store_id,v_row.order_id,
          v_partial_gross,v_partial_fee,v_take,'paid'::public.payout_status,now()
        );
      end if;

      v_remaining := v_remaining - v_take;
      v_paid_total := v_paid_total + v_take;
    end loop;

    if v_paid_total <> v_req.amount then
      raise exception 'Payout tidak dapat dicocokkan dengan saldo eligible. Tersedia: %, diminta: %', v_paid_total, v_req.amount;
    end if;
  end if;

  update public.seller_payout_requests
  set status=lower(p_decision),
      admin_note=left(nullif(trim(coalesce(p_admin_note,'')),''),1000),
      reviewed_at=case when lower(p_decision) in ('approved','rejected') then now() else reviewed_at end,
      paid_at=case when lower(p_decision)='paid' then now() else paid_at end
  where id=p_request_id;

  insert into public.notifications(user_id,type,title,message,link)
  values(
    v_req.seller_id,'payout',
    case lower(p_decision) when 'approved' then 'Payout disetujui' when 'paid' then 'Payout dibayar' else 'Payout ditolak' end,
    case lower(p_decision) when 'approved' then 'Permintaan payout Anda telah disetujui.'
      when 'paid' then 'Payout Anda telah ditandai sebagai dibayar.'
      else 'Permintaan payout Anda ditolak.' end,
    '/seller.html'
  );

  return jsonb_build_object('ok',true,'request_id',p_request_id,'status',lower(p_decision),'amount',v_req.amount);
end;
$function$;

revoke execute on function public.admin_review_payout_request(uuid,text,text) from public,anon;
grant execute on function public.admin_review_payout_request(uuid,text,text) to authenticated;
