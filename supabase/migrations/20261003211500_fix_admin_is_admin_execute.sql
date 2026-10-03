-- Restore the authenticated role's execute privilege for the safe role-check helper.
-- Admin RPCs use public.is_admin() internally; revoking this helper from
-- authenticated causes the Admin Center to fail with "permission denied".
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.is_admin() from anon, public;
