-- P33 Performance & Scale: verified missing foreign-key indexes and edge-cache support.
create index if not exists admin_audit_logs_actor_created_idx on public.admin_audit_logs (actor_id, created_at desc);
create index if not exists inventory_events_product_size_idx on public.inventory_events (product_size_id, changed_at desc);
create index if not exists orders_shipping_address_idx on public.orders (shipping_address_id);
create index if not exists refund_requests_buyer_created_idx on public.refund_requests (buyer_id, created_at desc);
create index if not exists seller_payout_audit_admin_created_idx on public.seller_payout_audit (admin_id, created_at desc);
create index if not exists shipping_reconciliation_runs_order_idx on public.shipping_reconciliation_runs (order_id, created_at desc);
