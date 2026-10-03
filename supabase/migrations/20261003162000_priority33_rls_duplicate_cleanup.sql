-- P33 Performance & Scale: remove exact duplicate permissive RLS policies.
-- These policies granted the same authenticated SELECT predicate and removing duplicates
-- does not change access semantics; it reduces redundant policy evaluation.

drop policy if exists "Admins can read all order items" on public.order_items;
drop policy if exists "admin_view_order_items" on public.order_items;

drop policy if exists "user_vouchers_owner_read" on public.user_vouchers;

drop policy if exists "vouchers_public_read" on public.vouchers;
