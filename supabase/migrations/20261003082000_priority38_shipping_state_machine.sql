-- P38 shipping status state machine
create or replace function public.validate_shipping_shipment()
returns trigger language plpgsql security definer set search_path=''
as $$
declare o record; os record; old_rank integer; new_rank integer;
begin
 select id,status,payment_status into o from public.orders where id=new.order_id for update;
 if not found then raise exception 'Order tidak ditemukan'; end if;
 select id,order_id,shipping_status,tracking_number into os from public.order_sellers where id=new.order_seller_id for update;
 if not found or os.order_id<>new.order_id then raise exception 'Order seller tidak cocok dengan order'; end if;
 if new.status not in ('pending','created','booked','pickup_requested','picked_up','in_transit','delivered','cancelled') then raise exception 'Status shipment tidak valid'; end if;
 if new.status in ('created','booked','pickup_requested','picked_up','in_transit','delivered') and o.payment_status not in ('paid','refunded') then raise exception 'Shipment fulfillment requires paid order'; end if;
 if new.status in ('booked','pickup_requested','picked_up','in_transit','delivered') and coalesce(nullif(trim(new.waybill_id),''),nullif(trim(new.provider_tracking_id),'')) is null and nullif(trim(os.tracking_number),'') is null then raise exception 'Shipment aktif membutuhkan AWB/tracking number'; end if;
 if tg_op='UPDATE' then
   old_rank:=case old.status when 'pending' then 0 when 'created' then 1 when 'booked' then 2 when 'pickup_requested' then 3 when 'picked_up' then 4 when 'in_transit' then 5 when 'delivered' then 6 when 'cancelled' then 7 else -1 end;
   new_rank:=case new.status when 'pending' then 0 when 'created' then 1 when 'booked' then 2 when 'pickup_requested' then 3 when 'picked_up' then 4 when 'in_transit' then 5 when 'delivered' then 6 when 'cancelled' then 7 else -1 end;
   if old.status='delivered' and new.status<>'delivered' then raise exception 'Shipment delivered tidak boleh mundur'; end if;
   if old.status='cancelled' and new.status<>'cancelled' then raise exception 'Shipment cancelled tidak boleh berubah'; end if;
   if new.status<>'cancelled' and new_rank<old_rank then raise exception 'Status shipment tidak boleh mundur'; end if;
 end if;
 return new;
end;
$$;
revoke execute on function public.validate_shipping_shipment() from public,anon,authenticated;