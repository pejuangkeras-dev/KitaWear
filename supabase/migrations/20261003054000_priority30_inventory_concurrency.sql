alter table public.product_sizes
  drop constraint if exists product_sizes_stock_nonnegative,
  drop constraint if exists product_sizes_reserved_stock_nonnegative,
  drop constraint if exists product_sizes_reserved_lte_stock;

alter table public.product_sizes
  add constraint product_sizes_stock_nonnegative check (stock >= 0),
  add constraint product_sizes_reserved_stock_nonnegative check (reserved_stock >= 0),
  add constraint product_sizes_reserved_lte_stock check (reserved_stock <= stock);

create or replace function public.finalize_order_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_order record; v_item record; v_size record; v_reservation record;
begin
  select id,payment_status,stock_decremented_at into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan.'; end if;
  if v_order.payment_status<>'paid'::public.payment_status then raise exception 'Stok hanya dapat difinalisasi untuk order paid.'; end if;
  if v_order.stock_decremented_at is not null then return; end if;
  for v_item in select id,product_id,size,quantity from public.order_items where order_id=p_order_id order by id loop
    select * into v_reservation from public.stock_reservations where order_item_id=v_item.id for update;
    select id,stock,reserved_stock into v_size from public.product_sizes
      where product_id=v_item.product_id and upper(size)=upper(v_item.size) for update;
    if not found then raise exception 'Ukuran % tidak ditemukan untuk produk %.',v_item.size,v_item.product_id; end if;
    if v_reservation.id is not null and v_reservation.status='reserved' then
      if v_size.stock < v_item.quantity or v_size.reserved_stock < v_item.quantity then
        raise exception 'Stok reservation % ukuran % tidak konsisten saat finalisasi.',v_item.product_id,v_item.size;
      end if;
      update public.product_sizes set stock=stock-v_item.quantity,reserved_stock=reserved_stock-v_item.quantity where id=v_size.id;
      update public.stock_reservations set status='finalized',finalized_at=now() where id=v_reservation.id;
    else
      if (v_size.stock-v_size.reserved_stock)<v_item.quantity then
        raise exception 'Stok tersedia % ukuran % tidak mencukupi.',v_item.product_id,v_item.size;
      end if;
      update public.product_sizes set stock=stock-v_item.quantity where id=v_size.id;
    end if;
  end loop;
  update public.orders set stock_decremented_at=now(),updated_at=now() where id=p_order_id;
end;
$$;
revoke execute on function public.finalize_order_stock(uuid) from public,anon,authenticated;

create or replace function public.decrement_order_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path='public'
as $$
declare v_order record; v_item record; v_size record;
begin
  select id,payment_status,stock_decremented_at into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan.'; end if;
  if v_order.payment_status<>'paid' then raise exception 'Stok hanya dapat dikurangi untuk order yang sudah paid.'; end if;
  if v_order.stock_decremented_at is not null then return; end if;
  if exists(select 1 from public.stock_reservations where order_id=p_order_id and status='reserved') then
    perform public.finalize_order_stock(p_order_id); return;
  end if;
  for v_item in select product_id,size,quantity from public.order_items where order_id=p_order_id order by id loop
    select id,stock,reserved_stock into v_size from public.product_sizes
      where product_id=v_item.product_id and upper(size)=upper(v_item.size) for update;
    if not found then raise exception 'Ukuran % tidak ditemukan untuk produk %.',v_item.size,v_item.product_id; end if;
    if (v_size.stock-v_size.reserved_stock)<v_item.quantity then
      raise exception 'Stok tersedia % ukuran % tidak mencukupi.',v_item.product_id,v_item.size;
    end if;
    update public.product_sizes set stock=stock-v_item.quantity where id=v_size.id;
  end loop;
  update public.orders set stock_decremented_at=now(),updated_at=now() where id=p_order_id;
end;
$$;
revoke execute on function public.decrement_order_stock(uuid) from public,anon,authenticated;
