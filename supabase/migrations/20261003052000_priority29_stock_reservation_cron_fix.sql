create or replace function public.release_expired_stock_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_count integer := 0;
begin
  for v_order_id in
    select distinct order_id
    from public.stock_reservations
    where status='reserved' and expires_at<=now()
    order by order_id
  loop
    perform public.release_order_stock_reservation(v_order_id,'expired');
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.release_expired_stock_reservations() from public, anon, authenticated;
