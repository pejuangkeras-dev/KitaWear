create unique index if not exists seller_payout_requests_one_active_per_seller
on public.seller_payout_requests(seller_id)
where status in ('pending','approved');

alter table public.seller_payout_requests
  add constraint seller_payout_requests_amount_positive check (amount > 0);

alter table public.seller_payouts
  add constraint seller_payouts_gross_nonnegative check (gross_amount >= 0),
  add constraint seller_payouts_fee_nonnegative check (platform_fee >= 0),
  add constraint seller_payouts_net_nonnegative check (net_amount >= 0),
  add constraint seller_payouts_net_math check (net_amount = gross_amount - platform_fee);

create or replace function public.seller_request_payout(p_amount integer,p_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid := (select auth.uid()); v_available integer; v_request uuid;
begin
 if v_user is null then raise exception 'Anda harus login.'; end if;
 if not exists(select 1 from public.profiles where id=v_user and role='seller') then raise exception 'Akses ditolak. Akun bukan seller.'; end if;
 if p_amount is null or p_amount<=0 then raise exception 'Nominal payout tidak valid.'; end if;
 perform 1 from public.profiles where id=v_user for update;
 if exists(select 1 from public.seller_payout_requests where seller_id=v_user and status in ('pending','approved')) then raise exception 'Masih ada permintaan payout yang sedang diproses.'; end if;
 select coalesce(sum(net_amount),0)::integer into v_available from public.seller_payouts where seller_id=v_user and status='eligible';
 if p_amount>v_available then raise exception 'Saldo tersedia tidak mencukupi. Saldo tersedia: %',v_available; end if;
 insert into public.seller_payout_requests(seller_id,amount,note)
 values(v_user,p_amount,left(nullif(trim(coalesce(p_note,'')),''),500))
 returning id into v_request;
 return jsonb_build_object('ok',true,'request_id',v_request,'amount',p_amount,'available',v_available);
exception when unique_violation then
 raise exception 'Masih ada permintaan payout yang sedang diproses.';
end;
$$;
revoke execute on function public.seller_request_payout(integer,text) from public,anon;
grant execute on function public.seller_request_payout(integer,text) to authenticated;
