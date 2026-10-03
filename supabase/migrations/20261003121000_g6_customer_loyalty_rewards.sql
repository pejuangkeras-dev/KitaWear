create table if not exists public.loyalty_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  points_balance bigint not null default 0 check (points_balance >= 0),
  lifetime_earned bigint not null default 0 check (lifetime_earned >= 0),
  lifetime_redeemed bigint not null default 0 check (lifetime_redeemed >= 0),
  tier text not null default 'member' check (tier in ('member','silver','gold','platinum')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  type text not null check (type in ('earn','redeem','adjustment','expire')),
  points bigint not null check (points <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reference_key text unique,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_transactions_user_created_idx on public.loyalty_transactions(user_id,created_at desc);
create index if not exists loyalty_transactions_order_idx on public.loyalty_transactions(order_id);
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_transactions enable row level security;
drop policy if exists loyalty_accounts_select_own on public.loyalty_accounts;
create policy loyalty_accounts_select_own on public.loyalty_accounts for select to authenticated using (user_id=auth.uid());
drop policy if exists loyalty_transactions_select_own on public.loyalty_transactions;
create policy loyalty_transactions_select_own on public.loyalty_transactions for select to authenticated using (user_id=auth.uid());

create or replace function public.mk_loyalty_tier(p_lifetime_earned bigint) returns text language sql immutable as $$ select case when coalesce(p_lifetime_earned,0)>=100000 then 'platinum' when coalesce(p_lifetime_earned,0)>=50000 then 'gold' when coalesce(p_lifetime_earned,0)>=10000 then 'silver' else 'member' end $$;
create or replace function public.mk_loyalty_ensure_account(p_user_id uuid) returns public.loyalty_accounts language plpgsql security definer set search_path=public as $$
declare r public.loyalty_accounts; begin insert into public.loyalty_accounts(user_id) values(p_user_id) on conflict(user_id) do nothing; select * into r from public.loyalty_accounts where user_id=p_user_id; return r; end $$;

create or replace function public.mk_award_loyalty_for_order() returns trigger language plpgsql security definer set search_path=public as $$
declare v_points bigint;v_balance bigint;v_ref text;
begin
 if new.status='completed'::order_status and coalesce(old.status::text,'')<>'completed' and new.buyer_id is not null then
  v_points:=floor(greatest(coalesce(new.subtotal,0),0)/1000.0)::bigint;
  if v_points>0 then
   perform public.mk_loyalty_ensure_account(new.buyer_id); v_ref:='order:'||new.id::text||':earn';
   if not exists(select 1 from public.loyalty_transactions where reference_key=v_ref) then
    update public.loyalty_accounts set points_balance=points_balance+v_points,lifetime_earned=lifetime_earned+v_points,tier=public.mk_loyalty_tier(lifetime_earned+v_points),updated_at=now() where user_id=new.buyer_id returning points_balance into v_balance;
    insert into public.loyalty_transactions(user_id,order_id,type,points,balance_after,reference_key,description,metadata) values(new.buyer_id,new.id,'earn',v_points,v_balance,v_ref,'Poin belanja dari pesanan '||coalesce(new.order_number,new.id::text),jsonb_build_object('subtotal',new.subtotal,'rate',1000));
    insert into public.notifications(user_id,type,title,message,link) values(new.buyer_id,'loyalty','Poin bertambah','Anda mendapatkan '||v_points||' poin dari pesanan '||coalesce(new.order_number,'MarketKita')||'.','#account-loyalty');
   end if;
  end if;
 end if; return new;
end $$;
drop trigger if exists trg_mk_loyalty_order_completed on public.orders;
create trigger trg_mk_loyalty_order_completed after update of status on public.orders for each row execute function public.mk_award_loyalty_for_order();

create or replace function public.get_loyalty_summary(p_user_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.loyalty_accounts; begin if p_user_id is null then raise exception 'LOGIN_REQUIRED'; end if; perform public.mk_loyalty_ensure_account(p_user_id); select * into a from public.loyalty_accounts where user_id=p_user_id; return jsonb_build_object('user_id',a.user_id,'points_balance',a.points_balance,'lifetime_earned',a.lifetime_earned,'lifetime_redeemed',a.lifetime_redeemed,'tier',a.tier,'redeem_rate',1,'minimum_redeem',1000,'recent_transactions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id,type,points,balance_after,description,created_at from public.loyalty_transactions where user_id=p_user_id order by created_at desc limit 10)x),'[]'::jsonb)); end $$;

create or replace function public.redeem_loyalty_points(p_user_id uuid,p_points bigint) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_balance bigint;v_code text;v_voucher_id uuid;v_user_voucher_id uuid;v_now timestamptz:=now();v_ref text;
begin
 if p_user_id is null then raise exception 'LOGIN_REQUIRED'; end if;
 if p_points<1000 or p_points%1000<>0 then raise exception 'MINIMUM_1000_AND_MULTIPLE_1000'; end if;
 perform public.mk_loyalty_ensure_account(p_user_id);
 select points_balance into v_balance from public.loyalty_accounts where user_id=p_user_id for update;
 if v_balance<p_points then raise exception 'INSUFFICIENT_POINTS'; end if;
 v_code:='MKP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 insert into public.vouchers(code,title,description,discount_type,discount_value,min_order_amount,max_discount,usage_limit,starts_at,expires_at,active) values(v_code,'Voucher Loyalty MarketKita','Voucher yang ditukar dengan poin loyalty.','fixed',p_points,0,p_points,1,v_now,v_now+interval '30 days',true) returning id into v_voucher_id;
 insert into public.user_vouchers(voucher_id,user_id) values(v_voucher_id,p_user_id) returning id into v_user_voucher_id;
 update public.loyalty_accounts set points_balance=points_balance-p_points,lifetime_redeemed=lifetime_redeemed+p_points,updated_at=now() where user_id=p_user_id returning points_balance into v_balance;
 v_ref:='redeem:'||p_user_id::text||':'||v_user_voucher_id::text;
 insert into public.loyalty_transactions(user_id,type,points,balance_after,reference_key,description,metadata) values(p_user_id,'redeem',-p_points,v_balance,v_ref,'Penukaran '||p_points||' poin menjadi voucher Rp'||p_points,jsonb_build_object('voucher_id',v_voucher_id,'user_voucher_id',v_user_voucher_id));
 insert into public.notifications(user_id,type,title,message,link) values(p_user_id,'loyalty','Voucher loyalty siap digunakan','Poin Anda berhasil ditukar menjadi voucher Rp'||p_points||' yang berlaku 30 hari.','#account-loyalty');
 return jsonb_build_object('ok',true,'voucher_id',v_voucher_id,'user_voucher_id',v_user_voucher_id,'code',v_code,'discount_amount',p_points,'points_balance',v_balance);
end $$;

revoke all on function public.get_loyalty_summary(uuid) from public,anon,authenticated;
revoke all on function public.redeem_loyalty_points(uuid,bigint) from public,anon,authenticated;
revoke all on function public.mk_loyalty_ensure_account(uuid) from public,anon,authenticated;
revoke all on function public.mk_award_loyalty_for_order() from public,anon,authenticated;
grant execute on function public.get_loyalty_summary(uuid) to service_role;
grant execute on function public.redeem_loyalty_points(uuid,bigint) to service_role;
grant execute on function public.mk_loyalty_ensure_account(uuid) to service_role;
grant execute on function public.mk_award_loyalty_for_order() to service_role;