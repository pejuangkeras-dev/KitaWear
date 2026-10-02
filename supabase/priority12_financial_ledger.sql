-- MarketKita Priority 12: Financial Ledger
-- Double-entry ledger for order payments, refunds and seller payouts.

create table if not exists public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  account_key text not null unique,
  account_type text not null check (account_type in ('asset','liability','revenue','expense','equity')),
  owner_type text not null check (owner_type in ('system','seller')),
  owner_id uuid references public.profiles(id) on delete set null,
  currency text not null default 'IDR',
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_type='system' and owner_id is null) or (owner_type='seller' and owner_id is not null))
);
create unique index if not exists ledger_accounts_seller_owner_idx on public.ledger_accounts(owner_id) where owner_type='seller';
create index if not exists ledger_accounts_owner_idx on public.ledger_accounts(owner_id) where owner_id is not null;

create table if not exists public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_key text not null unique,
  transaction_type text not null check (transaction_type in ('order_payment','refund','seller_payout','adjustment','reversal')),
  order_id uuid references public.orders(id) on delete set null,
  seller_id uuid references public.profiles(id) on delete set null,
  source_type text,
  source_id uuid,
  amount bigint not null check (amount > 0),
  currency text not null default 'IDR',
  status text not null default 'posted' check (status in ('posted','voided')),
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ledger_transactions_order_idx on public.ledger_transactions(order_id,created_at desc);
create index if not exists ledger_transactions_seller_idx on public.ledger_transactions(seller_id,created_at desc);
create index if not exists ledger_transactions_type_idx on public.ledger_transactions(transaction_type,created_at desc);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.ledger_transactions(id) on delete restrict,
  account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  direction text not null check (direction in ('debit','credit')),
  amount bigint not null check (amount > 0),
  currency text not null default 'IDR',
  memo text,
  created_at timestamptz not null default now(),
  unique(transaction_id,account_id,direction)
);
create index if not exists ledger_entries_account_idx on public.ledger_entries(account_id,created_at desc);
create index if not exists ledger_entries_transaction_idx on public.ledger_entries(transaction_id);

alter table public.ledger_accounts enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;

drop policy if exists ledger_accounts_admin_select on public.ledger_accounts;
create policy ledger_accounts_admin_select on public.ledger_accounts for select to authenticated using ((select public.is_admin()));
drop policy if exists ledger_accounts_seller_select on public.ledger_accounts;
create policy ledger_accounts_seller_select on public.ledger_accounts for select to authenticated using (owner_type='seller' and owner_id=(select auth.uid()));

drop policy if exists ledger_transactions_admin_select on public.ledger_transactions;
create policy ledger_transactions_admin_select on public.ledger_transactions for select to authenticated using ((select public.is_admin()));
drop policy if exists ledger_transactions_seller_select on public.ledger_transactions;
create policy ledger_transactions_seller_select on public.ledger_transactions for select to authenticated using (seller_id=(select auth.uid()));

drop policy if exists ledger_entries_admin_select on public.ledger_entries;
create policy ledger_entries_admin_select on public.ledger_entries for select to authenticated using ((select public.is_admin()));
drop policy if exists ledger_entries_seller_select on public.ledger_entries;
create policy ledger_entries_seller_select on public.ledger_entries for select to authenticated using (exists (
  select 1 from public.ledger_accounts a
  where a.id=ledger_entries.account_id and a.owner_type='seller' and a.owner_id=(select auth.uid())
));

revoke all on public.ledger_accounts from public,anon,authenticated;
revoke all on public.ledger_transactions from public,anon,authenticated;
revoke all on public.ledger_entries from public,anon,authenticated;
grant select on public.ledger_accounts to authenticated;
grant select on public.ledger_transactions to authenticated;
grant select on public.ledger_entries to authenticated;
grant all on public.ledger_accounts to service_role;
grant all on public.ledger_transactions to service_role;
grant all on public.ledger_entries to service_role;

insert into public.ledger_accounts(account_key,account_type,owner_type,name) values
('system:cash','asset','system','Marketplace Cash'),
('system:platform_revenue','revenue','system','Platform Revenue'),
('system:shipping_payable','liability','system','Shipping Payable'),
('system:discount_expense','expense','system','Voucher / Discount Expense'),
('system:refund_expense','expense','system','Refund Expense')
on conflict (account_key) do nothing;

