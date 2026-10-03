-- Production security reconciliation
-- Safe to apply on both an existing production database and a fresh environment.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='analytics_events'
      and policyname='analytics_events_no_client_access'
  ) then
    create policy "analytics_events_no_client_access"
      on public.analytics_events
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end
$$;

revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.is_seller_or_admin() from public, anon, authenticated;
revoke execute on function public.mk_is_admin() from public, anon, authenticated;
revoke execute on function public.mk_is_seller_or_admin() from public, anon, authenticated;
