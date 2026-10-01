-- Priority 3 buyer address hardening + immutable order snapshot
alter table public.orders
  add column if not exists shipping_address_id uuid references public.buyer_addresses(id) on delete set null,
  add column if not exists shipping_recipient_name text,
  add column if not exists shipping_phone text,
  add column if not exists shipping_address_line text,
  add column if not exists shipping_city text,
  add column if not exists shipping_province text;

with ranked as (
  select id,row_number() over(partition by user_id order by is_default desc,created_at asc,id) rn
  from public.buyer_addresses
)
update public.buyer_addresses a
set is_default=(r.rn=1),updated_at=now()
from ranked r where a.id=r.id and a.is_default is distinct from (r.rn=1);

create unique index if not exists buyer_addresses_one_default_per_user on public.buyer_addresses(user_id) where is_default=true;

alter table public.buyer_addresses drop constraint if exists buyer_addresses_phone_format_check;
alter table public.buyer_addresses add constraint buyer_addresses_phone_format_check check(phone ~ '^[0-9+][0-9 ()-]{7,19}$');
alter table public.buyer_addresses drop constraint if exists buyer_addresses_postal_code_check;
alter table public.buyer_addresses add constraint buyer_addresses_postal_code_check check(postal_code ~ '^[0-9]{5}$');
alter table public.buyer_addresses drop constraint if exists buyer_addresses_text_length_check;
alter table public.buyer_addresses add constraint buyer_addresses_text_length_check check(char_length(trim(label)) between 1 and 40 and char_length(trim(recipient_name)) between 2 and 100 and char_length(trim(address_line)) between 5 and 500 and char_length(trim(city)) between 2 and 100 and char_length(trim(province)) between 2 and 100);

create or replace function public.set_default_buyer_address(p_address_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_exists boolean;
begin
 if v_user is null then raise exception 'Silakan login terlebih dahulu.'; end if;
 select exists(select 1 from public.buyer_addresses where id=p_address_id and user_id=v_user) into v_exists;
 if not v_exists then raise exception 'Alamat tidak ditemukan.'; end if;
 update public.buyer_addresses set is_default=false,updated_at=now() where user_id=v_user and is_default=true;
 update public.buyer_addresses set is_default=true,updated_at=now() where id=p_address_id and user_id=v_user;
 return jsonb_build_object('ok',true,'address_id',p_address_id);
end $$;
revoke all on function public.set_default_buyer_address(uuid) from public,anon;
grant execute on function public.set_default_buyer_address(uuid) to authenticated;

create or replace function public.get_buyer_address_snapshot(p_address_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_row public.buyer_addresses%rowtype;
begin
 if v_user is null then raise exception 'Silakan login terlebih dahulu.'; end if;
 select * into v_row from public.buyer_addresses where id=p_address_id and user_id=v_user;
 if not found then raise exception 'Alamat pengiriman tidak ditemukan.'; end if;
 if v_row.postal_code !~ '^[0-9]{5}$' then raise exception 'Kode pos alamat harus 5 digit.'; end if;
 return jsonb_build_object('id',v_row.id,'label',v_row.label,'recipient_name',v_row.recipient_name,'phone',v_row.phone,'address_line',v_row.address_line,'city',v_row.city,'province',v_row.province,'postal_code',v_row.postal_code);
end $$;
revoke all on function public.get_buyer_address_snapshot(uuid) from public,anon;
grant execute on function public.get_buyer_address_snapshot(uuid) to authenticated;