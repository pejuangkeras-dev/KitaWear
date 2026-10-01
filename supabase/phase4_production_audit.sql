-- MarketKita Phase 4 production hardening
-- Applied live to Supabase project eczozutsjwvkfgpyccou on 2026-10-01.

revoke execute on function public.touch_shipping_shipments_updated_at() from public,anon,authenticated;
drop index if exists public.buyer_addresses_one_default_per_user;

create index if not exists order_items_product_id_idx on public.order_items(product_id);
create index if not exists seller_payouts_order_id_idx on public.seller_payouts(order_id);
create index if not exists seller_payouts_store_id_idx on public.seller_payouts(store_id);
create index if not exists reviews_product_id_idx on public.reviews(product_id);
create index if not exists disputes_buyer_id_idx on public.disputes(buyer_id);
create index if not exists disputes_order_id_idx on public.disputes(order_id);
create index if not exists product_reviews_product_id_idx on public.product_reviews(product_id);
create index if not exists product_reviews_store_id_idx on public.product_reviews(store_id);
create index if not exists chat_messages_sender_id_idx on public.chat_messages(sender_id);
create index if not exists seller_payout_requests_seller_id_idx on public.seller_payout_requests(seller_id);
create index if not exists stock_reservations_product_id_idx on public.stock_reservations(product_id);
create index if not exists chat_threads_store_id_idx on public.chat_threads(store_id);
create index if not exists product_reviews_order_id_idx on public.product_reviews(order_id);
create index if not exists reviews_buyer_id_idx on public.reviews(buyer_id);
create index if not exists seller_reviews_order_id_idx on public.seller_reviews(order_id);
create index if not exists seller_reviews_store_id_idx on public.seller_reviews(store_id);

-- Additional Phase 4 voucher hardening applied live.

create or replace function public.consume_user_voucher(p_voucher_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_voucher record; v_claim record;
begin
  if p_voucher_id is null or p_user_id is null then raise exception 'VOUCHER_INVALID'; end if;
  select id,active,starts_at,expires_at,usage_limit,used_count into v_voucher
  from public.vouchers where id=p_voucher_id for update;
  if not found or not v_voucher.active or v_voucher.starts_at>now()
     or (v_voucher.expires_at is not null and v_voucher.expires_at<=now())
     or (v_voucher.usage_limit is not null and v_voucher.used_count>=v_voucher.usage_limit)
  then raise exception 'VOUCHER_UNAVAILABLE'; end if;
  select id,used_at into v_claim from public.user_vouchers
  where voucher_id=p_voucher_id and user_id=p_user_id for update;
  if not found or v_claim.used_at is not null then raise exception 'VOUCHER_NOT_CLAIMED_OR_USED'; end if;
  update public.user_vouchers set used_at=now() where id=v_claim.id;
  update public.vouchers set used_count=used_count+1,updated_at=now() where id=p_voucher_id;
end;
$$;

create or replace function public.release_user_voucher(p_voucher_id uuid,p_user_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_claim record;
begin
  if p_voucher_id is null or p_user_id is null then return; end if;
  select id,used_at into v_claim from public.user_vouchers
  where voucher_id=p_voucher_id and user_id=p_user_id for update;
  if not found or v_claim.used_at is null then return; end if;
  update public.user_vouchers set used_at=null where id=v_claim.id;
  update public.vouchers set used_count=greatest(0,used_count-1),updated_at=now() where id=p_voucher_id;
end;
$$;

revoke execute on function public.consume_user_voucher(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.release_user_voucher(uuid,uuid) from public,anon,authenticated;

create or replace function public.release_voucher_on_unpaid_order_end()
returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  if old.payment_status='pending'::public.payment_status
     and new.payment_status in ('failed','expired')::public.payment_status[]
     and new.voucher_id is not null and new.buyer_id is not null
  then
    perform public.release_user_voucher(new.voucher_id,new.buyer_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.release_voucher_on_unpaid_order_end() from public,anon,authenticated;
drop trigger if exists orders_release_voucher_on_unpaid_end on public.orders;
create trigger orders_release_voucher_on_unpaid_end
after update of payment_status on public.orders
for each row when (old.payment_status is distinct from new.payment_status)
execute function public.release_voucher_on_unpaid_order_end();
