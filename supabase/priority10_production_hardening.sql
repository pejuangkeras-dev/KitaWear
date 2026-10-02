revoke execute on function public.filter_notification_by_preferences() from anon;
revoke execute on function public.notification_type_enabled(uuid,text) from anon;

-- Public rating summary functions remain executable for storefront rendering.
