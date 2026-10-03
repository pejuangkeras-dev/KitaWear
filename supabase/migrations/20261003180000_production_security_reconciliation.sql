-- Production security reconciliation
-- Applied directly to production on 2026-10-03.
-- Keep internal authorization helpers out of the exposed RPC surface.
create policy if not exists "analytics_events_no_client_access"
on public.analytics_events
for all to anon, authenticated
using (false)
with check (false);

revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.is_seller_or_admin() from public, anon, authenticated;
revoke execute on function public.mk_is_admin() from public, anon, authenticated;
revoke execute on function public.mk_is_seller_or_admin() from public, anon, authenticated;
