-- G3 social commerce hardening: wishlist + store follows
alter table public.wishlists add constraint wishlists_user_product_unique unique (user_id,product_id);
alter table public.store_follows add constraint store_follows_user_store_unique unique (user_id,store_id);
create index if not exists idx_wishlists_user_created on public.wishlists(user_id,created_at desc);
create index if not exists idx_wishlists_product on public.wishlists(product_id);
create index if not exists idx_store_follows_user_created on public.store_follows(user_id,created_at desc);
create index if not exists idx_store_follows_store on public.store_follows(store_id);
do $$ begin
if not exists(select 1 from pg_policies where schemaname='public' and tablename='wishlists' and policyname='wishlists_select_own') then create policy wishlists_select_own on public.wishlists for select to authenticated using ((select auth.uid())=user_id); end if;
if not exists(select 1 from pg_policies where schemaname='public' and tablename='wishlists' and policyname='wishlists_insert_own') then create policy wishlists_insert_own on public.wishlists for insert to authenticated with check ((select auth.uid())=user_id); end if;
if not exists(select 1 from pg_policies where schemaname='public' and tablename='wishlists' and policyname='wishlists_delete_own') then create policy wishlists_delete_own on public.wishlists for delete to authenticated using ((select auth.uid())=user_id); end if;
if not exists(select 1 from pg_policies where schemaname='public' and tablename='store_follows' and policyname='store_follows_select_own') then create policy store_follows_select_own on public.store_follows for select to authenticated using ((select auth.uid())=user_id); end if;
if not exists(select 1 from pg_policies where schemaname='public' and tablename='store_follows' and policyname='store_follows_insert_own') then create policy store_follows_insert_own on public.store_follows for insert to authenticated with check ((select auth.uid())=user_id); end if;
if not exists(select 1 from pg_policies where schemaname='public' and tablename='store_follows' and policyname='store_follows_delete_own') then create policy store_follows_delete_own on public.store_follows for delete to authenticated using ((select auth.uid())=user_id); end if;
end $$;