create or replace function public.ledger_ensure_seller_account(p_seller_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
  if p_seller_id is null then raise exception 'seller_id is required'; end if;
  insert into public.ledger_accounts(account_key,account_type,owner_type,owner_id,name)
  values ('seller:'||p_seller_id::text,'liability','seller',p_seller_id,'Seller Payable')
  on conflict (account_key) do update set updated_at=now(),active=true returning id into v_id;
  return v_id;
end; $$;

create or replace function public.ledger_post_order_payment(p_order_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  o record; t_id uuid; cash_id uuid; revenue_id uuid; shipping_id uuid; discount_id uuid;
  seller record; seller_account uuid; total_debit bigint:=0; total_credit bigint:=0; seller_net bigint;
begin
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.payment_status not in ('paid'::public.payment_status,'refunded'::public.payment_status) then raise exception 'Order payment is not settled'; end if;
  select id into t_id from public.ledger_transactions where transaction_key='order_payment:'||p_order_id::text;
  if t_id is not null then return t_id; end if;
  select id into cash_id from public.ledger_accounts where account_key='system:cash';
  select id into revenue_id from public.ledger_accounts where account_key='system:platform_revenue';
  select id into shipping_id from public.ledger_accounts where account_key='system:shipping_payable';
  select id into discount_id from public.ledger_accounts where account_key='system:discount_expense';
  insert into public.ledger_transactions(transaction_key,transaction_type,order_id,amount,currency,description,metadata)
  values ('order_payment:'||p_order_id::text,'order_payment',p_order_id,o.total,'IDR','Order payment',jsonb_build_object('order_number',o.order_number))
  returning id into t_id;
  insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo) values(t_id,cash_id,'debit',o.total,'Customer payment');
  total_debit:=total_debit+o.total;
  for seller in select os.seller_id,os.subtotal,os.platform_fee,os.shipping_fee from public.order_sellers os where os.order_id=p_order_id order by os.seller_id loop
    seller_account:=public.ledger_ensure_seller_account(seller.seller_id);
    seller_net:=greatest(seller.subtotal-seller.platform_fee,0);
    if seller_net>0 then
      insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo) values(t_id,seller_account,'credit',seller_net,'Seller payable');
      total_credit:=total_credit+seller_net;
    end if;
    if seller.platform_fee>0 then
      insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo) values(t_id,revenue_id,'credit',seller.platform_fee,'Platform fee');
      total_credit:=total_credit+seller.platform_fee;
    end if;
    if seller.shipping_fee>0 then
      insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo) values(t_id,shipping_id,'credit',seller.shipping_fee,'Shipping payable');
      total_credit:=total_credit+seller.shipping_fee;
    end if;
  end loop;
  if o.discount_amount>0 then
    insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo) values(t_id,discount_id,'debit',o.discount_amount,'Voucher / discount subsidy');
    total_debit:=total_debit+o.discount_amount;
  end if;
  if total_debit<>total_credit then raise exception 'Ledger imbalance for order %, debit %, credit %',p_order_id,total_debit,total_credit; end if;
  return t_id;
end; $$;

create or replace function public.ledger_post_refund(p_refund_request_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  r record; source_tx uuid; t_id uuid; cash_id uuid; refund_id uuid; original_cash bigint; ratio numeric;
  e record; amt bigint; debits bigint; credits bigint;
begin
  select * into r from public.refund_requests where id=p_refund_request_id for update;
  if not found then raise exception 'Refund request not found'; end if;
  if r.status<>'succeeded' then raise exception 'Refund is not succeeded'; end if;
  select id into t_id from public.ledger_transactions where transaction_key='refund:'||p_refund_request_id::text;
  if t_id is not null then return t_id; end if;
  select id into source_tx from public.ledger_transactions where transaction_key='order_payment:'||r.order_id::text;
  if source_tx is null then raise exception 'Original order payment ledger not found'; end if;
  select sum(le.amount) into original_cash from public.ledger_entries le join public.ledger_accounts la on la.id=le.account_id
    where le.transaction_id=source_tx and la.account_key='system:cash' and le.direction='debit';
  if coalesce(original_cash,0)<=0 then raise exception 'Original cash ledger is invalid'; end if;
  if r.amount>original_cash then raise exception 'Refund exceeds original payment'; end if;
  select id into cash_id from public.ledger_accounts where account_key='system:cash';
  select id into refund_id from public.ledger_accounts where account_key='system:refund_expense';
  insert into public.ledger_transactions(transaction_key,transaction_type,order_id,amount,currency,source_type,source_id,description)
  values('refund:'||p_refund_request_id::text,'refund',r.order_id,r.amount,'IDR','refund_request',p_refund_request_id,'Customer refund')
  returning id into t_id;
  ratio:=r.amount::numeric/original_cash::numeric;
  for e in select le.account_id,le.direction,le.amount,la.account_key from public.ledger_entries le join public.ledger_accounts la on la.id=le.account_id where le.transaction_id=source_tx order by case when la.account_key='system:cash' then 0 else 1 end,le.id loop
    if e.account_key='system:cash' then amt:=r.amount; else amt:=floor(e.amount*ratio); end if;
    if amt<=0 then continue; end if;
    insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo)
    values(t_id,e.account_id,case when e.direction='debit' then 'credit' else 'debit' end,amt,'Refund reversal');
  end loop;
  select coalesce(sum(amount) filter(where direction='debit'),0),coalesce(sum(amount) filter(where direction='credit'),0)
    into debits,credits from public.ledger_entries where transaction_id=t_id;
  if debits<credits then
    insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo) values(t_id,refund_id,'debit',credits-debits,'Refund rounding adjustment');
  elsif credits<debits then
    insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo) values(t_id,refund_id,'credit',debits-credits,'Refund rounding adjustment');
  end if;
  return t_id;
