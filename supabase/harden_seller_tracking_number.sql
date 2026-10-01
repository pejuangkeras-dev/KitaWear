-- Harden seller tracking number writes
create or replace function public.seller_set_tracking_number(p_order_id uuid,p_tracking_number text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_tracking text := trim(coalesce(p_tracking_number,''));
 v_order_payment public.payment_status;
 v_split record;
begin
 if v_user is null then raise exception 'Anda harus login.'; end if;
 if not exists(select 1 from public.profiles where id=v_user and role='seller') then raise exception 'Akses ditolak. Akun bukan seller.'; end if;
 if v_tracking='' then raise exception 'Nomor resi wajib diisi.'; end if;
 if length(v_tracking)<3 or length(v_tracking)>80 then raise exception 'Nomor resi harus 3-80 karakter.'; end if;
 if v_tracking !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then raise exception 'Nomor resi mengandung karakter yang tidak valid.'; end if;
 select o.payment_status into v_order_payment from public.orders o where o.id=p_order_id for update;
 if not found then raise exception 'Pesanan tidak ditemukan.'; end if;
 if v_order_payment<>'paid'::public.payment_status then raise exception 'Resi hanya dapat dipasang untuk pesanan yang sudah dibayar.'; end if;
 select os.id,os.seller_status,os.shipping_status,os.tracking_number into v_split
 from public.order_sellers os join public.stores s on s.id=os.store_id
 where os.order_id=p_order_id and s.owner_id=v_user for update;
 if not found then raise exception 'Data pengiriman toko tidak ditemukan.'; end if;
 if v_split.seller_status not in ('processing','shipped') then raise exception 'Resi hanya dapat dipasang setelah toko memproses pesanan.'; end if;
 if v_split.tracking_number is not null and trim(v_split.tracking_number)<>'' and upper(trim(v_split.tracking_number))<>upper(v_tracking) then
   raise exception 'Nomor resi sudah tersimpan dan tidak dapat diganti dari Seller Center.';
 end if;
 update public.order_sellers
 set tracking_number=v_tracking,shipping_status=case when seller_status='shipped' then 'shipped' else shipping_status end,updated_at=now()
 where id=v_split.id;
 return jsonb_build_object('ok',true,'order_id',p_order_id,'tracking_number',v_tracking,'order_seller_id',v_split.id);
end;
$$;