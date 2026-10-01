-- MarketKita Tahap C: Growth / discovery
-- Persistent wishlist, public aggregate ratings, recommendation data foundation.

create table if not exists public.wishlists (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

alter table public.wishlists enable row level security;

drop policy if exists wishlists_select_own on public.wishlists;
drop policy if exists wishlists_insert_own on public.wishlists;
drop policy if exists wishlists_delete_own on public.wishlists;

create policy wishlists_select_own on public.wishlists
for select to authenticated using (user_id = auth.uid());

create policy wishlists_insert_own on public.wishlists
for insert to authenticated with check (user_id = auth.uid());

create policy wishlists_delete_own on public.wishlists
for delete to authenticated using (user_id = auth.uid());

create index if not exists wishlists_product_id_idx on public.wishlists(product_id);
create index if not exists product_reviews_product_rating_idx on public.product_reviews(product_id,rating);
create index if not exists seller_reviews_store_rating_idx on public.seller_reviews(store_id,rating);

drop view if exists public.marketplace_product_stats;
create view public.marketplace_product_stats
with (security_invoker = true)
as
select
  p.id as product_id,
  p.store_id,
  coalesce(pr.product_rating,0)::numeric(3,2) as product_rating,
  coalesce(pr.review_count,0)::bigint as review_count,
  coalesce(sr.seller_rating,0)::numeric(3,2) as seller_rating,
  coalesce(sr.seller_review_count,0)::bigint as seller_review_count
from public.products p
left join (
  select product_id, avg(rating)::numeric(3,2) as product_rating, count(*)::bigint as review_count
  from public.product_reviews
  group by product_id
) pr on pr.product_id=p.id
left join (
  select store_id, avg(rating)::numeric(3,2) as seller_rating, count(*)::bigint as seller_review_count
  from public.seller_reviews
  group by store_id
) sr on sr.store_id=p.store_id;

grant select on public.marketplace_product_stats to anon, authenticated;
grant select on public.wishlists to authenticated;
