begin;
alter function public.normalize_address_text(text) set search_path='';
alter function public.address_street_set_normalized() set search_path='';
alter function public.address_alias_set_normalized() set search_path='';
revoke execute on function public.search_address_streets(text,text,text,text,text,text,integer) from public,anon;
grant execute on function public.search_address_streets(text,text,text,text,text,text,integer) to authenticated;
commit;