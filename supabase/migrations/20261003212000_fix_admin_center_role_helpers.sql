-- Keep safe role helpers callable by authenticated clients because
-- existing RLS policies use them during Admin Center reads.
grant execute on function public.is_seller_or_admin() to authenticated;
grant execute on function public.mk_is_seller_or_admin() to authenticated;
revoke execute on function public.is_seller_or_admin() from anon, public;
revoke execute on function public.mk_is_seller_or_admin() from anon, public;
