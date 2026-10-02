create unique index if not exists shipping_shipments_one_per_order_seller
on public.shipping_shipments(order_seller_id);

alter table public.shipping_shipments
 add constraint shipping_shipments_fee_nonnegative check (shipping_fee>=0);

create or replace function public.validate_shipping_shipment()
returns trigger language plpgsql security definer set search_path=''
as $$
declare o record; os record;
begin
 select id,status,payment_status into o from public.orders where id=new.order_id for update;
 if not found then raise exception 'Order tidak ditemukan'; end if;
 select id,order_id,shipping_status,tracking_number into os from public.order_sellers where id=new.order_seller_id for update;
 if not found or os.order_id<>new.order_id then raise exception 'Order seller tidak cocok dengan order'; end if;
 if new.status in ('created','booked','pickup_requested','picked_up','in_transit','delivered') and o.payment_status not in ('paid','refunded') then
   raise exception 'Shipment fulfillment requires paid order';
 end if;
 if new.status in ('booked','pickup_requested','picked_up','in_transit','delivered') and coalesce(nullif(trim(new.waybill_id),''),nullif(trim(new.provider_tracking_id),'')) is null and nullif(trim(os.tracking_number),'') is null then
   raise exception 'Shipment aktif membutuhkan AWB/tracking number';
 end if;
 return new;
end;
$$;
drop trigger if exists validate_shipping_shipment_trigger on public.shipping_shipments;
create trigger validate_shipping_shipment_trigger before insert or update on public.shipping_shipments
for each row execute function public.validate_shipping_shipment();
revoke execute on function public.validate_shipping_shipment() from public,anon,authenticated;