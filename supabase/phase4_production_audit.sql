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
