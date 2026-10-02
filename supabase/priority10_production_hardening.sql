revoke execute on function public.filter_notification_by_preferences() from public;
revoke execute on function public.notification_type_enabled(uuid,text) from public;
grant execute on function public.filter_notification_by_preferences() to authenticated, service_role;
grant execute on function public.notification_type_enabled(uuid,text) to authenticated, service_role;

-- Public rating summary functions remain executable for storefront rendering.
