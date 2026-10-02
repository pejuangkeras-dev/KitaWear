-- P37 return/dispute window enforcement
create or replace function public.buyer_create_dispute(p_order_id uuid,p_reason text,p_description text)
returns jsonb language plpgsql security definer set search_path='public'
as $$
declare v_order public.orders%rowtype; v_dispute public.disputes%rowtype; v_deadline timestamptz;
begin
 if auth.uid() is null then raise exception 'Silakan login terlebih dahulu.'; end if;
 select * into v_order from public.orders where id=p_order_id and buyer_id=auth.uid() for update;
 if not found then raise exception 'Pesanan tidak ditemukan.'; end if;
 if v_order.status::text not in ('shipped','delivered','completed') then raise exception 'Sengketa dapat dibuat setelah pesanan dikirim.'; end if;
 if v_order.status::text in ('delivered','completed') then
   if v_order.delivered_at is null then raise exception 'Waktu barang diterima belum tersedia.'; end if;
   v_deadline:=v_order.delivered_at+interval '7 days';
   if now()>v_deadline then raise exception 'Batas waktu pengajuan sengketa 7 hari setelah barang diterima telah berakhir.'; end if;
 end if;
 if coalesce(length(trim(p_reason)),0)<3 then raise exception 'Alasan sengketa wajib diisi.'; end if;
 if coalesce(length(trim(p_description)),0)<10 then raise exception 'Jelaskan masalah minimal 10 karakter.'; end if;
 if exists(select 1 from public.disputes where order_id=p_order_id and status in ('open','reviewing','waiting_buyer','waiting_seller')) then raise exception 'Pesanan ini sudah memiliki sengketa aktif.'; end if;
 insert into public.disputes(order_id,buyer_id,reason,description,status,created_at) values(p_order_id,auth.uid(),trim(p_reason),trim(p_description),'open',now()) returning * into v_dispute;
 insert into public.notifications(user_id,type,title,message,link) values(auth.uid(),'dispute','Sengketa berhasil dibuat','Sengketa untuk pesanan '||coalesce(v_order.order_number,'')||' sudah dikirim ke tim MarketKita.','?account=disputes');
 return jsonb_build_object('ok',true,'id',v_dispute.id,'status',v_dispute.status);
end;
$$;
create or replace function public.request_return(p_order_item_id uuid,p_type text,p_reason text,p_description text default null,p_evidence_urls jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v record; v_id uuid; v_deadline timestamptz;
begin
 if v_user is null then raise exception 'Anda harus login.'; end if;
 if p_type not in ('return_refund','replacement') then raise exception 'Jenis pengajuan tidak valid.'; end if;
 select oi.id,oi.order_id,oi.store_id,oi.line_total,o.buyer_id,o.status,o.payment_status,o.delivered_at,s.owner_id into v
 from public.order_items oi join public.orders o on o.id=oi.order_id join public.stores s on s.id=oi.store_id
 where oi.id=p_order_item_id and o.buyer_id=v_user for update of oi,o;
 if not found then raise exception 'Item pesanan tidak ditemukan.'; end if;
 if v.status not in ('delivered','completed')::text[] then raise exception 'Pengajuan hanya tersedia setelah pesanan diterima/delivered.'; end if;
 if v.delivered_at is null or now()>v.delivered_at+interval '7 days' then raise exception 'Batas waktu retur/penggantian 7 hari setelah barang diterima telah berakhir.'; end if;
 if v.payment_status<>'paid'::public.payment_status then raise exception 'Pesanan belum lunas.'; end if;
 if v.owner_id is null then raise exception 'Seller tidak valid.'; end if;
 if exists(select 1 from public.return_requests where order_item_id=v.id and status not in ('rejected','cancelled')) then raise exception 'Item ini sudah memiliki pengajuan aktif.'; end if;
 insert into public.return_requests(order_item_id,order_id,buyer_id,seller_id,type,reason,description,evidence_urls,requested_amount)
 values(v.id,v.order_id,v_user,v.owner_id,p_type,trim(p_reason),nullif(trim(coalesce(p_description,'')),''),coalesce(p_evidence_urls,'[]'::jsonb),v.line_total) returning id into v_id;
 return jsonb_build_object('ok',true,'return_request_id',v_id);
end;
$$;