end; $$;

create or replace function public.ledger_post_payout(p_payout_request_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare p record; t_id uuid; seller_account uuid; cash_id uuid; available bigint;
begin
  select * into p from public.seller_payout_requests where id=p_payout_request_id for update;
  if not found then raise exception 'Payout request not found'; end if;
  if p.status<>'paid' then raise exception 'Payout request is not paid'; end if;
  select id into t_id from public.ledger_transactions where transaction_key='seller_payout:'||p_payout_request_id::text;
  if t_id is not null then return t_id; end if;
  seller_account:=public.ledger_ensure_seller_account(p.seller_id);
  select id into cash_id from public.ledger_accounts where account_key='system:cash';
  select coalesce(sum(case when le.direction='credit' then le.amount else -le.amount end),0) into available from public.ledger_entries le where le.account_id=seller_account;
  if p.amount<=0 then raise exception 'Payout amount must be positive'; end if;
  if p.amount>available then raise exception 'Payout exceeds seller ledger balance. Available: %, requested: %',available,p.amount; end if;
  insert into public.ledger_transactions(transaction_key,transaction_type,seller_id,amount,currency,source_type,source_id,description)
  values('seller_payout:'||p_payout_request_id::text,'seller_payout',p.seller_id,p.amount,'IDR','seller_payout_request',p_payout_request_id,'Seller payout')
  returning id into t_id;
  insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo) values(t_id,seller_account,'debit',p.amount,'Seller payout');
  insert into public.ledger_entries(transaction_id,account_id,direction,amount,memo) values(t_id,cash_id,'credit',p.amount,'Seller payout');
  return t_id;
end; $$;

create or replace function public.get_my_ledger_balance()
returns bigint language sql security invoker set search_path=''
as $$
  select coalesce(sum(case when le.direction='credit' then le.amount else -le.amount end),0)::bigint
  from public.ledger_entries le join public.ledger_accounts a on a.id=le.account_id
  where a.owner_type='seller' and a.owner_id=(select auth.uid()) and a.account_type='liability';
$$;

create or replace view public.ledger_balance_summary with (security_invoker=true) as
select a.id,a.account_key,a.account_type,a.owner_type,a.owner_id,a.name,a.currency,
coalesce(sum(case
when a.account_type in ('asset','expense') and e.direction='debit' then e.amount
when a.account_type in ('asset','expense') and e.direction='credit' then -e.amount
when a.account_type in ('liability','revenue','equity') and e.direction='credit' then e.amount
when a.account_type in ('liability','revenue','equity') and e.direction='debit' then -e.amount
else 0 end),0)::bigint as balance
from public.ledger_accounts a left join public.ledger_entries e on e.account_id=a.id group by a.id;

create or replace function public.ledger_order_payment_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if (tg_op='INSERT' and new.payment_status in ('paid'::public.payment_status,'refunded'::public.payment_status))
     or (tg_op='UPDATE' and new.payment_status in ('paid'::public.payment_status,'refunded'::public.payment_status) and new.payment_status is distinct from old.payment_status) then
    perform public.ledger_post_order_payment(new.id);
  end if;
  return new;
