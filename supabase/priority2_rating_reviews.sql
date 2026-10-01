-- MarketKita Priority 2: Rating & Review
create table if not exists public.product_reviews (
 id uuid primary key default gen_random_uuid(),
 order_item_id uuid not null references public.order_items(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete restrict,
 buyer_id uuid not null references public.profiles(id) on delete cascade,
 seller_id uuid references public.profiles(id) on delete set null,
 store_id uuid references public.stores(id) on delete set null,
 rating smallint not null check(rating between 1 and 5),
 review_text text,
 seller_reply text,
 seller_replied_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(order_item_id,buyer_id)
);
create index if not exists product_reviews_product_idx on public.product_reviews(product_id,created_at desc);
create index if not exists product_reviews_store_idx on public.product_reviews(store_id,created_at desc);
alter table public.product_reviews enable row level security;
drop policy if exists product_reviews_public_read on public.product_reviews;
create policy product_reviews_public_read on public.product_reviews for select to anon,authenticated using(true);
drop policy if exists product_reviews_buyer_insert on public.product_reviews;
create policy product_reviews_buyer_insert on public.product_reviews for insert to authenticated with check(buyer_id=auth.uid());
revoke update on public.product_reviews from authenticated;
grant update(review_text) on public.product_reviews to authenticated;
grant update(seller_reply,seller_replied_at) on public.product_reviews to authenticated;

create or replace function public.submit_product_review(p_order_item_id uuid,p_rating smallint,p_review_text text default null)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_user uuid:=auth.uid(); v_item record; v_review_id uuid; v_text text:=nullif(trim(coalesce(p_review_text,'')),''); v_seller_id uuid;
begin
 if v_user is null then raise exception 'Anda harus login.'; end if;
 if p_rating not between 1 and 5 then raise exception 'Rating harus 1 sampai 5.'; end if;
 if length(coalesce(v_text,''))>2000 then raise exception 'Review maksimal 2000 karakter.'; end if;
 select oi.id,oi.order_id,oi.product_id,oi.store_id,o.buyer_id,o.status,o.payment_status
 into v_item from public.order_items oi join public.orders o on o.id=oi.order_id
 where oi.id=p_order_item_id and o.buyer_id=v_user for update of oi,o;
 if not found then raise exception 'Item pesanan tidak ditemukan.'; end if;
 select s.owner_id into v_seller_id from public.stores s where s.id=v_item.store_id;
 if v_item.status<>'completed'::public.order_status or v_item.payment_status<>'paid'::public.payment_status then raise exception 'Review hanya dapat diberikan setelah pesanan selesai.'; end if;
 if exists(select 1 from public.product_reviews where order_item_id=v_item.id and buyer_id=v_user) then raise exception 'Item pesanan ini sudah direview.'; end if;
 insert into public.product_reviews(order_item_id,order_id,product_id,buyer_id,seller_id,store_id,rating,review_text)
 values(v_item.id,v_item.order_id,v_item.product_id,v_user,v_seller_id,v_item.store_id,p_rating,v_text) returning id into v_review_id;
 return jsonb_build_object('ok',true,'review_id',v_review_id);
end;$function$;
revoke execute on function public.submit_product_review(uuid,smallint,text) from public,anon;
grant execute on function public.submit_product_review(uuid,smallint,text) to authenticated;

create or replace function public.seller_reply_product_review(p_review_id uuid,p_reply text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_user uuid:=auth.uid(); v_id uuid; v_reply text:=nullif(trim(coalesce(p_reply,'')),'');
begin
 if v_user is null then raise exception 'Anda harus login.'; end if;
 if length(coalesce(v_reply,''))=0 or length(v_reply)>2000 then raise exception 'Balasan harus 1 sampai 2000 karakter.'; end if;
 update public.product_reviews set seller_reply=v_reply,seller_replied_at=now(),updated_at=now() where id=p_review_id and seller_id=v_user returning id into v_id;
 if v_id is null then raise exception 'Review tidak ditemukan atau bukan milik toko Anda.'; end if;
 return jsonb_build_object('ok',true,'review_id',v_id);
end;$function$;
revoke execute on function public.seller_reply_product_review(uuid,text) from public,anon;
grant execute on function public.seller_reply_product_review(uuid,text) to authenticated;

create or replace function public.product_rating_summary(p_product_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $function$
select jsonb_build_object('review_count',count(*),'average_rating',coalesce(round(avg(rating)::numeric,2),0),'rating_5',count(*) filter(where rating=5),'rating_4',count(*) filter(where rating=4),'rating_3',count(*) filter(where rating=3),'rating_2',count(*) filter(where rating=2),'rating_1',count(*) filter(where rating=1)) from public.product_reviews where product_id=p_product_id;$function$;
grant execute on function public.product_rating_summary(uuid) to anon,authenticated;

create or replace function public.store_rating_summary(p_store_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $function$
select jsonb_build_object('review_count',count(*),'average_rating',coalesce(round(avg(rating)::numeric,2),0)) from public.product_reviews where store_id=p_store_id;$function$;
grant execute on function public.store_rating_summary(uuid) to anon,authenticated;