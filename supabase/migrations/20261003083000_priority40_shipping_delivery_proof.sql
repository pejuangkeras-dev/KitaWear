-- P40 shipping tracking and delivery proof
alter table public.shipping_shipments
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_proof_url text,
  add column if not exists delivery_recipient text,
  add column if not exists delivery_proof_at timestamptz;

create or replace function public.validate_shipping_delivery_proof()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.status='delivered' then
   if coalesce(nullif(trim(new.waybill_id),''),nullif(trim(new.provider_tracking_id),'')) is null then
     raise exception 'Delivered shipment wajib memiliki AWB';
   end if;
   if new.delivered_at is null then
     new.delivered_at=coalesce(new.delivery_proof_at,new.last_webhook_at,now());
   end if;
   if new.delivered_at > now() + interval '5 minutes' then
     raise exception 'Waktu delivered tidak valid';
   end if;
 end if;
 return new;
end;
$$;

drop trigger if exists validate_shipping_delivery_proof_trigger on public.shipping_shipments;
create trigger validate_shipping_delivery_proof_trigger
before insert or update on public.shipping_shipments
for each row execute function public.validate_shipping_delivery_proof();

revoke execute on function public.validate_shipping_delivery_proof() from public,anon,authenticated;