end; $$;

create or replace function public.ledger_refund_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.status='succeeded' and (tg_op='INSERT' or old.status is distinct from new.status) then perform public.ledger_post_refund(new.id); end if;
  return new;
end; $$;

create or replace function public.ledger_payout_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.status='paid' and (tg_op='INSERT' or old.status is distinct from new.status) then perform public.ledger_post_payout(new.id); end if;
  return new;
end; $$;

drop trigger if exists ledger_order_payment_after_change on public.orders;
create trigger ledger_order_payment_after_change after insert or update of payment_status on public.orders for each row execute function public.ledger_order_payment_trigger();
drop trigger if exists ledger_refund_after_change on public.refund_requests;
create trigger ledger_refund_after_change after insert or update of status on public.refund_requests for each row execute function public.ledger_refund_trigger();
drop trigger if exists ledger_payout_after_change on public.seller_payout_requests;
create trigger ledger_payout_after_change after insert or update of status on public.seller_payout_requests for each row execute function public.ledger_payout_trigger();

revoke execute on function public.ledger_ensure_seller_account(uuid) from public,anon,authenticated;
revoke execute on function public.ledger_post_order_payment(uuid) from public,anon,authenticated;
revoke execute on function public.ledger_post_refund(uuid) from public,anon,authenticated;
revoke execute on function public.ledger_post_payout(uuid) from public,anon,authenticated;
revoke execute on function public.ledger_order_payment_trigger() from public,anon,authenticated;
revoke execute on function public.ledger_refund_trigger() from public,anon,authenticated;
revoke execute on function public.ledger_payout_trigger() from public,anon,authenticated;
revoke execute on function public.get_my_ledger_balance() from public,anon;
grant execute on function public.ledger_ensure_seller_account(uuid) to service_role;
grant execute on function public.ledger_post_order_payment(uuid) to service_role;
grant execute on function public.ledger_post_refund(uuid) to service_role;
grant execute on function public.ledger_post_payout(uuid) to service_role;
grant execute on function public.get_my_ledger_balance() to authenticated;
revoke all on public.ledger_balance_summary from public,anon,authenticated;
grant select on public.ledger_balance_summary to authenticated;

create or replace function public.assert_ledger_transaction_balanced(p_transaction_id uuid)
returns boolean language sql security definer set search_path=''
as $$ select coalesce(sum(case when direction='debit' then amount else -amount end),0)=0 from public.ledger_entries where transaction_id=p_transaction_id; $$;
revoke execute on function public.assert_ledger_transaction_balanced(uuid) from public,anon,authenticated;
grant execute on function public.assert_ledger_transaction_balanced(uuid) to service_role;

create or replace function public.admin_ledger_summary()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_transactions bigint; v_entries bigint; v_unbalanced bigint; v_payments bigint; v_refunds bigint; v_payouts bigint; v_seller_payable bigint; v_platform_revenue bigint; v_cash bigint;
begin
  if not public.is_admin() then raise exception 'Akses ditolak: hanya admin.'; end if;
  select count(*) into v_transactions from public.ledger_transactions;
  select count(*) into v_entries from public.ledger_entries;
  select count(*) into v_unbalanced from public.ledger_transactions t where not public.assert_ledger_transaction_balanced(t.id);
  select coalesce(sum(amount),0) into v_payments from public.ledger_transactions where transaction_type='order_payment' and status='posted';
  select coalesce(sum(amount),0) into v_refunds from public.ledger_transactions where transaction_type='refund' and status='posted';
  select coalesce(sum(amount),0) into v_payouts from public.ledger_transactions where transaction_type='seller_payout' and status='posted';
  select coalesce(sum(balance),0) into v_seller_payable from public.ledger_balance_summary where owner_type='seller' and account_type='liability';
  select coalesce(balance,0) into v_platform_revenue from public.ledger_balance_summary where account_key='system:platform_revenue';
  select coalesce(balance,0) into v_cash from public.ledger_balance_summary where account_key='system:cash';
  return jsonb_build_object('transactions',v_transactions,'entries',v_entries,'unbalanced',v_unbalanced,'payments',v_payments,'refunds',v_refunds,'payouts',v_payouts,'seller_payable',v_seller_payable,'platform_revenue',v_platform_revenue,'cash',v_cash);
end; $$;
revoke execute on function public.admin_ledger_summary() from public,anon;
grant execute on function public.admin_ledger_summary() to authenticated;
