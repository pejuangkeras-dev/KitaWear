-- Fix restore_order_stock enum comparison.
-- payment_status enum does not contain 'cancelled'; order cancellation is represented by order_status.
create or replace function public.restore_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order record;
  v_item record;
begin
  select id, payment_status, stock_decremented_at, stock_restored_at
  into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'Order tidak ditemukan.';
  end if;

  if v_order.stock_decremented_at is null then
    return;
  end if;

  if v_order.stock_restored_at is not null then
    return;
  end if;

  if v_order.payment_status not in ('refunded','failed','expired') then
    raise exception 'Stok hanya dapat dikembalikan untuk order yang dibatalkan/refund.';
  end if;

  for v_item in
    select product_id, size, quantity
    from public.order_items
    where order_id=p_order_id
    order by id
    for update
  loop
    update public.product_sizes
    set stock=stock+v_item.quantity
    where product_id=v_item.product_id
      and upper(size)=upper(v_item.size);

    if not found then
      raise exception 'Ukuran % tidak ditemukan untuk produk %.',v_item.size,v_item.product_id;
    end if;
  end loop;

  update public.orders
  set stock_restored_at=now(),updated_at=now()
  where id=p_order_id;
end;
$function$;
