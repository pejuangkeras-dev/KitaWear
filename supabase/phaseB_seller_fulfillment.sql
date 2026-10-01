-- MarketKita Tahap B: seller multi-store fulfillment hardening
-- Applied to Supabase project eczozutsjwvkfgpyccou.

create or replace function public.seller_update_order_status(p_order_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_status text := lower(trim(coalesce(p_status,'')));
 v_order_status public.order_status;
 v_payment public.payment_status;
 v_split record;
 v_all_processing boolean;
 v_all_shipped boolean;
 v_all_completed boolean;
 v_all_cancelled boolean;
begin
 if v_user is null then raise exception 'Anda harus login.'; end if;
 if not exists(select 1 from public.profiles where id=v_user and role='seller') then raise exception 'Akses ditolak. Akun bukan seller.'; end if;
 if v_status='delivered' then v_status='completed'; end if;
 if v_status not in ('processing','shipped','completed','cancelled') then raise exception 'Status seller tidak valid.'; end if;

 select o.status,o.payment_status into v_order_status,v_payment from public.orders o where o.id=p_order_id for update;
 if not found then raise exception 'Pesanan tidak ditemukan.'; end if;
 if v_payment<>'paid'::public.payment_status and v_status in ('processing','shipped','completed') then raise exception 'Pesanan belum dibayar.'; end if;

 select os.id,os.seller_status,os.shipping_status into v_split
 from public.order_sellers os join public.stores s on s.id=os.store_id
 where os.order_id=p_order_id and s.owner_id=v_user for update;
 if not found then raise exception 'Pesanan tidak ditemukan atau bukan milik toko Anda.'; end if;

 if v_status='processing' and v_split.seller_status not in ('pending','paid','processing') then raise exception 'Toko Anda tidak dapat masuk ke status diproses dari status saat ini.'; end if;
 if v_status='shipped' and v_split.seller_status<>'processing' then raise exception 'Toko Anda harus memproses pesanan sebelum mengirim.'; end if;
 if v_status='completed' and v_split.seller_status<>'shipped' then raise exception 'Toko Anda harus mengirim pesanan sebelum menyelesaikannya.'; end if;
 if v_status='cancelled' and v_split.seller_status not in ('pending','paid','processing') then raise exception 'Toko Anda tidak dapat membatalkan pesanan dari status saat ini.'; end if;

 update public.order_sellers
 set seller_status=v_status,
     shipping_status=case when v_status='shipped' then 'shipped' when v_status='completed' then 'delivered' when v_status='cancelled' then 'cancelled' else shipping_status end,
     updated_at=now()
 where id=v_split.id;

 select
   bool_and(seller_status in ('processing','shipped','completed')),
   bool_and(seller_status in ('shipped','completed')),
   bool_and(seller_status='completed'),
   bool_and(seller_status='cancelled')
 into v_all_processing,v_all_shipped,v_all_completed,v_all_cancelled
 from public.order_sellers where order_id=p_order_id;

 if v_all_cancelled then
   update public.orders set status='cancelled',shipping_status='cancelled',updated_at=now() where id=p_order_id and payment_status='paid';
 elsif v_all_completed then
   update public.orders set status='completed',shipping_status='delivered',delivered_at=coalesce(delivered_at,now()),completed_at=coalesce(completed_at,now()),updated_at=now() where id=p_order_id and payment_status='paid';
 elsif v_all_shipped then
   update public.orders set status='shipped',shipping_status='shipped',shipped_at=coalesce(shipped_at,now()),updated_at=now() where id=p_order_id and payment_status='paid';
 elsif v_all_processing then
   update public.orders set status='processing',shipping_status='processing',processing_at=coalesce(processing_at,now()),updated_at=now() where id=p_order_id and payment_status='paid';
 end if;

 return jsonb_build_object('ok',true,'order_id',p_order_id,'seller_order_seller_id',v_split.id,'seller_status',v_status);
end;
$$;

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
 if length(v_tracking)>120 then raise exception 'Nomor resi terlalu panjang.'; end if;
 select o.payment_status into v_order_payment from public.orders o where o.id=p_order_id for update;
 if not found then raise exception 'Pesanan tidak ditemukan.'; end if;
 if v_order_payment<>'paid'::public.payment_status then raise exception 'Resi hanya dapat dipasang untuk pesanan yang sudah dibayar.'; end if;
 select os.id,os.seller_status,os.shipping_status into v_split
 from public.order_sellers os join public.stores s on s.id=os.store_id
 where os.order_id=p_order_id and s.owner_id=v_user for update;
 if not found then raise exception 'Data pengiriman toko tidak ditemukan.'; end if;
 if v_split.seller_status not in ('processing','shipped') then raise exception 'Resi hanya dapat dipasang setelah toko memproses pesanan.'; end if;
 update public.order_sellers set tracking_number=v_tracking,shipping_status=case when seller_status='shipped' then 'shipped' else shipping_status end,updated_at=now() where id=v_split.id;
 return jsonb_build_object('ok',true,'order_id',p_order_id,'tracking_number',v_tracking,'order_seller_id',v_split.id);
end;
$$;