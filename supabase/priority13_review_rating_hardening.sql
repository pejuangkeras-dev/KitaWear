-- MarketKita Priority 13: Review & Rating production hardening
-- Canonical reputation source: product_reviews.

alter table public.product_reviews enable row level security;

drop policy if exists product_reviews_buyer_insert on public.product_reviews;

revoke insert, update, delete on public.product_reviews from public, anon, authenticated;
revoke update(review_text) on public.product_reviews from authenticated;
revoke update(seller_reply, seller_replied_at) on public.product_reviews from authenticated;

grant select on public.product_reviews to anon, authenticated;
grant all on public.product_reviews to service_role;

create index if not exists product_reviews_buyer_created_idx on public.product_reviews(buyer_id, created_at desc);
create index if not exists product_reviews_seller_created_idx on public.product_reviews(seller_id, created_at desc);
create index if not exists product_reviews_order_item_idx on public.product_reviews(order_item_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='product_reviews_text_length_chk') then
    alter table public.product_reviews add constraint product_reviews_text_length_chk
      check (review_text is null or char_length(review_text) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname='product_reviews_reply_length_chk') then
    alter table public.product_reviews add constraint product_reviews_reply_length_chk
      check (seller_reply is null or char_length(seller_reply) <= 2000);
  end if;
end $$;

create or replace function public.submit_product_review(p_order_item_id uuid,p_rating smallint,p_review_text text default null)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_user uuid:=auth.uid();
  v_item record;
  v_review_id uuid;
  v_text text:=nullif(trim(coalesce(p_review_text,'')),'');
  v_seller_id uuid;
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;
  if p_rating not between 1 and 5 then raise exception 'Rating harus 1 sampai 5.'; end if;
  if length(coalesce(v_text,''))>2000 then raise exception 'Review maksimal 2000 karakter.'; end if;

  select oi.id,oi.order_id,oi.product_id,oi.store_id,o.buyer_id,o.status,o.payment_status
  into v_item
  from public.order_items oi join public.orders o on o.id=oi.order_id
  where oi.id=p_order_item_id and o.buyer_id=v_user
  for update of oi,o;

  if not found then raise exception 'Item pesanan tidak ditemukan.'; end if;

  select s.owner_id into v_seller_id from public.stores s where s.id=v_item.store_id;
  if v_item.status<>'completed'::public.order_status or v_item.payment_status<>'paid'::public.payment_status then
    raise exception 'Review hanya dapat diberikan setelah pesanan selesai.';
  end if;
  if v_seller_id is null then raise exception 'Toko seller untuk item pesanan tidak ditemukan.'; end if;
  if exists(select 1 from public.product_reviews where order_item_id=v_item.id and buyer_id=v_user) then
    raise exception 'Item pesanan ini sudah direview.';
  end if;

  insert into public.product_reviews(order_item_id,order_id,product_id,buyer_id,seller_id,store_id,rating,review_text)
  values(v_item.id,v_item.order_id,v_item.product_id,v_user,v_seller_id,v_item.store_id,p_rating,v_text)
  returning id into v_review_id;

  return jsonb_build_object('ok',true,'review_id',v_review_id);
end;
$function$;

revoke execute on function public.submit_product_review(uuid,smallint,text) from public, anon;
grant execute on function public.submit_product_review(uuid,smallint,text) to authenticated, service_role;

create or replace function public.seller_reply_product_review(p_review_id uuid,p_reply text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_user uuid:=auth.uid();
  v_id uuid;
  v_buyer_id uuid;
  v_reply text:=nullif(trim(coalesce(p_reply,'')),'');
begin
  if v_user is null then raise exception 'Anda harus login.'; end if;
  if length(coalesce(v_reply,''))=0 or length(v_reply)>2000 then raise exception 'Balasan harus 1 sampai 2000 karakter.'; end if;

  update public.product_reviews
  set seller_reply=v_reply,seller_replied_at=now(),updated_at=now()
  where id=p_review_id and seller_id=v_user
  returning id,buyer_id into v_id,v_buyer_id;

  if v_id is null then raise exception 'Review tidak ditemukan atau bukan milik toko Anda.'; end if;
  return jsonb_build_object('ok',true,'review_id',v_id,'buyer_id',v_buyer_id);
end;
$function$;

revoke execute on function public.seller_reply_product_review(uuid,text) from public, anon;
grant execute on function public.seller_reply_product_review(uuid,text) to authenticated, service_role;

create or replace function public.notify_buyer_on_review_reply()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.seller_reply is not null and btrim(new.seller_reply)<>'' and
     (tg_op='INSERT' or old.seller_reply is distinct from new.seller_reply) then
    insert into public.notifications(user_id,type,title,message,link)
    values(new.buyer_id,'system','Seller membalas ulasan Anda',
           'Seller telah membalas ulasan produk Anda.','/?account=orders');
  end if;
  return new;
end;
$function$;

revoke execute on function public.notify_buyer_on_review_reply() from public, anon, authenticated;
grant execute on function public.notify_buyer_on_review_reply() to service_role;

drop trigger if exists product_review_reply_notification on public.product_reviews;
create trigger product_review_reply_notification
after insert or update of seller_reply on public.product_reviews
for each row execute function public.notify_buyer_on_review_reply();

revoke insert, update, delete on public.seller_reviews from public, anon, authenticated;
grant select on public.seller_reviews to anon, authenticated;
