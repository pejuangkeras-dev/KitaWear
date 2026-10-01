-- MarketKita Priority 1 hardening A-F
-- Applied to Supabase production database as part of the E2E hardening pass.
-- A: payout creation is idempotent and server-only.
-- B: buyer confirmation is idempotent.
-- C: buyer confirmation requires every seller split delivered.
-- D: paid orders cannot be seller-cancelled directly.
-- E: stock decrement/restore remain server-only and idempotent.
-- F: sellers cannot directly UPDATE orders; guarded RPC is required.

revoke execute on function public.create_order_payouts(uuid) from public, anon, authenticated;
grant execute on function public.create_order_payouts(uuid) to service_role;

drop policy if exists seller_update_orders on public.orders;

revoke execute on function public.decrement_order_stock(uuid) from public, anon, authenticated;
grant execute on function public.decrement_order_stock(uuid) to service_role;

revoke execute on function public.restore_order_stock(uuid) from public, anon, authenticated;
grant execute on function public.restore_order_stock(uuid) to service_role;

-- The complete function definitions are intentionally maintained in the
-- existing E2E migration and the production database. This file records the
-- security/privilege hardening so it is reproducible for future deployments.
